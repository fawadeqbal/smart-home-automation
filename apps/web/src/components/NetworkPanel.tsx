'use client';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { errorText, get, post } from '@/lib/api';
import { timeAgo, useNow } from '@/lib/hooks';
import { useLive } from '@/lib/live';
import type { BoardNode } from '@/lib/types';
import { isBehind } from '@/lib/version';
import { Tip } from './Help';
import { Icon } from './Icon';
import { Loader, Spinner } from './Loader';
import { Confirm, ErrorBox, Modal, useAction } from './ui';

interface Seen { ssid: string; rssi: number; channel: number; secure: boolean }
interface NetInfo { scan?: Seen[]; scanAt?: string; result?: { ok: boolean; ssid: string; message: string }; resultAt?: string }
type Pick = (Seen & { manual?: false }) | { manual: true };

const ago = (at?: string | null) => (at && Date.now() - new Date(at).getTime() < 10_000 ? 'just now' : timeAgo(at ?? null));

/* ------------------------------------------------------------ signal words */

const LEVELS = [
  { word: 'Very weak', tone: 'bad', advice: 'The board will keep dropping out. Move the router closer or add a Wi‑Fi extender near this switchboard.' },
  { word: 'Weak', tone: 'warn', advice: 'Switching can lag or fail now and then. A Wi‑Fi extender near this switchboard fixes it.' },
  { word: 'Fair', tone: 'warn', advice: 'Works, but walls or a busy evening can make it slower. Fine for most homes.' },
  { word: 'Good', tone: 'ok', advice: 'Strong enough for instant, reliable switching.' },
  { word: 'Excellent', tone: 'ok', advice: 'Strong enough for instant, reliable switching.' },
] as const;
const level = (rssi?: number | null) => (rssi === undefined || rssi === null ? 0 : rssi > -55 ? 4 : rssi > -67 ? 3 : rssi > -75 ? 2 : rssi > -85 ? 1 : 0);

function Bars({ rssi, size = '' }: { rssi?: number | null; size?: '' | 'lg' }) {
  const b = level(rssi);
  const tone = LEVELS[b]!.tone;
  return (
    <span className={`bars ${size} ${tone === 'ok' ? '' : tone}`} role="img" aria-label={`${LEVELS[b]!.word} signal`}>
      {[1, 2, 3, 4].map((i) => <i key={i} className={i <= b ? 'on' : ''} />)}
    </span>
  );
}

/** Where the signal sits between "unusable" (−90 dBm) and "next to the router" (−30 dBm). */
function SignalMeter({ rssi }: { rssi: number }) {
  const pos = Math.max(0, Math.min(1, (rssi + 90) / 60)) * 100;
  return (
    <div className="sig-meter" aria-hidden>
      <div className="sig-track"><i style={{ left: `${pos}%` }} /></div>
      <div className="sig-scale"><span>Weak</span><span>Fair</span><span>Good</span><span>Excellent</span></div>
    </div>
  );
}

function Copy({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="net-copy" title={`Copy ${label}`} aria-label={`Copy ${label}`}
      onClick={async () => { try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1400); } catch { /* ignore */ } }}>
      <Icon name={done ? 'check' : 'copy'} size={12} />
    </button>
  );
}

/* ---------------------------------------------------------- path diagram */

/** Board → access point → router → server, with what the board reported for each hop. */
function NetPath({ node }: { node: BoardNode }) {
  const h = node.health;
  const live = node.online;
  const hops: { icon: string; title: string; main: React.ReactNode; sub?: React.ReactNode; tip?: string }[] = [
    {
      icon: 'cpu', title: 'This board',
      main: node.ip ? <span className="mono">{node.ip}<Copy value={node.ip} label="IP address" /></span> : '—',
      sub: (h?.mac ?? node.mac) ? <span className="mono">{h?.mac ?? node.mac}<Copy value={(h?.mac ?? node.mac)!} label="MAC address" /></span> : undefined,
      tip: 'Its address on the home network (from the router; can change after a restart) and its hardware MAC — give that MAC a fixed IP in the router if you need one.',
    },
    {
      icon: 'wifi', title: 'Access point',
      main: h?.bssid ? <span className="mono">{h.bssid}</span> : '—',
      sub: h?.channel ? `channel ${h.channel} · 2.4 GHz` : undefined,
      tip: 'The exact router or Wi‑Fi extender the board joined (its hardware address). Two boards on different access points of the same network show different addresses here.',
    },
    { icon: 'router', title: 'Router', main: h?.gateway ? <span className="mono">{h.gateway}</span> : '—', sub: 'gateway' },
    {
      icon: 'map-pin', title: 'Internet',
      main: node.publicIp ? <span className="mono">{node.publicIp}<Copy value={node.publicIp} label="public IP" /></span> : '—',
      sub: [node.publicPlace, node.publicIsp].filter(Boolean).join(' · ') || undefined,
      tip: 'The home’s address on the internet, as the server sees it, with the provider’s city and name. Shared by everything in the house; it can change when the router restarts. History: Internet tab.',
    },
    { icon: 'server', title: 'Switchboard', main: live ? 'Connected' : 'No contact', sub: live ? `active ${timeAgo(node.lastSeenAt)}` : node.lastSeenAt ? `since ${timeAgo(node.lastSeenAt)}` : 'never' },
  ];
  return (
    <ol className={`net-path ${live ? 'is-up' : 'is-down'}`} aria-label="How the board reaches the server">
      {hops.map((x, i) => (
        <li key={x.title} className="net-hop">
          <span className={`net-hop-icon ${i === hops.length - 1 ? (live ? 'ok' : 'bad') : ''}`}><Icon name={x.icon} size={16} /></span>
          <span className="net-hop-text">
            <span className="net-hop-title">{x.title}{x.tip && <Tip>{x.tip}</Tip>}</span>
            <b>{x.main}</b>
            {x.sub && <span className="net-hop-sub">{x.sub}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/* ---------------------------------------------------------- switching */

function Switching({ ssid, since, from, onGiveUp }: { ssid: string; since: number; from?: string; onGiveUp: () => void }) {
  useNow(1000);
  const sec = Math.floor((Date.now() - since) / 1000);
  useEffect(() => { if (sec > 45) onGiveUp(); }, [sec, onGiveUp]);
  const steps = [
    { label: 'Sent to the board', done: true },
    { label: `Joining “${ssid}”`, done: false, active: true },
    { label: 'Back online', done: false },
  ];
  return (
    <div className="net-switch" role="status">
      <div className="spread">
        <b className="row" style={{ gap: 10 }}><Spinner size={16} />Moving to “{ssid}”</b>
        <span className="mono small muted">{Math.min(sec, 30)} / 30 s</span>
      </div>
      <div className="progress ac"><i style={{ width: `${Math.min(100, (sec / 30) * 100)}%`, transition: 'width 1s linear' }} /></div>
      <ol className="net-steps">
        {steps.map((s) => <li key={s.label} className={s.done ? 'done' : s.active ? 'active' : ''}><span>{s.done ? <Icon name="check" size={11} stroke={3} /> : null}</span>{s.label}</li>)}
      </ol>
      <span className="small muted">The board is briefly offline. If it can’t join, it goes back to “{from ?? 'its current network'}” by itself.</span>
    </div>
  );
}

/* ------------------------------------------------------------ join dialog */

function JoinDialog({ node, pick, current, onClose, onSent }: {
  node: BoardNode; pick: Pick; current?: string; onClose: () => void; onSent: (ssid: string) => void;
}) {
  const { busy, error, run } = useAction();
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState(false);
  const manual = pick.manual === true;
  const seen = manual ? null : pick;
  const needsPassword = manual ? !open : seen!.secure;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const ssid = manual ? String(f.get('ssid') ?? '').trim() : seen!.ssid;
    const password = needsPassword ? String(f.get('password') ?? '') : '';
    const ok = await run(() => post(`/nodes/${node.id}/wifi`, { ssid, password }));
    if (ok !== undefined) { onSent(ssid); onClose(); }
  }

  return (
    <Modal title={manual ? 'Join a hidden network' : `Move ${node.name} to this Wi‑Fi`} onClose={onClose} className="form-dialog">
      <form onSubmit={submit}>
        <div className="dialog-body">
          {seen && (
            <div className="net-pick">
              <span className="net-row-icon"><Bars rssi={seen.rssi} /></span>
              <span className="stack-tight grow">
                <b>{seen.ssid}</b>
                <span className="small muted">{seen.secure ? 'Password protected' : 'Open network'} · channel {seen.channel}</span>
              </span>
              <span className="stack-tight" style={{ alignItems: 'flex-end' }}>
                <b className={`fg-${LEVELS[level(seen.rssi)]!.tone}`}>{LEVELS[level(seen.rssi)]!.word}</b>
                <span className="small muted mono">{seen.rssi} dBm</span>
              </span>
            </div>
          )}
          {seen && level(seen.rssi) <= 1 && (
            <div className="advice warn" style={{ margin: 0 }}><span className="small">This network is weak where the board is. It may join, then keep dropping out.</span></div>
          )}
          {manual && (
            <label className="field">Network name (SSID)<input name="ssid" required maxLength={32} autoComplete="off" spellCheck={false} placeholder="Exactly as the router shows it" /></label>
          )}
          {needsPassword && (
            <label className="field">Wi‑Fi password
              <span className="pw-field">
                <input name="password" type={show ? 'text' : 'password'} required minLength={8} maxLength={63} autoComplete="new-password" spellCheck={false} autoFocus={!manual} />
                <button type="button" className="icon-btn" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} title={show ? 'Hide' : 'Show'}>
                  <Icon name={show ? 'eye-off' : 'eye'} size={15} />
                </button>
              </span>
            </label>
          )}
          {manual && (
            <label className="net-check"><input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} /> This network has no password</label>
          )}
          <ul className="net-promise">
            <li><Icon name="rotate" size={14} /><span>If it can’t join within 30 seconds, it goes back to <b>“{current ?? 'its current network'}”</b> by itself.</span></li>
            <li><Icon name="lock" size={14} /><span>The password goes only to the board. It isn’t stored or shown in this app.</span></li>
            <li><Icon name="wifi" size={14} /><span>Only 2.4 GHz networks work — a “5G” network won’t.</span></li>
          </ul>
          <ErrorBox error={error} />
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Move board'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ panel */

/** The board's Wi‑Fi: how it's connected, what it can hear, moving it to another network, starting over. */
export function NetworkPanel({ node }: { node: BoardNode }) {
  useNow(15_000);
  const [info, setInfo] = useState<NetInfo | null>(null);
  const [scanning, setScanning] = useState(false);
  const [pick, setPick] = useState<Pick | null>(null);
  const [switching, setSwitching] = useState<{ ssid: string; since: number } | null>(null);
  const [stale, setStale] = useState(false);
  const [hideResult, setHideResult] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scanTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const h = node.health;
  const current = h?.ssid;

  useEffect(() => {
    get<NetInfo>(`/nodes/${node.id}/network`).then(setInfo).catch((e) => setError(errorText(e)));
    return () => clearTimeout(scanTimer.current);
  }, [node.id]);

  useLive('node.network', (e: NetInfo & { nodeId: string }) => {
    if (e.nodeId !== node.id) return;
    setInfo(e);
    if (e.scan) { setScanning(false); clearTimeout(scanTimer.current); }
    if (e.result) { setSwitching(null); setStale(false); setHideResult(null); }
  });

  async function scan() {
    setError(null);
    setScanning(true);
    try {
      await post(`/nodes/${node.id}/wifi/scan`);
      scanTimer.current = setTimeout(() => setScanning(false), 15000); // give up waiting after 15 s
    } catch (e) {
      setScanning(false);
      setError(errorText(e));
    }
  }

  if (!info && !error) return <Loader label="Loading Wi‑Fi…" />;

  const lv = level(h?.rssi ?? node.rssi);
  const rssi = h?.rssi ?? node.rssi ?? undefined;
  const L = LEVELS[lv]!;
  const sorted = [...(info?.scan ?? [])].sort((a, b) => (b.ssid === current ? 1 : 0) - (a.ssid === current ? 1 : 0) || b.rssi - a.rssi);
  const sameChannel = h?.channel ? (info?.scan ?? []).filter((n) => n.channel === h.channel && n.ssid !== current).length : 0;
  const busy = !node.online || !!switching;
  const result = info?.result && hideResult !== info.resultAt ? info.result : null;

  return (
    <div className="stack net-panel">
      {/* --- status of a Wi‑Fi move */}
      {switching && <Switching ssid={switching.ssid} since={switching.since} from={current} onGiveUp={() => { setSwitching(null); setStale(true); }} />}
      {stale && (
        <div className="net-result warn" role="status">
          <span className="net-result-icon"><Icon name="clock" size={16} /></span>
          <span className="grow"><b>No answer from the board yet.</b> It may have joined and is reconnecting — check back in a minute.</span>
          <button className="icon-btn" onClick={() => setStale(false)} aria-label="Dismiss"><Icon name="x" size={15} /></button>
        </div>
      )}
      {result && !switching && (
        <div className={`net-result ${result.ok ? 'ok' : 'bad'}`} role="status">
          <span className="net-result-icon"><Icon name={result.ok ? 'check' : 'wifi-off'} size={16} /></span>
          <span className="grow">
            <b>{result.ok ? `Now on “${result.ssid}”` : `Couldn’t join “${result.ssid}”`}</b> — {result.message}
            {info?.resultAt && <span className="muted"> · {ago(info.resultAt)}</span>}
          </span>
          <button className="icon-btn" onClick={() => setHideResult(info?.resultAt ?? '')} aria-label="Dismiss"><Icon name="x" size={15} /></button>
        </div>
      )}

      {/* --- current connection */}
      <section className="panel">
        <div className="net-hero">
          <span className={`net-hero-icon ${node.online ? L.tone : 'off'}`}><Icon name={node.online ? 'wifi' : 'wifi-off'} size={24} /></span>
          <div className="net-hero-text">
            <span className="eyebrow">{node.online ? 'Connected to' : 'Last connected to'}</span>
            <h2>{current ?? (node.online ? 'Waiting for its next report' : 'Unknown network')}</h2>
            <span className="small muted">
              {node.online
                ? current ? `${L.word} signal · 2.4 GHz${h?.channel ? ` · channel ${h.channel}` : ''}` : 'Network details arrive with the board’s next health report (every minute, firmware 2.1+).'
                : `The board is offline — last heard ${timeAgo(node.lastSeenAt)}. Check its power and the router.`}
            </span>
          </div>
          {node.online && rssi !== undefined && (
            <div className="net-hero-signal">
              <div className="row" style={{ gap: 10, justifyContent: 'flex-end' }}>
                <Bars rssi={rssi} size="lg" />
                <span className="net-dbm"><b>{rssi}</b> dBm</span>
              </div>
              <SignalMeter rssi={rssi} />
            </div>
          )}
        </div>
        {node.online && rssi !== undefined && (
          <div className={`net-advice ${L.tone}`}>
            <Icon name={L.tone === 'ok' ? 'check' : 'alert-triangle'} size={15} />
            <span>{L.advice}{sameChannel >= 2 && lv <= 2 ? ` ${sameChannel} other networks share channel ${h?.channel} — moving the router to channel 1, 6 or 11 (whichever is quietest) can help.` : ''}</span>
          </div>
        )}
        <NetPath node={node} />
      </section>

      {/* --- nearby networks */}
      <section className="panel">
        <div className="panel-head">
          <span className="stack-tight grow">
            <b>Nearby networks</b>
            <span className="net-sub">{info?.scanAt ? `What the board heard ${ago(info.scanAt)}` : 'What the board can hear from where it is'} · 2.4 GHz only</span>
          </span>
          <button className="btn btn-sm" onClick={() => void scan()} disabled={busy || scanning} title={!node.online ? 'The board is offline' : undefined}>
            {scanning ? <><Spinner size={13} />Scanning…</> : <><Icon name="rotate" size={14} />{sorted.length ? 'Scan again' : 'Scan'}</>}
          </button>
        </div>

        {scanning && sorted.length === 0 ? (
          <div className="net-rows" aria-busy>
            {[0, 1, 2].map((i) => <div key={i} className="net-row skeleton"><i /><span><i /><i /></span></div>)}
          </div>
        ) : sorted.length === 0 ? (
          <div className="net-empty">
            <span className="net-empty-icon"><Icon name="wifi" size={22} /></span>
            <b>See which Wi‑Fi this board can hear</b>
            <span className="small muted">Useful after changing the router, or to find out if an extender would help. Takes about 5 seconds.</span>
            <button className="btn btn-primary" onClick={() => void scan()} disabled={busy}>{!node.online ? 'Board offline' : 'Scan for networks'}</button>
          </div>
        ) : (
          <div className={`net-rows ${scanning ? 'refreshing' : ''}`}>
            {sorted.map((n) => {
              const isCurrent = n.ssid === current;
              const l = LEVELS[level(n.rssi)]!;
              return (
                <div key={`${n.ssid}-${n.channel}`} className={`net-row ${isCurrent ? 'current' : ''}`}>
                  <span className="net-row-icon"><Bars rssi={n.rssi} /></span>
                  <span className="net-row-main">
                    <b className="truncate">{n.ssid || <span className="muted">(hidden name)</span>}</b>
                    <span className="small muted row" style={{ gap: 6 }}>
                      {n.secure ? <><Icon name="lock" size={11} />Secured</> : 'Open'} · ch {n.channel}
                      {isCurrent && <span className="badge ok">Connected</span>}
                    </span>
                  </span>
                  <span className="net-row-signal">
                    <b className={`fg-${l.tone}`}>{l.word}</b>
                    <span className="mono">{n.rssi} dBm</span>
                  </span>
                  <span className="net-row-action">
                    {!isCurrent && <button className="btn btn-sm" disabled={busy || !n.ssid} onClick={() => setPick(n)}>Join</button>}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <div className="net-foot">
          <button className="link-btn" disabled={busy} onClick={() => setPick({ manual: true })}>Network not listed? Join a hidden network</button>
        </div>
      </section>

      {/* --- start over */}
      <section className="panel net-reset">
        <span className="net-reset-icon"><Icon name="rotate" size={17} /></span>
        <span className="grow stack-tight" style={{ gap: 4, lineHeight: 1.45 }}>
          <b>Start Wi‑Fi setup again</b>
          <span className="small muted">
            For a new router or a changed Wi‑Fi password the board can’t see. It forgets its Wi‑Fi and opens its own hotspot <span className="mono net-chip">HomeNode‑{node.id.replace('esp-', '')}</span> — finish setup from a phone next to the board.
            {' '}No app, or the board is offline? {isBehind(node.firmware, '2.3.0')
              ? <>Press and release <b>RST</b>. When the blue light starts blinking fast, press and hold <b>FLASH</b> until it stops (you have 3 seconds). Don’t hold FLASH while pressing RST: that starts the chip’s programming mode — press RST again to get out. (Firmware 2.3.0 makes this a simple 5‑second press.)</>
              : <>Hold the board’s <b>FLASH</b> button for 5 seconds: the blue light blinks fast, then stays on. Let go — the hotspot opens.</>}
          </span>
        </span>
        <button className="btn btn-danger" onClick={() => setResetting(true)} disabled={!node.online}>Forget Wi‑Fi…</button>
      </section>

      <ErrorBox error={error} />

      {pick && (
        <JoinDialog node={node} pick={pick} current={current} onClose={() => setPick(null)}
          onSent={(ssid) => { setStale(false); setSwitching({ ssid, since: Date.now() }); }} />
      )}
      {resetting && (
        <Confirm title={`Make ${node.name} forget its Wi‑Fi?`} confirmLabel="Forget Wi‑Fi" onClose={() => setResetting(false)}
          onConfirm={() => post(`/nodes/${node.id}/wifi/reset`)}
          body={<>
            It restarts as the hotspot <b className="mono">HomeNode‑{node.id.replace('esp-', '')}</b> and stays <b>offline</b> — its devices can’t be switched from the app —
            until someone near the board joins that hotspot with a phone and picks a Wi‑Fi. Wall buttons keep working.
          </>} />
      )}
    </div>
  );
}
