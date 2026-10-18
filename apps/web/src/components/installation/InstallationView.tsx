'use client';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { Badge, ErrorBox, useAction } from '@/components/ui';
import { del, errorText, get, post, put } from '@/lib/api';
import { flush, isOffline, pending, PendingTick, remember, withPending } from '@/lib/offlineChecklist';
import type { InstallReport } from '@/lib/types';
import '@/components/service/service.css';

/** Draw a signature with a finger, a pen or a mouse. */
export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const drawn = useRef(false);
  useEffect(() => {
    const c = ref.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio;
    c.height = c.clientHeight * ratio;
    const g = c.getContext('2d')!;
    g.scale(ratio, ratio);
    g.lineWidth = 2.2;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = '#111827';
  }, []);
  const at = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const clear = () => {
    const c = ref.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    drawn.current = false;
    onChange(null);
  };
  return (
    <div className="sig-pad">
      <canvas ref={ref} aria-label="Sign here"
        onPointerDown={(e) => { drawing.current = true; ref.current!.setPointerCapture(e.pointerId); const g = ref.current!.getContext('2d')!; g.beginPath(); g.moveTo(...at(e)); }}
        onPointerMove={(e) => { if (!drawing.current) return; const g = ref.current!.getContext('2d')!; g.lineTo(...at(e)); g.stroke(); drawn.current = true; }}
        onPointerUp={() => { drawing.current = false; if (drawn.current) onChange(ref.current!.toDataURL('image/png')); }} />
      <div className="sig-foot"><span className="small muted">Sign above</span><button type="button" className="link-btn" onClick={clear}>Clear</button></div>
    </div>
  );
}

/** The customer's sign-off: their name and signature. */
export function SignOff({ defaultName, onSign }: { defaultName: string; onSign: (name: string, signature: string) => Promise<unknown> }) {
  const [name, setName] = useState(defaultName);
  const [signature, setSignature] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  return (
    <div className="stack">
      <label className="field">Name of the person signing<input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>
      <SignaturePad onChange={setSignature} />
      <p className="small muted" style={{ margin: 0 }}>By signing, the customer confirms the work above was done and shown to them.</p>
      <ErrorBox error={error} />
      <button className="btn btn-primary" disabled={busy || !signature || name.trim().length < 2} onClick={() => void run(() => onSign(name.trim(), signature!))}>
        <Icon name="check" size={15} />Sign off the installation
      </button>
    </div>
  );
}

export function Signed({ r }: { r: InstallReport }) {
  return (
    <div className="signed-box">
      {r.signature && <img src={r.signature} alt={`Signature of ${r.signedName}`} />}
      <span><b>{r.signedName}</b> signed on {new Date(r.signedAt!).toLocaleString([], { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
    </div>
  );
}

export function Photos({ r, onDelete }: { r: InstallReport; onDelete?: (id: string) => void }) {
  if (!r.photos.length) return <p className="small muted">No photos yet.</p>;
  return (
    <div className="photo-grid">
      {r.photos.map((p) => (
        <figure key={p.id}>
          <a href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt={p.caption || 'Installation photo'} loading="lazy" /></a>
          <figcaption>
            <span className="truncate">{p.caption || '—'}</span>
            {onDelete && <button className="icon-btn" aria-label="Delete photo" onClick={() => onDelete(p.id)}><Icon name="trash" size={13} /></button>}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

/** Console, home workspace → Installation: the checklist, photos and sign-off. */
export function InstallationView({ homeId }: { homeId: string }) {
  const base = `/platform/homes/${homeId}/installation`;
  const [r, setR] = useState<InstallReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [uploading, setUploading] = useState(false);
  const [caption, setCaption] = useState('');
  const { busy, run, error: actError } = useAction();
  // ticks and notes kept on this phone while there is no signal, sent when it is back
  const [waiting, setWaiting] = useState<PendingTick[]>([]);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const sync = async () => {
    try {
      const x = await flush(homeId);
      if (x) setR(x);
    } catch (e) { setError(errorText(e)); }
    setWaiting(pending(homeId));
  };
  const load = async () => {
    setWaiting(pending(homeId));
    try {
      const x = await get<InstallReport>(base);
      setR(x); setNotes(x.notes);
      await sync();
    } catch (e) { setError(errorText(e)); }
  };
  useEffect(() => { void load(); }, [homeId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // back online (or the app opened again): send what is waiting
    const again = () => void sync();
    window.addEventListener('online', again);
    const every = setInterval(() => { if (pending(homeId).length && !isOffline()) void sync(); }, 20_000);
    return () => { window.removeEventListener('online', again); clearInterval(every); };
  }, [homeId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!r) return error ? <ErrorBox error={error} /> : <Loader />;
  const shown = withPending(r, waiting);
  const locked = r.signed || !r.canEdit;
  /** A tick (or a note) is saved on the phone first, then sent; without signal it waits there. */
  const change = (key: string, done: boolean, note?: string) => {
    remember(homeId, { key, done, ...(note !== undefined ? { note } : {}), at: new Date().toISOString() });
    setWaiting(pending(homeId));
    if (!isOffline()) void sync();
  };
  const tick = (key: string, done: boolean) => change(key, done);

  async function upload(file: File) {
    setUploading(true); setError(null);
    const f = new FormData();
    f.append('photo', file);
    f.append('caption', caption);
    try {
      const res = await fetch(`/api${base}/photos`, { method: 'POST', body: f, credentials: 'include' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? 'Upload failed');
      setR(body); setCaption('');
    } catch (e) { setError(errorText(e)); } finally { setUploading(false); }
  }

  return (
    <div className="stack install-report">
      <div className="spread">
        <div className="stack-tight">
          <b style={{ fontSize: 16 }}>Installation report</b>
          <span className="small muted">{r.installer ? `By ${r.installer} · ` : ''}{shown.done} of {r.total} checked · {r.photos.length} photo{r.photos.length === 1 ? '' : 's'}</span>
        </div>
        <span className="row" style={{ gap: 8 }}>
          {r.signed ? <Badge tone="ok">Signed off</Badge> : <Badge tone="warn">Not signed yet</Badge>}
          <button className="btn btn-sm" onClick={() => window.print()}><Icon name="file-text" size={14} />Print</button>
        </span>
      </div>
      <ErrorBox error={error ?? actError} />
      {waiting.length > 0 && (
        <div className="offline-note" role="status">
          <Icon name="wifi-off" size={15} />
          <span className="grow">Saved on this phone — will send when online ({waiting.length} change{waiting.length === 1 ? '' : 's'}).</span>
          {!isOffline() && <button className="btn btn-sm" onClick={() => void sync()}>Send now</button>}
        </div>
      )}

      {r.toInstall && r.toInstall.items.length > 0 && (
        <section className="card card-pad stack">
          <div className="spread"><h3 style={{ margin: 0 }}>What to install</h3><span className="small muted">Accepted in {r.toInstall.quotes.map((q) => q.ref).join(', ')}</span></div>
          <ul className="to-install">
            {r.toInstall.items.map((i) => <li key={`${i.name}-${i.unit}`}><b>{i.qty} ×</b> {i.name}{i.unit !== 'each' ? <span className="muted"> (per {i.unit})</span> : null}</li>)}
          </ul>
        </section>
      )}

      <section className="card card-pad stack">
        <h3 style={{ margin: 0 }}>Checklist</h3>
        {shown.items.map((i) => (
          <div key={i.key} className="stack-tight">
            <label className={`check-item ${i.done ? 'done' : ''}`}>
              <input type="checkbox" checked={i.done} disabled={locked} onChange={(e) => tick(i.key, e.target.checked)} />
              <span className="stack-tight">
                <span>{i.label}{waiting.some((p) => p.key === i.key) && <span className="small muted"> · on this phone</span>}</span>
                {i.check && <span className={`small ${i.check.ok ? 'ok-text' : 'text-bad'}`}><Icon name={i.check.ok ? 'check' : 'alert-triangle'} size={12} /> {i.check.text}</span>}
                {i.note && noteDrafts[i.key] === undefined && <span className="small muted">Note: {i.note}</span>}
              </span>
            </label>
            {!locked && (noteDrafts[i.key] === undefined
              ? <button type="button" className="link-btn small" style={{ alignSelf: 'flex-start', marginLeft: 28 }} onClick={() => setNoteDrafts((d) => ({ ...d, [i.key]: i.note ?? '' }))}>{i.note ? 'Change note' : 'Add a note'}</button>
              : (
                <form className="row" style={{ gap: 6, marginLeft: 28 }} onSubmit={(e) => {
                  e.preventDefault();
                  change(i.key, i.done, noteDrafts[i.key]!.trim());
                  setNoteDrafts(({ [i.key]: _gone, ...rest }) => rest);
                }}>
                  <input className="grow" value={noteDrafts[i.key]} maxLength={300} autoFocus aria-label={`Note for ${i.label}`} placeholder="e.g. Used 2.5 mm wire for the geyser"
                         onChange={(e) => setNoteDrafts((d) => ({ ...d, [i.key]: e.target.value }))} />
                  <button className="btn btn-sm">Save</button>
                </form>
              ))}
          </div>
        ))}
        <label className="field">Notes for the customer and the team
          <textarea rows={3} value={notes} disabled={locked} maxLength={4000} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Router moved to the hallway; the motor needs a 20 A breaker." />
        </label>
        {!locked && notes !== r.notes && <button className="btn btn-sm" disabled={busy} onClick={() => void run(async () => setR(await put<InstallReport>(base, { notes })))}>Save notes</button>}
      </section>

      <section className="card card-pad stack">
        <div className="spread"><h3 style={{ margin: 0 }}>Photos</h3><span className="small muted">Boards in their boxes, the DB, finished switch plates</span></div>
        <Photos r={r} onDelete={locked ? undefined : (id) => void run(async () => setR(await del<InstallReport>(`${base}/photos/${id}`)))} />
        {!locked && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={140} placeholder="Caption (optional)" style={{ flex: '1 1 200px' }} />
            <label className="btn">
              <Icon name="plus" size={14} />{uploading ? 'Uploading…' : 'Add photo'}
              <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden disabled={uploading}
                     onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
            </label>
          </div>
        )}
      </section>

      <section className="card card-pad stack">
        <h3 style={{ margin: 0 }}>Customer sign-off</h3>
        {r.signed ? (
          <>
            <Signed r={r} />
            {r.canReopen && <button className="btn btn-sm" disabled={busy} onClick={() => confirm('Open the report again? The signature is removed and the customer signs again.') && void run(async () => setR(await post<InstallReport>(`${base}/reopen`)))}>Open again</button>}
          </>
        ) : !r.canEdit ? <p className="small muted">The installer gets the customer to sign when the work is done.</p>
          : shown.done < r.total || waiting.length > 0 ? <p className="small muted">{waiting.length ? 'Send the ticks saved on this phone first (you need signal).' : 'Tick every item first, then hand the phone to the customer to sign. The owner can also sign from their own app.'}</p>
          : <SignOff defaultName="" onSign={async (name, signature) => setR(await post<InstallReport>(`${base}/sign`, { name, signature }))} />}
      </section>
    </div>
  );
}
