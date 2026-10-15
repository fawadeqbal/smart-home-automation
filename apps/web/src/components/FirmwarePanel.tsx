'use client';
import { DragEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { del, errorText, get, post } from '@/lib/api';
import { timeAgo, useNow } from '@/lib/hooks';
import { useLive } from '@/lib/live';
import { useSession } from '@/lib/session';
import type { BoardNode } from '@/lib/types';
import { compareVersions as compare, inspectFirmware, likelyVersions } from '@/lib/version';
import { Tip } from './Help';
import { Icon } from './Icon';
import { Loader, Spinner } from './Loader';
import { Badge, Confirm, ErrorBox, Modal, useAction } from './ui';

interface Image { id: string; version: string; notes: string; size: number; md5: string; createdAt: string }

/** Updates over Wi‑Fi need this firmware (or newer) on the board. */
const OTA_FROM = '2.2';

const kb = (bytes: number) => `${Math.round(bytes / 1024).toLocaleString()} KB`;

/* ------------------------------------------------------------- progress */

type Stage = 'sent' | 'restarting' | 'done' | 'failed';

function Progress({ version, stage, since, error, failedAt, onClose, onDeleteBuild }: {
  version: string; stage: Stage; since: number; error?: string; failedAt?: Stage; onClose: () => void;
  /** offered when the board came back on another version: the build was labelled wrong */
  onDeleteBuild?: () => void;
}) {
  useNow(1000);
  const sec = Math.floor((Date.now() - since) / 1000);
  // a failure after the restart (wrong version came back) means downloading and restarting worked
  const late = stage === 'failed' && failedAt === 'restarting';
  const steps: { label: string; state: 'done' | 'active' | 'todo' | 'bad' }[] = [
    { label: 'Sent to the board', state: 'done' },
    { label: 'Downloading & checking', state: stage === 'sent' ? 'active' : stage === 'failed' && !late ? 'bad' : 'done' },
    { label: 'Restarting', state: stage === 'restarting' ? 'active' : stage === 'done' || late ? 'done' : 'todo' },
    { label: `Running ${version}`, state: stage === 'done' ? 'done' : late ? 'bad' : 'todo' },
  ];
  const finished = stage === 'done' || stage === 'failed';
  return (
    <div className={`fw-progress ${stage}`} role="status">
      <div className="spread">
        <b className="row" style={{ gap: 10 }}>
          {finished ? <Icon name={stage === 'done' ? 'check' : 'alert-triangle'} size={16} /> : <Spinner size={16} />}
          {stage === 'done' ? `Updated to ${version}` : stage === 'failed' ? `Update to ${version} failed` : `Updating to ${version}…`}
        </b>
        {finished
          ? <button className="icon-btn" onClick={onClose} aria-label="Dismiss"><Icon name="x" size={15} /></button>
          : <span className="mono small muted">{sec} s · usually 30–60 s</span>}
      </div>
      {!finished && <div className="progress ac"><i style={{ width: `${Math.min(95, (sec / 60) * 100)}%`, transition: 'width 1s linear' }} /></div>}
      <ol className="net-steps">
        {steps.map((s) => (
          <li key={s.label} className={s.state}>
            <span>{s.state === 'done' ? <Icon name="check" size={11} stroke={3} /> : s.state === 'bad' ? <Icon name="x" size={10} stroke={3} /> : null}</span>{s.label}
          </li>
        ))}
      </ol>
      {late && onDeleteBuild && (
        <div className="row"><button className="btn btn-sm" onClick={onDeleteBuild}><Icon name="trash" size={14} />Delete the mislabelled {version} build</button></div>
      )}
      <span className="small">
        {stage === 'failed' && late ? <>The board {error}. Export the build again after raising <span className="mono">FIRMWARE_VERSION</span>, and upload that file.</>
          : stage === 'failed' ? <>The board said: <b>{error}</b>. It keeps running its old firmware.</>
          : stage === 'done' ? 'The board restarted on the new firmware. Its devices and pins are unchanged.'
          : 'Keep the board powered. Lights keep their last state; the board is offline for a few seconds while it restarts.'}
      </span>
    </div>
  );
}

/* --------------------------------------------------------------- upload */

function UploadDialog({ onClose, onDone, latest, existing }: { onClose: () => void; onDone: () => void; latest?: string; existing: string[] }) {
  const { busy, error, setError, run } = useAction();
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState('');
  /** the version compiled into the file: undefined = not read yet, null = an older build without the stamp */
  const [stamped, setStamped] = useState<string | null | undefined>(undefined);
  const [inside, setInside] = useState<string[]>([]);
  // an older build without the stamp, typed as a version it doesn't contain: it's the wrong file
  const notThisVersion = !stamped && !!version && inside.length > 0 && !inside.includes(version);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  function choose(f: File | undefined | null) {
    setError(null);
    if (!f) return;
    if (!/\.bin$/i.test(f.name)) { setError('Choose the .bin file that Arduino exported.'); return; }
    setFile(f);
    setStamped(undefined);
    setInside([]);
    void inspectFirmware(f).then(({ stamped: v, strings }) => {
      setStamped(v);
      setInside(strings);
      if (v) setVersion(v);
    }).catch(() => setStamped(null));
  }
  function drop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    choose(e.dataTransfer.files?.[0]);
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) { setError('Choose the .bin file first.'); return; }
    const form = new FormData(e.currentTarget);
    form.set('file', file);
    const ok = await run(() => post('/firmware', form));
    if (ok !== undefined) { onDone(); onClose(); }
  }

  return (
    <Modal title="Upload a firmware build" sub="Uploaded once, it can be installed on any board of your organization." onClose={onClose} className="form-dialog">
      <form onSubmit={submit}>
        <div className="dialog-body">
          <div className={`fw-drop ${over ? 'over' : ''} ${file ? 'has' : ''}`} role="button" tabIndex={0}
            onClick={() => input.current?.click()} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
            <input ref={input} type="file" accept=".bin,application/octet-stream" hidden onChange={(e) => choose(e.target.files?.[0])} />
            <span className="fw-drop-icon"><Icon name={file ? 'file-text' : 'download'} size={20} /></span>
            {file ? (
              <span className="stack-tight" style={{ alignItems: 'center' }}>
                <b className="mono">{file.name}</b>
                <span className="small muted">{kb(file.size)} · click to choose another</span>
              </span>
            ) : (
              <span className="stack-tight" style={{ alignItems: 'center' }}>
                <b>Drop the .bin file here, or click to choose</b>
                <span className="small muted">Raise <span className="mono">FIRMWARE_VERSION</span> in config.h, then Arduino: <b>Sketch → Export Compiled Binary</b> → <span className="mono">build/…/home_node.ino.bin</span></span>
              </span>
            )}
          </div>
          <div className="form-grid">
            <label className="field">Version {stamped ? <span className="hint">read from the file</span> : null}
              <input name="version" required value={version} readOnly={!!stamped} onChange={(e) => setVersion(e.target.value)}
                placeholder={stamped === null ? 'FIRMWARE_VERSION from config.h' : latest ? `newer than ${latest}` : '2.2.1'} pattern="[\w.\-+]{1,40}" spellCheck={false} />
            </label>
            <label className="field">What changed <span className="hint">optional</span>
              <input name="notes" maxLength={300} placeholder="Faster Wi‑Fi reconnect" />
            </label>
          </div>
          {file && stamped === null && (
            <div className="advice warn" style={{ margin: 0 }}>
              <span className="small">This file has no version stamp (built from older firmware code). Type <b>exactly</b> the <span className="mono">FIRMWARE_VERSION</span> from <span className="mono">config.h</span> it was built with — that is the number the board reports after installing it. Builds from the current code fill this in by themselves.</span>
            </div>
          )}
          {notThisVersion ? (
            <div className="advice bad" style={{ margin: 0 }}>
              <span className="small"><b>This file isn’t firmware {version}.</b> It looks like an older build ({likelyVersions(inside, version).join(' or ')}), and boards would keep reporting that number. Upload the file Arduino just exported: <span className="mono">firmware/home_node/build/…/home_node.ino.bin</span>.</span>
            </div>
          ) : stamped && existing.includes(stamped) ? (
            <div className="advice warn" style={{ margin: 0 }}>
              <span className="small">A build numbered {stamped} is already in the list. If that one was an older file uploaded under this number, this file replaces it; if it really is {stamped}, raise <span className="mono">FIRMWARE_VERSION</span> for a new build.</span>
            </div>
          ) : version && existing.includes(version) && !stamped ? (
            <div className="advice bad" style={{ margin: 0 }}>
              <span className="small"><b>{version} is already uploaded.</b> A new build needs a new number: raise <span className="mono">FIRMWARE_VERSION</span> in <span className="mono">config.h</span>, export again and upload that file.</span>
            </div>
          ) : latest && version && compare(version, latest) <= 0 ? (
            <div className="advice warn" style={{ margin: 0 }}><span className="small">This is older than {latest}, the newest build. It will be listed as a roll-back version.</span></div>
          ) : null}
          <ErrorBox error={error} />
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !file || stamped === undefined || notThisVersion || (!stamped && existing.includes(version))}>{busy ? 'Uploading…' : 'Upload'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------------------------------------------------------- panel */

/** Firmware tab: what the board runs, the build library, and updating over Wi‑Fi. */
export function FirmwarePanel({ node }: { node: BoardNode }) {
  useNow(30_000);
  const { staffRole } = useSession();
  const canManage = staffRole === 'SUPERADMIN';
  const [images, setImages] = useState<Image[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [job, setJob] = useState<{ version: string; stage: Stage; since: number; error?: string; failedAt?: Stage } | null>(null);
  const [asking, setAsking] = useState<Image | null>(null);
  const [removing, setRemoving] = useState<Image | null>(null);
  const [uploading, setUploading] = useState(false);
  const load = () => get<Image[]>('/firmware').then(setImages).catch((e) => setLoadError(errorText(e)));
  useEffect(() => { void load(); }, []);
  useLive('firmware.changed', () => void load());       // someone uploaded or deleted a build

  // the board reports the download result, then restarts and announces its new version
  useLive('node.network', (e: { nodeId: string; ota?: { ok: boolean; version: string; message: string } }) => {
    if (e.nodeId !== node.id || !e.ota) return;
    setJob((j) => j && { ...j, stage: e.ota!.ok ? 'restarting' : 'failed', error: e.ota!.message, failedAt: e.ota!.ok ? undefined : j.stage });
  });
  useEffect(() => {
    if (job && job.stage !== 'done' && job.stage !== 'failed' && node.firmware === job.version) setJob({ ...job, stage: 'done' });
  }, [node.firmware, job]);
  useEffect(() => {
    // no word for 3 minutes: stop the spinner
    if (!job || job.stage === 'done' || job.stage === 'failed') return;
    const t = setTimeout(() => setJob((j) => j && j.stage !== 'done' ? { ...j, stage: 'failed', error: 'no answer from the board within 3 minutes' } : j), 180_000);
    return () => clearTimeout(t);
  }, [job]);

  if (!images && !loadError) return <Loader label="Loading firmware…" />;

  const list = images ?? [];
  const sorted = [...list].sort((a, b) => compare(b.version, a.version) || b.createdAt.localeCompare(a.createdAt));
  const latest = sorted[0];
  const running = node.firmware;
  const otaOk = !running || compare(running, OTA_FROM) >= 0;
  const behind = !!(latest && running && compare(latest.version, running) > 0);
  const free = node.health?.freeSketchKb;
  const used = node.health?.sketchKb;
  const busy = !!job && job.stage !== 'done' && job.stage !== 'failed';
  const blocked = !node.online ? 'The board is offline' : !otaOk ? `Needs firmware ${OTA_FROM} or newer on the board` : busy ? 'An update is running' : null;

  const state = !running
    ? { tone: 'mute' as const, icon: 'cpu', badge: 'Unknown', text: 'The board hasn’t reported its firmware yet.' }
    : !latest
      ? { tone: 'mute' as const, icon: 'cpu', badge: 'No builds yet', text: canManage ? 'Upload a build below to update boards over Wi‑Fi.' : 'A super admin uploads builds; then you can install them here.' }
      : behind
        ? { tone: 'warn' as const, icon: 'download', badge: 'Update available', text: `${latest.version} is the newest build${latest.notes ? ` — ${latest.notes}` : ''}.` }
        : { tone: 'ok' as const, icon: 'check', badge: 'Up to date', text: `This is the newest build in your library.` };

  async function install(img: Image) {
    const r = await post<{ version: string; url: string }>(`/nodes/${node.id}/update`, { firmwareId: img.id });
    setJob({ version: r.version, stage: 'sent', since: Date.now() });
  }

  return (
    <div className="stack">
      {job && (
        <Progress {...job} onClose={() => setJob(null)}
          onDeleteBuild={canManage && list.some((i) => i.version === job.version) ? () => setRemoving(list.find((i) => i.version === job.version)!) : undefined} />
      )}

      {/* --- what the board runs */}
      <section className="panel">
        <div className="fw-hero">
          <span className={`fw-hero-icon ${state.tone}`}><Icon name={state.icon} size={22} /></span>
          <div className="fw-hero-text">
            <span className="eyebrow">This board runs</span>
            <div className="row" style={{ gap: 10 }}>
              <h2 className="mono">{running ?? '—'}</h2>
              <Badge tone={state.tone === 'mute' ? 'mute' : state.tone}>{state.badge}</Badge>
            </div>
            <span className="small muted">{state.text}</span>
          </div>
          {behind && latest && (
            <div className="fw-hero-action">
              <button className="btn btn-primary" disabled={!!blocked} title={blocked ?? undefined} onClick={() => setAsking(latest)}>
                <Icon name="download" size={15} />Install {latest.version}
              </button>
              {blocked && <span className="small muted">{blocked}</span>}
            </div>
          )}
        </div>
        {!otaOk && (
          <div className="net-advice warn">
            <Icon name="alert-triangle" size={15} />
            <span>Updates over Wi‑Fi start with firmware {OTA_FROM}. Flash this board once with a USB cable (Arduino → Upload); after that every update is over Wi‑Fi.</span>
          </div>
        )}
        <dl className="fw-facts">
          <div><dt>Flash used <Tip>Space taken by the running firmware.</Tip></dt><dd>{used ? `${used.toLocaleString()} KB` : '—'}</dd></div>
          <div><dt>Free for updates <Tip>An update is downloaded next to the running firmware, so a build must fit in this space.</Tip></dt>
            <dd className={free !== undefined && latest && latest.size / 1024 > free ? 'fg-bad' : ''}>{free !== undefined ? `${free.toLocaleString()} KB` : '—'}</dd></div>
          <div><dt>Last restart</dt><dd>{node.health?.reset ?? '—'}</dd></div>
          <div><dt>Over Wi‑Fi</dt><dd>{otaOk ? 'Supported' : `Needs ${OTA_FROM}+`}</dd></div>
        </dl>
      </section>

      {/* --- library */}
      <section className="panel">
        <div className="panel-head">
          <span className="stack-tight grow">
            <b>Firmware builds</b>
            <span className="net-sub">Shared by every board in your organization · newest first</span>
          </span>
          {canManage && <button className="btn btn-sm" onClick={() => setUploading(true)}><Icon name="plus" size={14} />Upload build</button>}
        </div>
        {sorted.length === 0 ? (
          <div className="net-empty">
            <span className="net-empty-icon"><Icon name="package" size={22} /></span>
            <b>No firmware builds yet</b>
            <span className="small muted">
              {canManage ? 'Export the .bin from Arduino and upload it once — then install it on any board in a click.' : 'A super admin uploads firmware builds. They appear here, ready to install.'}
            </span>
            {canManage && <button className="btn btn-primary" onClick={() => setUploading(true)}>Upload a build</button>}
          </div>
        ) : (
          <div className="fw-rows">
            {sorted.map((img) => {
              const isRunning = img.version === running;
              const isLatest = img.id === latest?.id;
              const older = running ? compare(img.version, running) < 0 : false;
              const tooBig = free !== undefined && img.size / 1024 > free;
              return (
                <div key={img.id} className={`fw-row ${isRunning ? 'current' : ''}`}>
                  <span className="fw-row-icon"><Icon name={isRunning ? 'cpu' : 'package'} size={16} /></span>
                  <span className="fw-row-main">
                    <span className="row" style={{ gap: 8 }}>
                      <b className="mono">{img.version}</b>
                      {isLatest && <Badge tone="info">Newest</Badge>}
                      {isRunning && <Badge tone="ok">On this board</Badge>}
                    </span>
                    <span className="small muted truncate">{img.notes || 'No notes'}</span>
                  </span>
                  <span className="fw-row-meta">
                    <span>{kb(img.size)}{tooBig && <b className="fg-bad"> · too big</b>}</span>
                    <span className="muted" title={`MD5 ${img.md5}`}>{timeAgo(img.createdAt)}</span>
                  </span>
                  <span className="fw-row-action">
                    {!isRunning && (
                      <button className={`btn btn-sm ${isLatest && behind ? 'btn-primary' : ''}`} disabled={!!blocked || tooBig}
                        title={blocked ?? (tooBig ? 'Doesn’t fit in the board’s free space' : undefined)} onClick={() => setAsking(img)}>
                        {older ? 'Roll back' : 'Install'}
                      </button>
                    )}
                    {canManage && (
                      <button className="icon-btn danger" aria-label={`Delete ${img.version}`} title="Delete this build" onClick={() => setRemoving(img)}><Icon name="trash" size={15} /></button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <div className="fw-foot">
          <Icon name="server" size={14} />
          <span>Boards download builds from this server on port 4000 — allow it once in Windows Firewall (like port 1883). If boards can’t reach it, set <span className="mono">PUBLIC_API_URL</span> in .env.</span>
        </div>
      </section>

      <ErrorBox error={loadError} />

      {asking && (
        <Confirm title={`${running && compare(asking.version, running) < 0 ? 'Roll back' : 'Update'} ${node.name} to ${asking.version}?`}
          confirmLabel={`Install ${asking.version}`} danger={false} onClose={() => setAsking(null)} onConfirm={() => install(asking)}
          body={
            <ul className="net-promise">
              <li><Icon name="download" size={14} /><span>The board downloads the build over Wi‑Fi, checks it, installs it and restarts — about <b>30–60 seconds</b>.</span></li>
              <li><Icon name="lightbulb" size={14} /><span>Lights keep their last state. Its devices, pins and Wi‑Fi stay as they are.</span></li>
              <li><Icon name="alert-triangle" size={14} /><span>Don’t unplug the board meanwhile. If the download fails, it keeps running <b>{running ?? 'its current firmware'}</b>.</span></li>
            </ul>
          } />
      )}
      {removing && (
        <Confirm title={`Delete firmware ${removing.version}?`} confirmLabel="Delete build" onClose={() => setRemoving(null)}
          onConfirm={async () => { await del(`/firmware/${removing.id}`); await load(); }}
          body="It disappears from the library for every board. Boards already running it keep running it." />
      )}
      {uploading && <UploadDialog latest={sorted[0]?.version} existing={list.map((i) => i.version)} onClose={() => setUploading(false)} onDone={() => void load()} />}
    </div>
  );
}
