'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { AddStockDialog } from '@/components/console/Dialogs';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { useCrumbs } from '@/components/Shell';
import { Badge, Confirm, Empty, ErrorBox, FirmwareCell, FormModal, PageHead, useAction } from '@/components/ui';
import { del, post } from '@/lib/api';
import { useLoad } from '@/lib/hooks';
import { useLive } from '@/lib/live';
import { useSession } from '@/lib/session';
import type { Inventory, InventoryBoard, Tone } from '@/lib/types';
import '@/components/service/service.css';

type Filter = 'all' | 'STOCK' | 'ASSIGNED' | 'ADOPTED' | 'FAULTY';
const STATUS: Record<InventoryBoard['status'], [string, Tone]> = { STOCK: ['In stock', 'info'], ASSIGNED: ['Assigned', 'warn'], ADOPTED: ['Installed', 'ok'], FAULTY: ['Faulty', 'bad'] };

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export default function InventoryPage() {
  const params = useSearchParams();
  const { staffRole } = useSession();
  const canEdit = staffRole === 'SUPERADMIN';
  const { data, error, reload } = useLoad<Inventory>('/platform/inventory');
  const [filter, setFilter] = useState<Filter>(params.get('home') ? 'STOCK' : 'all');
  const [sel, setSel] = useState<string | null>(params.get('board'));
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [faulty, setFaulty] = useState<InventoryBoard | null>(null);
  const [retire, setRetire] = useState<InventoryBoard | null>(null);
  const [assignHome, setAssignHome] = useState(params.get('home') ?? '');
  const [assignInstaller, setAssignInstaller] = useState('');
  const [assigned, setAssigned] = useState<string | null>(null);
  const { busy, error: actionError, run } = useAction();
  useCrumbs([{ label: 'Platform', href: '/console' }, { label: 'Inventory' }]);
  useLive('inventory.changed', () => void reload());
  useLive('firmware.changed', () => void reload());

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.boards ?? []).filter((b) => (filter === 'all' || b.status === filter) &&
      (!term || [b.id, b.homeName ?? '', b.location ?? '', b.mac ?? '', b.installer ?? '', b.replacedBy?.id ?? '', b.replaced?.id ?? ''].some((v) => v.toLowerCase().includes(term))));
  }, [data, filter, q]);

  useEffect(() => {
    if (!data) return;
    if (!sel || !data.boards.some((b) => b.id === sel)) setSel(rows[0]?.id ?? data.boards[0]?.id ?? null);
  }, [data, rows, sel]);
  const board = data?.boards.find((b) => b.id === sel) ?? null;
  useEffect(() => {
    if (!data || !assignHome) return;
    setAssignInstaller(data.homes.find((h) => h.id === assignHome)?.installerId ?? '');
  }, [assignHome, data]);
  useEffect(() => { setAssigned(null); }, [sel]);

  if (!data) return error ? <div className="alert">{error}</div> : <Loader label="Loading inventory…" />;
  const count = (f: Filter) => data.boards.filter((b) => f === 'all' || b.status === f).length;
  const homeName = (id: string) => data.homes.find((h) => h.id === id)?.name ?? '';

  async function assign() {
    if (!board || !assignHome) return;
    const ok = await run(() => post(`/platform/inventory/${board.id}/assign`, { homeId: assignHome, installerId: assignInstaller || null }));
    if (ok !== undefined) {
      setAssigned(`${board.id} is assigned to ${homeName(assignHome)}.`);
      await reload();
      // next board in stock, so several can be assigned quickly
      const next = data!.boards.find((b) => b.status === 'STOCK' && b.id !== board.id);
      if (next && filter === 'STOCK') setSel(next.id);
    }
  }

  return (
    <div data-screen-label="Inventory">
      <PageHead
        eyebrow="Platform" title="Inventory" sub="Every board your organization owns — from the shelf to a switchboard."
        actions={canEdit && <button className="btn" onClick={() => setAdding(true)}><Icon name="plus" size={15} />Add boards to stock</button>}
      />
      {params.get('home') && filter === 'STOCK' && (
        <div className="notice mb16">Pick boards in stock and assign them to <b>{homeName(params.get('home')!)}</b>. <Link href={`/console/homes/${params.get('home')}?tab=boards`}>Back to the home</Link></div>
      )}
      {data.stock?.low && (
        <div className="banner warn" role="status">
          <span className="banner-led" />
          <span className="banner-text">
            <b>{data.stock.inStock === 0 ? 'No boards left in stock' : `Only ${data.stock.inStock} board${data.stock.inStock === 1 ? '' : 's'} in stock`}</b>
            <span>You asked to be warned below {data.stock.min}. Order more before the next installations{canEdit ? ', then add them to stock' : ''}.</span>
          </span>
          {canEdit && <Link className="btn btn-sm" href="/console/settings">Change the minimum</Link>}
        </div>
      )}
      <div className="kpis mb16" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
        {([['all', 'All boards', 'var(--mu)'], ['STOCK', 'In stock', 'var(--ac)'], ['ASSIGNED', 'Assigned', 'var(--on)'], ['ADOPTED', 'Installed', 'var(--ok)'], ['FAULTY', 'Faulty', 'var(--bad)']] as [Filter, string, string][]).map(([k, label, dot]) => (
          <button key={k} className={`kpi ${filter === k ? 'active' : ''} ${k === 'STOCK' && data.stock?.low ? 'stock-low' : ''}`} onClick={() => setFilter(k)} aria-pressed={filter === k}>
            <span className="kpi-label"><span style={{ width: 7, height: 7, borderRadius: 99, background: k === 'STOCK' && data.stock?.low ? 'var(--on)' : dot }} />{label}</span>
            <span className="kpi-value" style={{ fontSize: 22 }}>{count(k)}{k === 'STOCK' && !!data.stock?.min && <span className="kpi-unit"> / min {data.stock.min}</span>}</span>
          </button>
        ))}
      </div>

      {data.boards.length === 0 ? (
        <Empty action={canEdit && <button className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size={15} />Add boards to stock</button>}>
          No boards yet. Add boards by their ID; boards that are already online appear as soon as they are added.
        </Empty>
      ) : (
        <div className="grid-2-wide">
          <div className="stack" style={{ gap: 10, minWidth: 0 }}>
            <label className="input-icon" style={{ width: 'min(320px, 100%)' }}>
              <Icon name="search" size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Board ID, MAC, home, installer" aria-label="Filter boards" />
            </label>
            <div className="table-wrap">
              <table className="table" style={{ minWidth: 600 }}>
                <thead><tr>{['Board', 'Status', 'Home', 'Firmware', 'Added'].map((c) => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>
                  {rows.map((b) => {
                    const [label, tone] = STATUS[b.status];
                    return (
                      <tr key={b.id} className={`click ${sel === b.id ? 'selected' : ''}`} onClick={() => setSel(b.id)}>
                        <td><span className="stack-tight"><b className="mono" style={{ fontSize: 12.5, fontWeight: 500 }}>{b.id}</b><span className="cell-sub">{b.model}</span></span></td>
                        <td><Badge tone={tone}>{label}</Badge></td>
                        <td className="nowrap">
                          <span className="stack-tight"><span>{b.homeName ?? '—'}</span>
                            <span className="cell-sub">{b.waiting ? `${b.location} · waiting for a replacement` : b.status === 'ADOPTED' ? b.location : b.status === 'ASSIGNED' ? (b.installer ? `Installer ${b.installer}` : 'No installer')
                              : b.replacedBy ? `Replaced by ${b.replacedBy.id}` : b.status === 'FAULTY' ? 'Returned' : 'Shelf'}</span>
                          </span>
                        </td>
                        <td className="mono" style={{ fontSize: 12 }}><FirmwareCell version={b.firmware} latest={data.currentFirmware} old={b.firmwareOld} /></td>
                        <td className="muted nowrap">{b.added}</td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 24 }}>No boards here.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {board && (
            <aside className="side-panel">
              <div className="sp-head">
                <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
                  <span className="li-icon" style={{ width: 36, height: 36 }}><Icon name="cpu" size={18} /></span>
                  <span className="stack-tight"><b className="mono" style={{ fontSize: 15, fontWeight: 500 }}>{board.id}</b><span className="cell-sub">{board.model} · firmware {board.firmware ?? '—'}</span></span>
                </div>
                <span style={{ alignSelf: 'flex-start' }}><Badge tone={STATUS[board.status][1]}>{STATUS[board.status][0]}</Badge></span>
              </div>
              <dl>
                <dt>MAC</dt><dd className="mono" style={{ fontSize: 12 }}>{board.mac ?? '—'}</dd>
                <dt>Connection</dt><dd>{board.online ? <span className="fg-ok">Online</span> : `Offline · seen ${board.lastSeen}`}</dd>
                <dt>Home</dt><dd>{board.homeName ?? 'Not assigned'}</dd>
                <dt>Added</dt><dd>{new Date(board.addedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</dd>
                {board.note && <><dt>Note</dt><dd>{board.note}</dd></>}
                {board.replaced && <><dt>Replaced</dt><dd><button className="link-btn mono" onClick={() => setSel(board.replaced!.id)}>{board.replaced.id}</button> on {day(board.replaced.at)}</dd></>}
                {board.replacedBy && <><dt>Replaced by</dt><dd><button className="link-btn mono" onClick={() => setSel(board.replacedBy!.id)}>{board.replacedBy.id}</button>{board.replacedBy.at ? ` on ${day(board.replacedBy.at)}` : ''}</dd></>}
              </dl>
              <div className="sp-body">
                <ErrorBox error={actionError} />
                {assigned && <div className="ok-note">{assigned}</div>}
                {board.status === 'STOCK' && canEdit && (
                  <>
                    <b style={{ fontSize: 14 }}>Assign to a home</b>
                    <label className="field">Home
                      <select value={assignHome} onChange={(e) => setAssignHome(e.target.value)}>
                        <option value="">Choose a home…</option>
                        {data.homes.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                      </select>
                    </label>
                    <label className="field">Installer
                      <select value={assignInstaller} onChange={(e) => setAssignInstaller(e.target.value)}>
                        <option value="">The home’s installer{assignHome && !data.homes.find((h) => h.id === assignHome)?.installerId ? ' (none yet)' : ''}</option>
                        {data.installers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                      </select>
                    </label>
                    {(() => {
                      // picking someone other than the home's installer hands them the whole home (one installer per home)
                      const current = data.homes.find((h) => h.id === assignHome)?.installerId ?? null;
                      const picked = assignInstaller || current;
                      const name = (id: string | null) => data.installers.find((i) => i.id === id)?.name ?? 'someone else';
                      if (assignHome && assignInstaller && assignInstaller !== current) {
                        return <span className="small" style={{ lineHeight: 1.45 }}><b>{name(assignInstaller)}</b> becomes the installer of {homeName(assignHome)} and sees it in <b>My jobs</b>{current ? <> (instead of {name(current)})</> : null}.</span>;
                      }
                      return <span className="small muted" style={{ lineHeight: 1.45 }}>{picked ? <><b>{name(picked)}</b> sees this home in My jobs. </> : null}The board joins the home when it’s powered on site.</span>;
                    })()}
                    <button className="btn btn-primary btn-block" style={{ height: 38 }} disabled={!assignHome || busy} onClick={() => void assign()}>Assign board</button>
                    <div className="row">
                      <button className="btn btn-sm btn-ghost" onClick={() => setFaulty(board)}>Mark faulty</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setRetire(board)}>Returned to supplier</button>
                    </div>
                  </>
                )}
                {board.status === 'ASSIGNED' && (
                  <>
                    <span className="small" style={{ lineHeight: 1.45 }}>
                      {board.online ? <>Online and ready — <b>{board.installer ?? 'the installer'}</b> can install it at {board.homeName} now.</> : <>Waiting for <b>{board.installer ?? 'an installer'}</b> to install it at {board.homeName}.</>}
                    </span>
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <Link className="btn grow" href={`/console/homes/${board.homeId}?tab=boards`}>Open home</Link>
                      {canEdit && <button className="btn grow btn-danger" disabled={busy} onClick={() => void run(() => post(`/platform/inventory/${board.id}/unassign`)).then(() => reload())}>Back to stock</button>}
                    </div>
                  </>
                )}
                {board.status === 'ADOPTED' && (
                  <>
                    <span className="small" style={{ lineHeight: 1.45 }}>Installed in <b>{board.location}</b> · {board.devices} devices. <span className={`fg-${board.cond === 'ok' ? 'ok' : board.cond === 'warn' ? 'warn' : 'bad'}`} style={{ fontWeight: 500 }}>{board.condText}</span>.</span>
                    <div className="row" style={{ gap: 8 }}>
                      <Link className="btn btn-primary grow" href={`/console/homes/${board.homeId}/boards/${encodeURIComponent(board.id)}`}>Open board<Icon name="chevron-right" size={14} /></Link>
                      <Link className="btn grow" href={`/console/homes/${board.homeId}`}>Open {board.homeName}</Link>
                    </div>
                    {canEdit && <button className="btn btn-sm btn-ghost" onClick={() => setFaulty(board)}>Mark faulty (its devices wait for a replacement)</button>}
                  </>
                )}
                {board.status === 'FAULTY' && board.waiting && (
                  <>
                    <span className="small fg-bad" style={{ lineHeight: 1.45 }}>{board.note ?? 'Marked faulty.'} Still in <b>{board.homeName}</b>: its {board.devices} devices wait for a replacement board.</span>
                    <Link className="btn btn-primary btn-block" href={`/console/homes/${board.homeId}/boards/${encodeURIComponent(board.id)}`}><Icon name="repeat" size={14} />Replace it</Link>
                  </>
                )}
                {board.status === 'FAULTY' && !board.waiting && (
                  <>
                    <span className="small fg-bad" style={{ lineHeight: 1.45 }}>{board.note ?? 'Marked faulty.'}</span>
                    {canEdit && (
                      <div className="row" style={{ flexWrap: 'nowrap' }}>
                        <button className="btn grow" disabled={busy} onClick={() => void run(() => post(`/platform/inventory/${board.id}/restock`)).then(() => reload())}>Repaired · back to stock</button>
                        <button className="btn grow" onClick={() => setRetire(board)}>Returned to supplier</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </aside>
          )}
        </div>
      )}

      {adding && <AddStockDialog inv={data} onClose={() => setAdding(false)} onDone={() => void reload()} />}
      {faulty && (
        <FormModal title={`Mark ${faulty.id} faulty`} danger submitLabel="Mark faulty" onClose={() => setFaulty(null)}
          sub={faulty.status === 'ADOPTED' && faulty.devices > 0
            ? `It stays in ${faulty.homeName}, out of service: its ${faulty.devices} devices, wall buttons, timers and scenes are kept, waiting for a replacement board.`
            : 'It can’t be assigned until it is repaired.'}
          onSubmit={async (f) => { await post(`/platform/inventory/${faulty.id}/faulty`, { note: f.get('note') }); await reload(); }}>
          <label className="field">What’s wrong?<textarea name="note" rows={3} maxLength={300} placeholder="Relay on D1 stuck on." /></label>
        </FormModal>
      )}
      {retire && (
        <Confirm title={`Remove ${retire.id} from inventory?`} confirmLabel="Remove board"
          body="Use this when the board went back to the supplier or is thrown away. If it ever connects again, it can be added back by its ID."
          onConfirm={async () => { await del(`/platform/inventory/${retire.id}`); setSel(null); await reload(); }} onClose={() => setRetire(null)} />
      )}
    </div>
  );
}
