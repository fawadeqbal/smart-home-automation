'use client';
import Link from 'next/link';
import { FormEvent, Fragment, ReactNode, useState } from 'react';
import { BoardDiagram, pinStats } from '@/components/BoardDiagram';
import { ConnectionPanel } from '@/components/ConnectionPanel';
import { boardCondition, ConditionLight, hardwareFacts, HealthPanel, signalLabel } from '@/components/BoardHealth';
import { DeviceForm, DeviceFormValues, freePins } from '@/components/DeviceForm';
import { FirmwarePanel } from '@/components/FirmwarePanel';
import { HealthCharts } from '@/components/HealthCharts';
import { PageHelp, Tip } from '@/components/Help';
import { Icon } from '@/components/Icon';
import { LogPanel } from '@/components/LogPanel';
import { NetworkPanel } from '@/components/NetworkPanel';
import { Badge, Confirm, Dropdown, ErrorBox, FormModal, Modal, useAction } from '@/components/ui';
import { del, errorText, patch, post } from '@/lib/api';
import { analogLabel, contactText, devicePins, tankAlarmText } from '@/lib/format';
import { timeAgo, useLoad, useNow } from '@/lib/hooks';
import type { BoardInput, BoardNode, Catalog, InputAction, InputGesture, NodeDevice, Room, Tone } from '@/lib/types';
import { isBehind } from '@/lib/version';

export type BoardTab = 'overview' | 'devices' | 'pins' | 'network' | 'internet' | 'firmware' | 'logs';
export const BOARD_TABS: BoardTab[] = ['overview', 'devices', 'pins', 'network', 'internet', 'firmware', 'logs'];

/** The board's sections, in the order an installer works: is it OK → what's on it → where the wires go → Wi‑Fi → updates → raw log. */
const TABS: { id: BoardTab; label: string; icon: string; setupOnly?: boolean }[] = [
  { id: 'overview', label: 'Overview', icon: 'activity' },
  { id: 'devices', label: 'Devices & buttons', icon: 'lightbulb' },
  { id: 'pins', label: 'Pin map', icon: 'cpu' },
  { id: 'network', label: 'Wi‑Fi', icon: 'wifi', setupOnly: true },
  { id: 'internet', label: 'Internet', icon: 'map-pin' },
  { id: 'firmware', label: 'Firmware', icon: 'download', setupOnly: true },
  { id: 'logs', label: 'Live log', icon: 'terminal' },
];

const HELP: Record<BoardTab, { title: string; body: ReactNode }> = {
  overview: {
    title: 'Is this board OK?',
    body: (
      <ul>
        <li>The coloured light is the board’s condition. <b className="text-ok">Green</b> = all good. <b className="text-warn">Amber</b> = works, but read the message. <b className="text-bad">Red</b> = offline or it refused its settings.</li>
        <li><b>Supply voltage</b> should be 3.0–3.6 V. Lower means a weak USB cable or power supply.</li>
        <li><b>Wi‑Fi signal</b>: “Weak” boards drop out. Move it or the router closer.</li>
        <li>Everything about the board itself (ID, model, addresses, firmware) is in <b>Board details</b>.</li>
      </ul>
    ),
  },
  devices: {
    title: 'What is connected to this board',
    body: (
      <ul>
        <li><b>Devices</b>: a relay for a light/fan/socket, a temperature sensor, a door/motion sensor…</li>
        <li><b>Wall buttons</b>: a push‑button wired between a pin and G (ground) that toggles a light — it works even without Wi‑Fi.</li>
        <li>Only safe, free pins are offered. Changes reach the board in about a second (“Settings saved”).</li>
        <li><b>Other names for voice</b> let the assistant understand “batti” or “lamp” for the same light.</li>
      </ul>
    ),
  },
  pins: {
    title: 'Which wire goes where',
    body: (
      <ul>
        <li>The drawing matches the printing on the board. Hover a pin to see what it can do.</li>
        <li><b className="text-ok">Green ring</b> = free. <b>Blue</b> = in use (its device is named next to it). <b>Yellow</b> = power: 3V = 3.3 V, G = ground, VU/VIN = 5 V. <b>Grey</b> = reserved, don’t use.</li>
        <li>Relays: signal to the pin, VCC to VIN/VU, GND to G. Sensors: power from 3V.</li>
      </ul>
    ),
  },
  network: {
    title: 'Wi‑Fi of this board',
    body: (
      <ul>
        <li><b>Connected to</b> shows its Wi‑Fi, signal and addresses.</li>
        <li><b>Scan now</b> lists the networks the board can hear. Pick one and enter its password to move the board — handy for a new router or a closer extender.</li>
        <li>It is safe: if the new network doesn’t work within 30 seconds, the board goes back to the old one.</li>
        <li>Only 2.4 GHz Wi‑Fi works; 5 GHz networks never appear.</li>
      </ul>
    ),
  },
  firmware: {
    title: 'Updating the board',
    body: (
      <ul>
        <li>Firmware is the program running on the board. Upload a build once, then install it on any board over Wi‑Fi.</li>
        <li>The board restarts after an update (about 10 seconds). Its devices and pins stay as they are.</li>
      </ul>
    ),
  },
  internet: {
    title: 'How the board reaches the server',
    body: (
      <ul>
        <li><b>Reaches the server from</b>: the home’s internet address, the city it belongs to and the provider (PTCL, Nayatel, Zong…). Approximate: the provider’s city, never the street.</li>
        <li><b>Connections</b>: every time the board connected, how long it stayed, and why it ended — <b>Lost contact</b> (power cut or Wi‑Fi/internet down), <b>Connection cut</b> (board reset or the router dropped it), <b>Restarted on purpose</b>, <b>Short drop</b>.</li>
        <li>Many “Lost contact” lines: check the power supply and the Wi‑Fi signal. A “New address”: the router got a new address, or the board was on another network.</li>
      </ul>
    ),
  },
  logs: {
    title: 'What the board is doing right now',
    body: (
      <ul>
        <li>Every message the board prints arrives here live — no USB cable needed.</li>
        <li><b>board</b> lines come from the board; <b>server</b> lines are what this app did (sent settings, switched a light…).</li>
        <li>Choose <b>All</b> in the menu to also see every sensor reading.</li>
      </ul>
    ),
  },
};

const toneOf = (t: string): Tone => (t === 'off' ? 'bad' : (t as Tone));

export function describeState(catalog: Catalog, d: NodeDevice): string {
  if (!d.state) return '—';
  const def = catalog.deviceTypes.find((t) => t.type === d.type);
  if (d.type === 'fan') return d.state.on ? `On · speed ${d.state.speed}` : 'Off';
  if (def?.controllable) return d.state.on ? 'On' : 'Off';
  if (d.type === 'tank') return d.state.level === undefined ? '—' : `${d.state.level}% full${tankAlarmText(d.state.alarm) ? ` · ${tankAlarmText(d.state.alarm)}` : ''}`;
  if (d.type === 'contact') return contactText(d.settings, d.state.active);
  if (d.type === 'analog') return d.state.level === undefined ? '—' : `${d.state.level}% ${analogLabel(d.settings)}`;
  return (def?.stateFields ?? [])
    .filter((f) => d.state![f.key] !== undefined)
    .map((f) => `${d.state![f.key]}${f.unit ?? ''}`)
    .join(' · ') || '—';
}

export function SyncBadge({ node }: { node: BoardNode }) {
  if (node.configError) return <span className="badge bad" title={node.configError}>Settings refused</span>;
  if (node.appliedRev === node.configRev) return <span className="badge ok" title="The board is running the latest devices and pins you set here">Settings saved</span>;
  return <span className="badge warn">{node.online ? 'Saving to board…' : 'Will update when online'}</span>;
}


export function typeLabel(d: NodeDevice): string {
  if (d.type === 'switch') return `Switch${d.activeLow ? ' · active low' : ''}${d.restoreOff ? ' · stays off after a power cut' : ''}`;
  if (d.type === 'fan') return `Fan with speeds${d.restoreOff ? ' · stays off after a power cut' : ''}`;
  if (d.type === 'tank') return `Water tank${d.settings.motorDeviceId ? ' · fills by itself' : ''}`;
  if (d.type === 'dht') return `Temperature sensor · ${String(d.settings.model ?? '').toUpperCase()}`;
  if (d.type === 'contact') return `Contact sensor · ${String(d.settings.kind ?? '')}`;
  if (d.type === 'analog') return `Analog · ${analogLabel(d.settings)}`;
  return d.type;
}

function pinOf(catalog: Catalog, node: BoardNode, gpio: number) {
  const p = catalog.boards.find((b) => b.type === node.board)?.pins.find((x) => x.gpio === gpio);
  return { label: p?.label ?? `GPIO${gpio}`, gpio };
}

function PinCell({ catalog, node, gpio }: { catalog: Catalog; node: BoardNode; gpio: number }) {
  const p = pinOf(catalog, node, gpio);
  return <span className="stack-tight"><b className="mono">{p.label}</b><span className="small muted">GPIO {p.gpio}</span></span>;
}

/* ------------------------------------------------------------------ header */

/** Previous / next board and a list of all boards in this home. */
function BoardSwitcher({ node, siblings, hrefFor }: { node: BoardNode; siblings: BoardNode[]; hrefFor: (id: string) => string }) {
  const i = siblings.findIndex((n) => n.id === node.id);
  if (siblings.length < 2 || i < 0) return null;
  const prev = siblings[(i - 1 + siblings.length) % siblings.length]!;
  const next = siblings[(i + 1) % siblings.length]!;
  return (
    <div className="board-switch">
      <Link className="icon-btn" href={hrefFor(prev.id)} title={`Previous: ${prev.name}`} aria-label={`Previous board: ${prev.name}`}><Icon name="chevron-left" size={16} /></Link>
      <Dropdown align="right" width={280} trigger={(open, toggle) => (
        <button className="board-switch-btn" onClick={toggle} aria-expanded={open}>
          Board {i + 1} of {siblings.length}<Icon name="chevron-down" size={14} />
        </button>
      )}>
        {(close) => (
          <>
            <div className="menu-label">Boards in this home</div>
            {siblings.map((n) => {
              const c = boardCondition(n);
              return (
                <Link key={n.id} href={hrefFor(n.id)} onClick={close} className={`menu-item ${n.id === node.id ? 'focus' : ''}`}>
                  <span className={`sdot ${toneOf(c.tone)}`} />
                  <span className="grow stack-tight"><b style={{ fontWeight: 500 }}>{n.name}</b><span>{c.label} · {n.devices.length} devices</span></span>
                  {n.id === node.id && <Icon name="check" size={14} />}
                </Link>
              );
            })}
          </>
        )}
      </Dropdown>
      <Link className="icon-btn" href={hrefFor(next.id)} title={`Next: ${next.name}`} aria-label={`Next board: ${next.name}`}><Icon name="chevron-right" size={16} /></Link>
    </div>
  );
}

/* ---------------------------------------------------------------- overview */

function Overview({ node, catalog, rooms, canSetup, onTab, onModel, latestFirmware, reload }: {
  node: BoardNode; catalog: Catalog; rooms: Room[]; canSetup: boolean; onTab: (t: BoardTab) => void; onModel: () => void; latestFirmware?: string | null;
  reload: () => void;
}) {
  const behind = isBehind(node.firmware, latestFirmware);
  const s = pinStats(node, catalog);
  const model = catalog.boards.find((b) => b.type === node.board)?.name ?? node.board;
  const roomNames = [...new Set(node.devices.map((d) => rooms.find((r) => r.id === d.roomId)?.name).filter(Boolean))] as string[];
  const names = (list: string[]) => (list.length ? `${list.slice(0, 3).join(', ')}${list.length > 3 ? ` +${list.length - 3} more` : ''}` : '');
  const chip = hardwareFacts(node);
  const rows: { icon: string; title: string; sub: string; value: ReactNode; go: BoardTab }[] = [
    { icon: 'lightbulb', title: 'Devices', sub: names(node.devices.map((d) => d.name)) || 'Nothing connected yet', value: node.devices.length, go: 'devices' },
    { icon: 'toggle-right', title: 'Wall buttons', sub: names(node.inputs.map((i) => `→ ${i.targetName}`)) || 'None', value: node.inputs.length, go: 'devices' },
    {
      icon: 'cpu', title: 'Pins', sub: `${s.used} in use · ${s.free} free`, go: 'pins',
      value: <span className="progress ac" style={{ width: 64 }}><i style={{ width: `${(s.used / Math.max(1, s.used + s.free)) * 100}%` }} /></span>,
    },
    {
      icon: 'map-pin', title: 'Internet',
      sub: node.publicIp ? [node.publicPlace, node.publicIsp].filter(Boolean).join(' · ') || 'Where it connects from' : 'Shows after the board next connects',
      value: node.publicIp ? <span className="mono small">{node.publicIp}</span> : '', go: 'internet',
    },
    { icon: 'terminal', title: 'Live log', sub: node.online ? 'See what the board is doing right now' : 'The board is offline', value: '', go: 'logs' },
  ];
  return (
    <div className="stack">
      <ConditionLight node={node} />
      <HealthPanel node={node} />

      <div className="board-grid">
        <section className="panel">
          <div className="panel-head"><b>On this board</b>{roomNames.length > 0 && <span className="muted">{roomNames.join(' · ')}</span>}</div>
          {rows.map((r) => (
            <button key={r.title} className="li li-btn" onClick={() => onTab(r.go)}>
              <span className="li-icon"><Icon name={r.icon} size={15} /></span>
              <span className="li-text"><b>{r.title}</b><span className="sub">{r.sub}</span></span>
              {r.value !== '' && <span className="li-value">{r.value}</span>}
              <Icon name="chevron-right" size={15} />
            </button>
          ))}
        </section>

        <section className="panel">
          <div className="panel-head"><b>Board details</b></div>
          <div className="panel-pad">
            <dl className="facts">
              <dt>Model</dt>
              <dd>{model}{canSetup && <> <button className="link-btn" style={{ marginLeft: 4 }} onClick={onModel}>Change</button></>}</dd>
              <dt>Board ID <Tip>Printed by the board at start-up and part of its Wi‑Fi name (HomeNode‑…). It never changes.</Tip></dt>
              <dd className="mono">{node.id}</dd>
              {node.mac && <><dt>MAC address</dt><dd className="mono">{node.mac}</dd></>}
              <dt>IP address</dt><dd className="mono">{node.ip ?? '—'}</dd>
              <dt>Wi‑Fi</dt>
              <dd>{node.health?.ssid ? `${node.health.ssid} · ` : ''}{signalLabel(node.health?.rssi ?? node.rssi)}</dd>
              <dt>Firmware</dt>
              <dd className="row" style={{ gap: 8 }}>
                <span>{node.firmware ?? '—'}</span>
                {behind
                  ? canSetup
                    ? <button className="fw-chip" onClick={() => onTab('firmware')}><Icon name="arrow-up" size={11} stroke={2.4} />Update to {latestFirmware}</button>
                    : <span className="fw-chip static"><Icon name="arrow-up" size={11} stroke={2.4} />{latestFirmware} available</span>
                  : latestFirmware && node.firmware ? <span className="small muted">latest</span> : null}
              </dd>
              {node.localControl && <>
                <dt>Without internet</dt>
                <dd title="The phone app can switch this board straight over the home's Wi‑Fi when the internet is down">
                  {node.localControl === 'ready'
                    ? <span className="badge ok">Phone can switch it over Wi‑Fi</span>
                    : node.localControl === 'waiting'
                      ? <span className="muted small">Gets its key when it next comes online</span>
                      : <span className="muted small">Needs firmware 2.5.0 for phone control over Wi‑Fi</span>}
                </dd>
              </>}
              {node.mqttLogin && <>
                <dt>Server login <Tip>From firmware 2.6.0 each board gets its own login, so one board&apos;s password can&apos;t be used to pretend to be another.</Tip></dt>
                <dd><LoginFact node={node} canSetup={canSetup} reload={reload} /></dd>
              </>}
              <dt>Settings</dt>
              <dd className="row" style={{ gap: 6 }}><SyncBadge node={node} /><span className="muted small">v{node.appliedRev} of {node.configRev}</span></dd>
              <dt>Last report</dt>
              <dd>{node.lastSeenAt ? `${new Date(node.lastSeenAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${timeAgo(node.lastSeenAt)}` : 'never'}</dd>
            </dl>
            {chip.length > 0 && (
              <details className="more-facts">
                <summary>Chip details</summary>
                <dl className="facts">{chip.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
              </details>
            )}
          </div>
        </section>
      </div>

      <HealthCharts nodeId={node.id} />
    </div>
  );
}

/** Its own server login, the shared one, or a warning when it came back without its own. */
function LoginFact({ node, canSetup, reload }: { node: BoardNode; canSetup: boolean; reload: () => void }) {
  const [confirm, setConfirm] = useState(false);
  if (node.mqttLoginProblem) {
    return (
      <span className="stack-tight">
        <span className="badge warn">Came back without its own login</span>
        <span className="small muted">Normal after its chip was erased or replaced. If not, someone may be using its ID.</span>
        {canSetup && <span><button className="link-btn" onClick={() => setConfirm(true)}>Give it a new login</button></span>}
        {confirm && (
          <Confirm title="Give this board a new login?" body="The old login stops working. The board gets the new one now if it is online, or when it next connects."
            confirmLabel="New login" onConfirm={async () => { await post(`/nodes/${node.id}/reset-login`); reload(); }} onClose={() => setConfirm(false)} />
        )}
      </span>
    );
  }
  if (node.mqttLogin === 'own') {
    return <span className="row" style={{ gap: 6 }}><span className="badge ok">Its own</span>{node.mqttLoginSince && <span className="small muted">since {new Date(node.mqttLoginSince).toLocaleDateString([], { day: 'numeric', month: 'short' })}</span>}</span>;
  }
  return <span className="small muted">Shared board login{node.firmware && isBehind(node.firmware, '2.6.0') ? ' — firmware 2.6.0 gives it its own' : ''}</span>;
}

/* ----------------------------------------------------------------- devices */

type Editing = { kind: 'device'; device?: NodeDevice } | { kind: 'button'; input?: BoardInput } | null;

function DevicesTab({ node, catalog, rooms, canSetup, reload }: {
  node: BoardNode; catalog: Catalog; rooms: Room[]; canSetup: boolean; reload: () => void;
}) {
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<{ title: string; body: string; run: () => Promise<unknown> } | null>(null);
  const switches = node.devices.filter((d) => catalog.deviceTypes.find((t) => t.type === d.type)?.controllable);
  const roomName = (id: string | null) => rooms.find((r) => r.id === id)?.name ?? '—';

  const saveDevice = async (v: DeviceFormValues) => {
    const d = editing?.kind === 'device' ? editing.device : undefined;
    if (d) await patch(`/devices/${d.id}`, { name: v.name, pin: v.pin, activeLow: v.activeLow, roomId: v.roomId, aliases: v.aliases, settings: v.settings, ...(catalog.deviceTypes.find((t) => t.type === d.type)?.controllable ? { restoreOff: v.restoreOff } : {}) });
    else await post(`/nodes/${node.id}/devices`, { ...v });
    setEditing(null);
    reload();
  };

  return (
    <div className="stack">
      {node.configError && <div className="alert">The board refused its settings: {node.configError}</div>}

      <section className="panel">
        <div className="panel-head">
          <Icon name="lightbulb" size={16} /><b>Devices</b><span className="pill">{node.devices.length}</span>
          <span className="push row" style={{ gap: 8 }}>
            <SyncBadge node={node} />
            {canSetup && <button className="btn btn-sm btn-primary" onClick={() => setEditing({ kind: 'device' })}><Icon name="plus" size={14} />Add device</button>}
          </span>
        </div>
        {node.devices.length ? (
          <div className="table-wrap flush">
            <table className="table">
              <thead><tr><th>Device</th><th>Pin</th><th>Room</th><th>Now</th>{canSetup && <th />}</tr></thead>
              <tbody>
                {node.devices.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <span className="stack-tight">
                        <b>{d.name}</b>
                        <span className="small muted">{typeLabel(d)}{d.aliases.length > 0 ? ` · also “${d.aliases.join('”, “')}”` : ''}</span>
                      </span>
                    </td>
                    <td>{devicePins(d).length > 1
                      ? <span className="row" style={{ gap: 6 }}>{devicePins(d).map((g) => <PinCell key={g} catalog={catalog} node={node} gpio={g} />)}</span>
                      : <PinCell catalog={catalog} node={node} gpio={d.pin} />}</td>
                    <td>{roomName(d.roomId)}</td>
                    <td className="small nowrap">{node.online ? describeState(catalog, d) : <span className="muted">offline</span>}</td>
                    {canSetup && (
                      <td className="right nowrap">
                        <button className="icon-btn" title={`Edit ${d.name}`} aria-label={`Edit ${d.name}`} onClick={() => setEditing({ kind: 'device', device: d })}><Icon name="pencil" size={15} /></button>
                        <button className="icon-btn danger" title={`Remove ${d.name}`} aria-label={`Remove ${d.name}`} onClick={() => setRemoving({
                          title: `Remove ${d.name}?`,
                          body: `It disappears from the app and the board frees pin ${pinOf(catalog, node, d.pin).label}.${node.inputs.some((i) => i.targetId === d.id) ? ' Wall buttons that toggle it are removed too.' : ''}`,
                          run: () => del(`/devices/${d.id}`),
                        })}><Icon name="trash" size={15} /></button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="panel-pad muted small">No devices on this board yet.{canSetup ? ' Add the first light, fan, socket or sensor wired to it.' : ''}</div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <Icon name="toggle-right" size={16} /><b>Wall switches and buttons</b><span className="pill">{node.inputs.length}</span>
          {canSetup && (
            <button className="btn btn-sm push" onClick={() => setEditing({ kind: 'button' })}><Icon name="plus" size={14} />Add</button>
          )}
        </div>
        {node.inputs.length ? (
          <div className="table-wrap flush">
            <table className="table">
              <thead><tr><th>On pin</th><th>What</th><th>Toggles</th><th>Also does</th>{canSetup && <th />}</tr></thead>
              <tbody>
                {node.inputs.map((i) => (
                  <tr key={i.id}>
                    <td><PinCell catalog={catalog} node={node} gpio={i.pin} /></td>
                    <td>
                      <b>{i.name || (i.type === 'wall_switch' ? 'Wall switch' : 'Push-button')}</b>
                      <div className="cell-sub">{i.type === 'wall_switch' ? 'Wall switch' : 'Push-button'}{i.lastEventAt ? ` · used ${timeAgo(i.lastEventAt)}` : ''}</div>
                    </td>
                    <td>{i.targetName ? <b>{i.targetName}</b> : <span className="muted">—</span>}</td>
                    <td className="small">{actionsText(i) || <span className="muted">—</span>}</td>
                    {canSetup && (
                      <td className="right nowrap">
                        <button className="icon-btn" title="Change" aria-label="Change" onClick={() => setEditing({ kind: 'button', input: i })}><Icon name="pencil" size={15} /></button>
                        <button className="icon-btn danger" title="Remove" aria-label="Remove" onClick={() => setRemoving({
                          title: 'Remove this input?', body: `The ${i.type === 'wall_switch' ? 'wall switch' : 'button'} on ${pinOf(catalog, node, i.pin).label} stops working${i.targetName ? ` (it toggles ${i.targetName})` : ''}.`,
                          run: () => del(`/inputs/${i.id}`),
                        })}><Icon name="trash" size={15} /></button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="panel-pad muted small">None yet. Wire an ordinary wall switch or a push-button between a pin and G: it toggles a light even when Wi‑Fi is down, and a button’s double-press or long press can run a scene.</div>
        )}
      </section>

      {editing?.kind === 'device' && (
        <Modal wide title={editing.device ? `Edit ${editing.device.name}` : 'Add a device'} sub={`On ${node.name} · only free, safe pins are offered`} onClose={() => setEditing(null)} className="form-dialog">
          <div className="dialog-body">
            <DeviceForm catalog={catalog} node={node} rooms={rooms} initial={editing.device} submitLabel={editing.device ? 'Save changes' : 'Add device'}
              onSubmit={saveDevice} onCancel={() => setEditing(null)} />
          </div>
        </Modal>
      )}
      {editing?.kind === 'button' && (
        <Modal wide title={editing.input ? 'Change this input' : 'Add a wall switch or button'} sub={`On ${node.name}`} onClose={() => setEditing(null)} className="form-dialog">
          <div className="dialog-body">
            <InputForm node={node} catalog={catalog} switches={switches} rooms={rooms} initial={editing.input} onCancel={() => setEditing(null)}
              onSaved={() => { setEditing(null); reload(); }} />
          </div>
        </Modal>
      )}
      {removing && (
        <Confirm title={removing.title} body={removing.body} confirmLabel="Remove"
          onConfirm={async () => { await removing.run(); reload(); }} onClose={() => setRemoving(null)} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- page */

export function BoardDetail({ node, catalog, rooms, reload, tab, onTab, onForgotten, backHref, backLabel, siblings = [], hrefFor, canSetup = true, latestFirmware }: {
  node: BoardNode; catalog: Catalog; rooms: Room[]; reload: () => void;
  tab: BoardTab; onTab: (t: BoardTab) => void; onForgotten: () => void; backHref: string; backLabel: string;
  /** the other installed boards of this home, for previous / next */
  siblings?: BoardNode[]; hrefFor?: (id: string) => string;
  /** false for support staff: everything is shown, nothing can be changed */
  canSetup?: boolean;
  /** the newest firmware build of the organization (to show "update available") */
  latestFirmware?: string | null;
}) {
  const behind = isBehind(node.firmware, latestFirmware);
  useNow(10_000);
  const [dialog, setDialog] = useState<'rename' | 'model' | 'remove' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const cond = boardCondition(node);
  const tone = toneOf(cond.tone);
  const model = catalog.boards.find((b) => b.type === node.board)?.name ?? node.board;
  const tabs = TABS.filter((t) => canSetup || !t.setupOnly);
  const current = tabs.some((t) => t.id === tab) ? tab : 'overview';

  async function restart() {
    setNote(null);
    const ok = await run(() => post(`/nodes/${node.id}/reboot`));
    if (ok !== undefined) setNote('Restart sent — the board is back in about 5 seconds.');
  }

  return (
    <div className="board-page" data-screen-label="Board">
      <div className="board-nav">
        <Link href={backHref} className="back-link"><Icon name="arrow-left" size={14} />{backLabel}</Link>
        {hrefFor && <BoardSwitcher node={node} siblings={siblings} hrefFor={hrefFor} />}
      </div>

      <div className="ph" style={{ marginBottom: 16 }}>
        <div className="ph-text">
          <span className="eyebrow">Board · {model}</span>
          <h1 className="board-title"><span className={`sdot lg ${tone}`} title={cond.label} />{node.name}</h1>
          <div className="board-meta">
            <Badge tone={tone}>{cond.label}</Badge>
            <span className="mono">{node.id}</span>
            <span className="row" style={{ gap: 6 }}>firmware <b>{node.firmware ?? '?'}</b>
              {behind && (canSetup
                ? <button className="fw-chip" onClick={() => onTab('firmware')} title="Open the Firmware tab"><Icon name="arrow-up" size={11} stroke={2.4} />{latestFirmware} available</button>
                : <span className="fw-chip static"><Icon name="arrow-up" size={11} stroke={2.4} />{latestFirmware} available</span>)}
            </span>
            {node.ip && <span className="mono">{node.ip}</span>}
            <span>{node.online ? `active ${timeAgo(node.lastSeenAt)}` : node.lastSeenAt ? `last seen ${timeAgo(node.lastSeenAt)}` : 'never connected'}</span>
          </div>
        </div>
        <div className="ph-actions">
          <PageHelp id={`board-${current}`} title={HELP[current].title}>{HELP[current].body}</PageHelp>
          {canSetup && (
            <>
              <button className="btn" disabled={!node.online || busy} title={node.online ? 'Reboot the board (about 5 seconds)' : 'The board is offline'} onClick={() => void restart()}>
                <Icon name="rotate" size={15} />Restart
              </button>
              <Dropdown align="right" width={240} trigger={(open, toggle) => (
                <button className="btn btn-icon" onClick={toggle} aria-expanded={open} aria-label="More board actions" title="More"><Icon name="more" size={16} /></button>
              )}>
                {(close) => (
                  <>
                    <button className="menu-item" onClick={() => { close(); setDialog('rename'); }}><Icon name="pencil" size={15} /><span className="grow">Rename</span></button>
                    <button className="menu-item" onClick={() => { close(); setDialog('model'); }}><Icon name="cpu" size={15} /><span className="grow">Change board model</span></button>
                    <div className="menu-sep" />
                    <button className="menu-item danger" onClick={() => { close(); setDialog('remove'); }}>
                      <Icon name="trash" size={15} /><span className="grow stack-tight">Remove from home<span>Devices are deleted, board goes back to stock</span></span>
                    </button>
                  </>
                )}
              </Dropdown>
            </>
          )}
        </div>
      </div>

      {!canSetup && (
        <div className="lockbar mb16">
          <span className="lock"><Icon name="lock" size={15} /></span>
          <span className="grow small"><b>Read-only.</b> <span className="muted">Wiring, Wi‑Fi and firmware are changed by the installer.</span></span>
        </div>
      )}
      {note && <div className="notice mb16" role="status">{note}</div>}
      <ErrorBox error={error} />

      <div className="tabs" role="tablist" aria-label="Board sections">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={current === t.id} className={`tab-btn ${current === t.id ? 'active' : ''}`} onClick={() => onTab(t.id)}>
            <Icon name={t.icon} size={14} />{t.label}
            {t.id === 'devices' && <span className="pill">{node.devices.length + node.inputs.length}</span>}
            {t.id === 'firmware' && behind && <span className="pill warn" title={`${latestFirmware} available`}>1</span>}
          </button>
        ))}
      </div>

      {current === 'overview' && <Overview node={node} catalog={catalog} rooms={rooms} canSetup={canSetup} onTab={onTab} onModel={() => setDialog('model')} latestFirmware={latestFirmware} reload={reload} />}
      {current === 'devices' && <DevicesTab node={node} catalog={catalog} rooms={rooms} canSetup={canSetup} reload={reload} />}
      {current === 'pins' && <BoardDiagram node={node} catalog={catalog} />}
      {current === 'network' && <NetworkPanel node={node} />}
      {current === 'firmware' && <FirmwarePanel node={node} />}
      {current === 'internet' && <ConnectionPanel node={node} />}
      {current === 'logs' && <LogPanel nodeId={node.id} online={node.online} devices={node.devices} />}

      {dialog === 'rename' && (
        <FormModal title="Rename board" sub="Name it after where it is — the owner sees this name." submitLabel="Save" onClose={() => setDialog(null)}
          onSubmit={async (f) => { await patch(`/nodes/${node.id}`, { name: String(f.get('name')).trim() }); reload(); }}>
          <label className="field">Name<input name="name" defaultValue={node.name} required maxLength={60} /></label>
        </FormModal>
      )}
      {dialog === 'model' && (
        <FormModal title="Board model" sub="Pick the one that looks like the board in your hand, so the pin map matches its printing. The pins work the same." submitLabel="Save"
          onClose={() => setDialog(null)} onSubmit={async (f) => { await patch(`/nodes/${node.id}`, { board: f.get('board') }); reload(); }}>
          <label className="field">Model
            <select name="board" defaultValue={node.board}>{catalog.boards.map((b) => <option key={b.type} value={b.type}>{b.name}</option>)}</select>
          </label>
        </FormModal>
      )}
      {dialog === 'remove' && (
        <Confirm title={`Remove ${node.name} from this home?`} confirmLabel="Remove board" onClose={() => setDialog(null)}
          body={<>Its {node.devices.length} devices and {node.inputs.length} wall buttons are deleted and the board goes back to stock, ready to be assigned again. <span className="muted">Board {node.id}.</span></>}
          onConfirm={async () => { await del(`/nodes/${node.id}`); onForgotten(); }} />
      )}
    </div>
  );
}

const GESTURE_LABEL: Record<InputGesture, string> = { single: 'Press', double: 'Double-press', long: 'Long press', flip: 'Each flip' };

/** "Double-press: run Good night · Long press: everything in Bedroom off". */
function actionsText(i: BoardInput) {
  return (Object.entries(i.actions ?? {}) as [InputGesture, InputAction][]).map(([g, a]) => `${GESTURE_LABEL[g]}: ${
    a.type === 'scene' ? 'run a scene' : a.type === 'allOff' ? (a.roomId ? 'a room off' : 'everything off') : a.on === undefined ? 'toggle a switch' : `a switch ${a.on ? 'on' : 'off'}`}`).join(' · ');
}

/** What one gesture does: nothing, a scene, a switch anywhere in the home, or a room/everything off. */
function ActionPicker({ label, value, onChange, scenes, devices, rooms }: {
  label: string; value: InputAction | undefined; onChange: (a: InputAction | undefined) => void;
  scenes: { id: string; name: string }[]; devices: { id: string; name: string; roomName: string | null }[]; rooms: Room[];
}) {
  const key = !value ? '' : value.type === 'scene' ? `scene:${value.sceneId}` : value.type === 'device' ? `device:${value.deviceId}:${value.on === undefined ? 't' : value.on ? '1' : '0'}` : `off:${value.roomId ?? ''}`;
  const set = (k: string) => {
    if (!k) return onChange(undefined);
    const [t, id, x] = k.split(':');
    if (t === 'scene') onChange({ type: 'scene', sceneId: id! });
    else if (t === 'device') onChange({ type: 'device', deviceId: id!, ...(x === 't' ? {} : { on: x === '1' }) });
    else onChange({ type: 'allOff', roomId: id || null });
  };
  return (
    <label className="field">{label}
      <select value={key} onChange={(e) => set(e.target.value)}>
        <option value="">Nothing</option>
        {scenes.length > 0 && <optgroup label="Run a scene">{scenes.map((sc) => <option key={sc.id} value={`scene:${sc.id}`}>{sc.name}</option>)}</optgroup>}
        <optgroup label="Switch everything off">
          <option value="off:">Everything in the home</option>
          {rooms.map((r) => <option key={r.id} value={`off:${r.id}`}>Everything in {r.name}</option>)}
        </optgroup>
        <optgroup label="Toggle a switch (any board)">{devices.map((d) => <option key={d.id} value={`device:${d.id}:t`}>{d.name}{d.roomName ? ` · ${d.roomName}` : ''}</option>)}</optgroup>
      </select>
    </label>
  );
}

/** Add or change an input: an ordinary wall switch or a push-button, its own switch, and what its gestures do. */
export function InputForm({ node, catalog, switches, rooms, initial, onSaved, onCancel }: {
  node: BoardNode; catalog: Catalog; switches: NodeDevice[]; rooms: Room[]; initial?: BoardInput; onSaved: () => void; onCancel: () => void;
}) {
  const pins = freePins(catalog, node, 'input');
  const scenes = useLoad<{ id: string; name: string }[]>('/scenes');
  const devices = useLoad<{ id: string; name: string; roomName: string | null; controllable: boolean }[]>('/devices');
  const [type, setType] = useState<'toggle_button' | 'wall_switch'>((initial?.type as 'wall_switch') ?? 'wall_switch');
  const [pin, setPin] = useState<number>(initial?.pin ?? pins[0]?.gpio ?? -1);
  const [name, setName] = useState(initial?.name ?? '');
  const [target, setTarget] = useState<string>(initial ? initial.targetId ?? '' : switches[0]?.id ?? '');
  const [gestures, setGestures] = useState<boolean>(!!initial?.settings?.gestures);
  const [actions, setActions] = useState<Partial<Record<InputGesture, InputAction>>>(initial?.actions ?? {});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shown: InputGesture[] = type === 'wall_switch' ? (target ? [] : ['flip']) : [...(target ? [] : ['single'] as InputGesture[]), ...(gestures ? ['double', 'long'] as InputGesture[] : [])];
  const others = (devices.data ?? []).filter((d) => d.controllable);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const kept = Object.fromEntries(Object.entries(actions).filter(([g]) => shown.includes(g as InputGesture)));
    const body = { name: name.trim(), targetId: target || null, settings: type === 'toggle_button' ? { gestures } : {}, actions: kept };
    try {
      if (initial) await patch(`/inputs/${initial.id}`, body);
      else await post(`/nodes/${node.id}/inputs`, { ...body, type, pin });
      onSaved();
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }

  return (
    <form className="subtle-box stack" onSubmit={save}>
      {!initial && (
        <div className="seg seg-wide" role="group">
          <button type="button" className={type === 'wall_switch' ? 'on' : ''} onClick={() => setType('wall_switch')}>Ordinary wall switch</button>
          <button type="button" className={type === 'toggle_button' ? 'on' : ''} onClick={() => setType('toggle_button')}>Push-button</button>
        </div>
      )}
      <p className="small muted" style={{ margin: 0 }}>
        {type === 'wall_switch'
          ? 'A normal switch that stays up or down, wired between the pin and G. Every flip — up or down — toggles its light, so it always works, whatever the app did last. Works even when Wi‑Fi is down.'
          : 'A bell-type button that springs back, wired between the pin and G. A press toggles its light at once (even without Wi‑Fi). Turn on double-press and long press to run scenes too.'}
      </p>
      <div className="form-grid">
        {!initial && (
          <label className="field">Pin
            <select value={pin} onChange={(e) => setPin(Number(e.target.value))}>{pins.map((p) => <option key={p.gpio} value={p.gpio}>{p.label} (GPIO {p.gpio}){p.note ? ` — ${p.note}` : ''}</option>)}</select>
          </label>
        )}
        <label className="field">Name (optional)<input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={type === 'wall_switch' ? 'Hall switch by the door' : 'Bedside button'} /></label>
        <label className="field">Toggles (on this board)
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Nothing of its own</option>
            {switches.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
      </div>
      {type === 'toggle_button' && (
        <label className="check"><input type="checkbox" checked={gestures} onChange={(e) => setGestures(e.target.checked)} /> Double-press and long press do more {target && <span className="muted small">(a single press then waits a third of a second)</span>}</label>
      )}
      {shown.length > 0 && (
        <div className="form-grid">
          {shown.map((g) => (
            <ActionPicker key={g} label={GESTURE_LABEL[g]} value={actions[g]} onChange={(a) => setActions((v) => ({ ...v, [g]: a }))}
                          scenes={scenes.data ?? []} devices={others} rooms={rooms} />
          ))}
        </div>
      )}
      {shown.length > 0 && <p className="small muted" style={{ margin: 0 }}>These go through the server, so they need Wi‑Fi. They act with the home owner’s rights.</p>}
      {error && <div className="alert">{error}</div>}
      <div className="row">
        <button className="btn btn-primary" disabled={busy || (!initial && pins.length === 0)}>{initial ? 'Save' : 'Add'}</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
