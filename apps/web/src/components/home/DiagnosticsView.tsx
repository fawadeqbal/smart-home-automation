'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { pinStats } from '@/components/BoardDiagram';
import { boardCondition } from '@/components/BoardHealth';
import { describeState } from '@/components/BoardParts';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { Empty, FormModal } from '@/components/ui';
import { post } from '@/lib/api';
import { timeAgo, useLoad, useNow } from '@/lib/hooks';
import { useLive } from '@/lib/live';
import type { BoardNode, Catalog, Tone } from '@/lib/types';

const toneOf = (t: string): Tone => (t === 'off' ? 'bad' : (t as Tone));

function uptime(sec?: number) {
  if (sec === undefined) return '—';
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

function advice(node: BoardNode): { tone: Tone; tips: string[] } | null {
  const h = node.health;
  const where = node.name.toLowerCase();
  if (!node.online) {
    return { tone: 'bad', tips: [
      `Check the breaker (MCB) for the ${where} in your main panel is switched up.`,
      'Look at the board: a steady blue light means power but no Wi‑Fi; no light means no power.',
      'Restart your Wi‑Fi router — the board rejoins by itself within a minute.',
    ] };
  }
  if (node.configError) return { tone: 'bad', tips: [`The board refused its settings: ${node.configError}`, 'Your installer can fix this from the board’s pins page.'] };
  if (h?.vcc !== undefined && h.vcc < 3000) {
    return { tone: 'warn', tips: [`The supply is low (${(h.vcc / 1000).toFixed(2)} V; boards need 3.0 V or more).`, `Ask the installer to replace the power adapter behind the ${where} switchboard.`] };
  }
  if (h?.rssi !== undefined && h.rssi < -75) {
    return { tone: 'warn', tips: [`The board hears your Wi‑Fi weakly (${h.rssi} dBm), so switching can feel slow.`, `A Wi‑Fi extender near the ${where} switchboard usually fixes this.`] };
  }
  return null;
}

/**
 * How each board behind the switchboards is doing, and what is wired to it.
 * Owners and admins read it; installers and super admins get a link to change the pins.
 */
export function DiagnosticsView({ canSetup, editHref, openHref, installerName, allowSupport }: {
  canSetup: boolean; editHref: (nodeId: string) => string; installerName?: string | null; allowSupport: boolean;
  /** staff: the board's own page (health history, Wi‑Fi, firmware, live log) */
  openHref?: (nodeId: string) => string;
}) {
  useNow(15_000);
  const params = useSearchParams();
  const nodes = useLoad<BoardNode[]>('/nodes');
  const catalog = useLoad<Catalog>('/catalog');
  const [open, setOpen] = useState<string | null>(params.get('board'));
  const [support, setSupport] = useState<string | null>(null);
  const [sent, setSent] = useState<{ id: string; number: number } | null>(null);
  useLive('nodes.changed', () => void nodes.reload());
  useLive('node.status', () => void nodes.reload());
  useLive('node.health', (e: { nodeId: string; health: BoardNode['health']; lastSeenAt: string }) =>
    nodes.setData((list) => list?.map((n) => (n.id === e.nodeId ? { ...n, health: e.health, lastSeenAt: e.lastSeenAt } : n)) ?? list));

  const installed = (nodes.data ?? []).filter((n) => n.status === 'ADOPTED');
  useEffect(() => {
    if (open || !installed.length) return;
    const worst = installed.find((n) => boardCondition(n).tone === 'bad') ?? installed.find((n) => boardCondition(n).tone === 'warn');
    if (worst) setOpen(worst.id);
  }, [installed, open]);

  if (!nodes.data || !catalog.data) return nodes.error ?? catalog.error ? <div className="alert">{nodes.error ?? catalog.error}</div> : <Loader label="Loading boards…" />;

  return (
    <div className="stack" style={{ gap: 12 }} data-screen-label="Diagnostics">
      {!canSetup && (
        <div className="lockbar">
          <span className="lock"><Icon name="lock" size={15} /></span>
          <span className="grow small" style={{ minWidth: 220, lineHeight: 1.45 }}>
            <b>Read-only.</b> <span className="muted">Wiring and pins are managed by {installerName ? `your installer, ${installerName}` : 'your installer'}. If something looks wrong, send this page to support.</span>
          </span>
          {allowSupport && (sent
            ? <a className="btn" href={`/support/${sent.id}`}><Icon name="check" size={14} />Request #{sent.number}</a>
            : <button className="btn" onClick={() => setSupport(open ?? '')}><Icon name="send" size={14} />Send to support</button>)}
        </div>
      )}
      {installed.length === 0 && <Empty>No boards installed in this home yet.</Empty>}
      {installed.map((n) => {
        const c = boardCondition(n);
        const tone = toneOf(c.tone);
        const isOpen = open === n.id;
        const h = n.health;
        const s = pinStats(n, catalog.data!);
        const tips = advice(n);
        const pins = [
          ...n.devices.map((d) => ({ pin: d.pin, label: catalog.data!.boards.find((b) => b.type === n.board)?.pins.find((p) => p.gpio === d.pin)?.label ?? `GPIO${d.pin}`, to: d.name,
            type: catalog.data!.deviceTypes.find((t) => t.type === d.type)?.controllable ? 'Switch' : 'Sensor', state: n.online ? describeState(catalog.data!, d) : d.state ? `Last: ${describeState(catalog.data!, d).toLowerCase()}` : 'No answer' })),
          ...n.inputs.map((i) => ({ pin: i.pin, label: catalog.data!.boards.find((b) => b.type === n.board)?.pins.find((p) => p.gpio === i.pin)?.label ?? `GPIO${i.pin}`, to: `Wall button → ${i.targetName}`, type: 'Button', state: n.online ? 'Idle' : '—' })),
        ];
        const seen = n.online ? 'just now' : timeAgo(n.lastSeenAt);
        return (
          <section key={n.id} className={`diag ${tone === 'bad' ? 'bad' : tone === 'warn' ? 'warn' : ''}`}>
            <button className={`diag-head ${isOpen ? 'open' : ''}`} onClick={() => setOpen(isOpen ? null : n.id)} aria-expanded={isOpen}>
              <span className={`sdot lg ${tone}`} />
              <span className="li-text">
                <b style={{ fontSize: 15 }}>{n.name} board</b>
                <span className="sub"><span className={`fg-${tone === 'ok' ? 'ok' : tone === 'warn' ? 'warn' : 'bad'}`} style={{ fontWeight: 500 }}>{n.online ? c.label : `Offline · ${seen.replace(' ago', '')}`}</span> · {n.devices.length} devices · seen {seen}</span>
                <span className="mono" style={{ fontSize: 11.5, color: 'var(--mu)' }}>{n.id}</span>
              </span>
              <span className="chev"><Icon name="chevron-down" size={16} /></span>
            </button>
            {isOpen && (
              <div className="diag-body">
                <div className="metrics">
                  <div className="metric"><span>Wi‑Fi signal</span><b className={h?.rssi !== undefined && h.rssi < -75 ? 'warn' : ''}>{n.online && h?.rssi !== undefined ? `${h.rssi} dBm` : '—'}</b></div>
                  <div className="metric"><span>Supply</span><b className={h?.vcc !== undefined && h.vcc < 3000 ? 'warn' : ''}>{n.online && h?.vcc !== undefined ? `${(h.vcc / 1000).toFixed(2)} V` : '—'}</b></div>
                  <div className="metric"><span>Free memory</span><b>{n.online && h?.heap !== undefined ? `${Math.round(h.heap / 1024)} KB` : '—'}</b></div>
                  <div className="metric"><span>Up for</span><b>{n.online ? uptime(h?.uptime) : '—'}</b></div>
                  <div className="metric"><span>Last seen</span><b className={!n.online ? 'warn' : ''}>{seen}</b></div>
                  <div className="metric"><span>Firmware</span><b>{n.firmware ?? '—'}</b></div>
                </div>
                {tips && (
                  <div className={`advice ${tips.tone}`}>
                    <b style={{ fontSize: 13.5 }}>What to try</b>
                    {tips.tips.map((t, i) => <div key={i}><span className="n">{i + 1}</span><span>{t}</span></div>)}
                  </div>
                )}
                <div className="stack-sm">
                  <div className="row" style={{ gap: 10 }}>
                    <b style={{ fontSize: 13.5 }}>Pins</b><span className="small muted">{s.used} used · {s.free} free</span>
                    <span className="push row" style={{ gap: 8 }}>
                      {!canSetup && <span className="small muted row" style={{ gap: 5 }}><Icon name="lock" size={12} />Can’t be changed here</span>}
                      {openHref && <Link className="btn btn-sm" href={openHref(n.id)}>Open board<Icon name="chevron-right" size={13} /></Link>}
                      {canSetup && <Link className="btn btn-sm btn-primary" href={editHref(n.id)}><Icon name="pencil" size={13} />Edit devices</Link>}
                    </span>
                  </div>
                  {pins.length ? (
                    <div className="pin-table">
                      <table>
                        <tbody>
                          {pins.sort((a, b) => a.label.localeCompare(b.label)).map((p) => (
                            <tr key={`${p.label}-${p.to}`}>
                              <td className="pin">{p.label}</td>
                              <td>{p.to}</td>
                              <td><span className={`tag ${p.type === 'Switch' ? 'warn' : p.type === 'Sensor' ? 'info' : 'ok'}`}>{p.type}</span></td>
                              <td className="muted nowrap" style={{ textAlign: 'right' }}>{p.state}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : <span className="small muted">Nothing wired yet.</span>}
                </div>
              </div>
            )}
          </section>
        );
      })}
      {support !== null && (
        <FormModal title="Send to support" sub="This opens a help request: your installer and the support team get it with a link to this board, and their answers come back here." submitLabel="Send"
          onClose={() => setSupport(null)}
          onSubmit={async (f) => { const r = await post<{ ticket: { id: string; number: number } }>('/home/support', { message: f.get('message'), nodeId: f.get('nodeId') || undefined }); setSent(r.ticket); }}>
          <label className="field">Which board?
            <select name="nodeId" defaultValue={support}>
              <option value="">The whole home</option>
              {installed.map((n) => <option key={n.id} value={n.id}>{n.name} board</option>)}
            </select>
          </label>
          <label className="field">What’s wrong?<textarea name="message" rows={4} required maxLength={1000} placeholder="The kitchen lights don’t respond from the app since this morning." /></label>
        </FormModal>
      )}
    </div>
  );
}
