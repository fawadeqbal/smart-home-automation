'use client';
import { useCallback, useEffect, useState } from 'react';
import { errorText, get } from '@/lib/api';
import { timeAgo, useNow } from '@/lib/hooks';
import { useLive } from '@/lib/live';
import type { BoardNode, Tone } from '@/lib/types';
import { Tip } from './Help';
import { Icon } from './Icon';
import { Loader } from './Loader';
import { Badge, Empty, ErrorBox } from './ui';

type EndReason = 'clean' | 'closed' | 'timeout' | 'replaced' | 'error';

export interface ConnectionInfo {
  tracking: boolean;
  current: { ip: string; place: string | null; isp: string | null; ipSince: string | null; connectedSince: string | null } | null;
  stats: { connects24h: number; connects7d: number; ends7d: Record<EndReason, number>; addresses7d: number };
  history: {
    id: string; ip: string; place: string | null; isp: string | null; connectedAt: string; endedAt: string | null;
    endReason: EndReason | null; endNote: string | null; seconds: number; newAddress: boolean;
  }[];
}

/** How a connection ended, in words (same wording as the server's live log). */
export const ENDS: Record<EndReason, { label: string; why: string; tone: Tone; icon: string }> = {
  timeout: { label: 'Lost contact', why: 'The board stopped answering: power cut, or Wi‑Fi / internet down.', tone: 'warn', icon: 'wifi-off' },
  closed: { label: 'Connection cut', why: 'It dropped without a goodbye: the board reset, or the router or network cut it.', tone: 'warn', icon: 'zap' },
  clean: { label: 'Restarted on purpose', why: 'The board said goodbye first: an update, a Wi‑Fi change or a restart.', tone: 'info', icon: 'rotate' },
  replaced: { label: 'Short drop', why: 'It came straight back on a new connection.', tone: 'mute', icon: 'repeat' },
  error: { label: 'Closed by the server', why: 'The broker ended it.', tone: 'bad', icon: 'alert-triangle' },
};

export function span(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${m % 60} min`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'}${h % 24 ? ` ${h % 24} h` : ''}`;
}

const when = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    : d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
};

/** "Swabi, Khyber Pakhtunkhwa, PK · Pace Telecom" */
export const where = (place: string | null, isp: string | null) => [place, isp].filter(Boolean).join(' · ');

/** What the last week says about this connection, in one sentence (or nothing when it's steady). */
function verdict(info: ConnectionInfo): { tone: Tone; text: string } | null {
  const e = info.stats.ends7d;
  if (e.timeout >= 3) return { tone: 'warn', text: `Lost contact ${e.timeout} times this week. Check the board's power supply and the Wi‑Fi signal at the switchboard (Wi‑Fi tab).` };
  if (e.closed + e.timeout + e.replaced >= 6) return { tone: 'warn', text: `Dropped ${e.closed + e.timeout + e.replaced} times this week. The home's router or internet may be restarting or unstable.` };
  if (info.stats.addresses7d > 1) return { tone: 'info', text: `Used ${info.stats.addresses7d} different internet addresses this week: the home's router got a new address, or the board was briefly on another network (e.g. a phone hotspot).` };
  if (info.stats.connects7d > 0) return { tone: 'ok', text: 'Steady this week.' };
  return null;
}

/** A board's internet connection: where it reaches the server from, how long it's been up, and every recent connection. */
export function ConnectionPanel({ node }: { node: BoardNode }) {
  useNow(30_000);
  const [info, setInfo] = useState<ConnectionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const load = useCallback(() => get<ConnectionInfo>(`/nodes/${node.id}/connections`).then(setInfo).catch((e) => setError(errorText(e))), [node.id]);
  useEffect(() => { void load(); }, [load]);
  useLive('nodes.changed', (e: { nodeId: string }) => { if (e.nodeId === node.id) void load(); });
  useLive('node.status', (e: { nodeId: string }) => { if (e.nodeId === node.id) setTimeout(() => void load(), 2500); });

  if (!info) return error ? <ErrorBox error={error} /> : <Loader label="Loading the connection…" />;
  if (!info.tracking) {
    return <Empty>Connection history isn’t switched on for this server yet (the broker’s log isn’t shared with the API). See docs/ci-cd.md.</Empty>;
  }
  const cur = info.current;
  const v = verdict(info);
  const e = info.stats.ends7d;
  const shown = all ? info.history : info.history.slice(0, 12);
  const online = node.online && cur?.connectedSince;

  return (
    <div className="stack">
      <div className="conn-cards">
        <section className="panel panel-pad conn-card">
          <span className="eyebrow">Reaches the server from</span>
          {cur ? (
            <>
              <b className="conn-ip mono">{cur.ip}</b>
              <span className="conn-where"><Icon name="map-pin" size={14} />{cur.place ?? 'Place unknown'}</span>
              {cur.isp && <span className="small muted">{cur.isp}</span>}
              {cur.ipSince && <span className="small muted">Same address since {when(cur.ipSince)}</span>}
            </>
          ) : <span className="muted small">Not seen yet: it shows the next time the board connects.</span>}
        </section>
        <section className="panel panel-pad conn-card">
          <span className="eyebrow">{online ? 'Online for' : 'Status'}</span>
          {online ? (
            <>
              <b className="conn-big">{span((Date.now() - new Date(cur!.connectedSince!).getTime()) / 1000)}</b>
              <span className="small muted">Connected at {when(cur!.connectedSince!)}</span>
            </>
          ) : (
            <>
              <b className="conn-big fg-bad">Offline</b>
              <span className="small muted">{node.lastSeenAt ? `Last heard from ${timeAgo(node.lastSeenAt)}` : 'Never connected'}</span>
            </>
          )}
        </section>
        <section className="panel panel-pad conn-card">
          <span className="eyebrow">Last 7 days</span>
          <b className="conn-big">{info.stats.connects7d}<span className="kpi-unit"> connection{info.stats.connects7d === 1 ? '' : 's'}</span></b>
          <span className="conn-ends">
            {(Object.keys(ENDS) as EndReason[]).filter((k) => e[k] > 0).map((k) => (
              <span key={k} className={`badge ${ENDS[k].tone}`} title={ENDS[k].why}>{ENDS[k].label} × {e[k]}</span>
            ))}
            {(Object.keys(ENDS) as EndReason[]).every((k) => !e[k]) && <span className="small muted">No drops</span>}
          </span>
          <span className="small muted">{info.stats.connects24h} in the last 24 hours</span>
        </section>
      </div>

      {v && <div className={`conn-verdict v-${v.tone}`}><Icon name={v.tone === 'ok' ? 'check' : v.tone === 'warn' ? 'alert-triangle' : 'activity'} size={15} />{v.text}</div>}

      <section className="panel">
        <div className="panel-head">
          <Icon name="list" size={16} /><b>Connections</b>
          <Tip>Every time the board connected to the server: from which internet address, where that is, how long it stayed and how it ended. The place comes from the address, so it is the city of the internet provider, not the house.</Tip>
          <span className="pill">{info.history.length}</span>
        </div>
        {info.history.length === 0 ? (
          <div className="panel-pad muted small">No connections recorded yet. They appear the next time the board connects.</div>
        ) : (
          <div className="table-wrap flush">
            <table className="table conn-table">
              <thead><tr><th>Connected</th><th>From</th><th>Lasted</th><th>How it ended</th></tr></thead>
              <tbody>
                {shown.map((r, i) => {
                  const end = r.endReason ? ENDS[r.endReason] : null;
                  return (
                    <tr key={r.id}>
                      <td className="nowrap">{when(r.connectedAt)}</td>
                      <td>
                        <span className="mono">{r.ip}</span>
                        {r.newAddress && <span className="badge info" style={{ marginLeft: 8 }}>New address</span>}
                        {where(r.place, r.isp) && <div className="small muted">{where(r.place, r.isp)}</div>}
                      </td>
                      <td className="nowrap" data-label="Lasted">{r.endedAt ? span(r.seconds) : i > 0 ? <span className="muted">—</span> : <span className="muted">{span(r.seconds)} so far</span>}</td>
                      <td>
                        {!r.endedAt && i > 0
                          ? <span className="muted small">Ended (not recorded)</span>
                          : !r.endedAt
                          ? (node.online ? <Badge tone="ok">Connected now</Badge> : <span className="muted small">—</span>)
                          : end ? <span title={r.endNote ?? end.why}><Badge tone={end.tone}>{end.label}</Badge><div className="small muted conn-why">{r.endNote ?? end.why}</div></span>
                          : <span className="muted small">Ended</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {info.history.length > 12 && (
          <div className="panel-pad"><button className="btn btn-small" onClick={() => setAll((x) => !x)}>{all ? 'Show fewer' : `Show all ${info.history.length}`}</button></div>
        )}
      </section>
      <p className="small muted" style={{ margin: 0 }}>
        The place is approximate (the internet provider’s city), never the street. IP location data by{' '}
        <a href="https://db-ip.com" target="_blank" rel="noreferrer">DB-IP</a> (CC BY 4.0), kept on this server.
      </p>
    </div>
  );
}
