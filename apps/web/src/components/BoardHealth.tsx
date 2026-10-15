'use client';
import { timeAgo, useNow } from '@/lib/hooks';
import type { BoardNode } from '@/lib/types';
import { Tip } from './Help';

type Tone = 'ok' | 'warn' | 'bad' | 'off';
export interface Condition { tone: Tone; label: string; detail: string; led: string }

/** One-word condition of a board, worst problem first. */
export function boardCondition(node: BoardNode): Condition {
  const h = node.health;
  if (!node.online) {
    return { tone: 'bad', label: 'Disconnected', detail: 'The server lost contact with the board.',
      led: 'On the board: fast blink = no Wi‑Fi, slow blink = Wi‑Fi OK but the server is unreachable, dark = no power.' };
  }
  const led = 'On the board: the blue LED is off (connected).';
  if (node.configError) return { tone: 'bad', label: 'Setup rejected', detail: node.configError, led };
  if (node.appliedRev !== node.configRev) return { tone: 'warn', label: 'Applying setup', detail: 'Sending the latest devices and pins to the board…', led };
  if (h?.vcc !== undefined && h.vcc < 3000) return { tone: 'warn', label: 'Low supply voltage', detail: `${(h.vcc / 1000).toFixed(2)} V — below 3.0 V the board can reset. Use a better USB cable or 5 V supply.`, led };
  if (h?.rssi !== undefined && h.rssi < -80) return { tone: 'warn', label: 'Weak Wi‑Fi', detail: `${h.rssi} dBm — move the board or the router closer.`, led };
  if (h?.heap !== undefined && h.heap < 8000) return { tone: 'warn', label: 'Low memory', detail: `${Math.round(h.heap / 1024)} KB free — remove a device or restart the board.`, led };
  if (h?.connects !== undefined && h.connects > 3) return { tone: 'warn', label: 'Unstable connection', detail: `Reconnected ${h.connects - 1} times since it started.`, led };
  return { tone: 'ok', label: 'Healthy', detail: 'Connected, powered and responding normally.', led };
}

function duration(sec?: number) {
  if (sec === undefined) return '—';
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min ${sec % 60} s`;
}
function signal(rssi?: number) {
  if (rssi === undefined) return { text: '—', bars: 0 };
  const bars = rssi > -55 ? 4 : rssi > -67 ? 3 : rssi > -75 ? 2 : rssi > -85 ? 1 : 0;
  return { text: `${['Very weak', 'Weak', 'Fair', 'Good', 'Excellent'][bars]} (${rssi} dBm)`, bars };
}

/** The status light: a big coloured LED with the board's condition. */
export function ConditionLight({ node }: { node: BoardNode }) {
  useNow(10_000);
  const c = boardCondition(node);
  const seen = node.lastSeenAt
    ? node.online
      ? `Last activity ${timeAgo(node.lastSeenAt)}`
      : `Last seen ${new Date(node.lastSeenAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} (${timeAgo(node.lastSeenAt)})`
    : 'Never connected';
  return (
    <div className={`condition tone-${c.tone}`}>
      <span className="condition-led" aria-hidden />
      <div className="stack-tight">
        <b>{c.label} <span className="condition-seen">· {seen}</span></b>
        <span>{c.detail}</span>
        <span className="condition-led-note">{c.led}</span>
      </div>
    </div>
  );
}

/** Voltage, signal, memory, uptime as reported by the board: four tiles. */
export function HealthPanel({ node }: { node: BoardNode }) {
  useNow(10_000);
  const h = node.health;
  if (!h) {
    return (
      <div className="card card-pad muted small">
        No health report yet. Boards send one every minute{node.firmware && node.firmware < '2.1' ? ' — update this board to firmware 2.1 to see voltage, memory and more' : ''}.
      </div>
    );
  }
  const sig = signal(h.rssi);
  const vccTone = h.vcc === undefined ? '' : h.vcc < 3000 ? 'bad' : h.vcc < 3150 ? 'warn' : 'ok';
  const heapTone = h.heap === undefined ? '' : h.heap < 8000 ? 'bad' : h.heap < 15000 ? 'warn' : 'ok';
  const tiles: { label: string; value: string; sub?: string; tone?: string; extra?: React.ReactNode; tip?: string }[] = [
    { label: 'Supply voltage', tip: 'The 3.3 V the chip runs on. Below 3.0 V it may restart by itself — try a better USB cable or 5 V adapter.', value: h.vcc !== undefined ? `${(h.vcc / 1000).toFixed(2)} V` : '—', sub: h.vcc !== undefined ? 'needs 3.0–3.6 V' : 'not measured (A0 in use)', tone: vccTone },
    { label: 'Wi‑Fi signal', tip: 'How well the board hears your router. dBm closer to 0 is better: −50 excellent, −80 weak.', value: sig.text.split(' (')[0]!, sub: `${h.rssi ?? '—'} dBm${h.ssid ? ` · ${h.ssid}` : ''}${h.channel ? ` · ch ${h.channel}` : ''}`,
      tone: sig.bars >= 2 ? 'ok' : sig.bars === 1 ? 'warn' : 'bad',
      extra: <span className="bars" aria-hidden>{[1, 2, 3, 4].map((b) => <i key={b} className={b <= sig.bars ? 'on' : ''} />)}</span> },
    { label: 'Free memory', tip: 'Working memory left on the chip. Under 8 KB it can become unstable; a restart frees it.', value: h.heap !== undefined ? `${(h.heap / 1024).toFixed(1)} KB` : '—', sub: h.heapFrag !== undefined ? `${h.heapFrag}% fragmented` : undefined, tone: heapTone },
    { label: 'Running for', tip: 'Time since the board last started. “Power On” is normal; “Exception” or “Watchdog” means it crashed.', value: duration(h.uptime), sub: h.reset ? `last restart: ${h.reset}` : undefined },
  ];
  return (
    <div className="stats" style={{ marginBottom: 0 }}>
        {tiles.map((t) => (
          <div key={t.label} className={`stat health-${t.tone ?? ''}`}>
            <div className="spread"><span className="stat-label">{t.label}{t.tip && <Tip>{t.tip}</Tip>}</span>{t.extra}</div>
            <div className="stat-value health-value">{t.value}</div>
            {t.sub && <span className="small muted">{t.sub}</span>}
          </div>
        ))}
    </div>
  );
}

/** Chip details the board reports (shown once, in the board's details). */
export function hardwareFacts(node: BoardNode): [string, string][] {
  const h = node.health;
  if (!h) return [];
  return [
    ['Processor', h.cpuMhz ? `${h.cpuMhz} MHz` : '—'],
    ['Flash chip', h.flashKb ? `${(h.flashKb / 1024).toFixed(0)} MB` : '—'],
    ['Firmware size', h.sketchKb ? `${h.sketchKb} KB used · ${h.freeSketchKb ?? '?'} KB free for updates` : '—'],
    ['Largest free block', h.maxBlock ? `${(h.maxBlock / 1024).toFixed(1)} KB` : '—'],
    ['Server connections', h.connects !== undefined ? `${h.connects} since start${h.connects > 1 ? ` (dropped ${h.connects - 1}×)` : ''}` : '—'],
  ];
}

export function signalLabel(rssi: number | null | undefined) {
  return signal(rssi ?? undefined).text;
}
