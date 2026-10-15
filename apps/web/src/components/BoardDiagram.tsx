'use client';
import type { BoardNode, Catalog } from '@/lib/types';

/**
 * Top view of the board as printed on the PCB (antenna up, USB down), with every header pin.
 * Each pin shows whether it is used (and by what), free to use, or reserved (power, flash, serial, boot).
 */
type Side = (string | null)[];
const LAYOUTS: Record<string, { left: Side; right: Side; chip: string; usb: string; horizontal?: boolean }> = {
  // The black LoLin / v3 board, as in the photo: antenna on the left, USB on the right.
  // `right` = the row along the top edge, `left` = the row along the bottom edge, both read left to right.
  NODEMCU_V3: {
    right: ['D0', 'D1', 'D2', 'D3', 'D4', '3V', 'G', 'D5', 'D6', 'D7', 'D8', 'RX', 'TX', 'G', '3V'],
    left: ['A0', 'G', 'VU', 'S3', 'S2', 'S1', 'SC', 'S0', 'SK', 'G', '3V', 'EN', 'RST', 'G', 'VIN'],
    chip: 'ESP-12E', usb: 'micro-USB', horizontal: true,
  },
  NODEMCU_V2: {
    left: ['A0', 'RSV', 'RSV', 'SD3', 'SD2', 'SD1', 'CMD', 'SD0', 'CLK', 'GND', '3V3', 'EN', 'RST', 'GND', 'VIN'],
    right: ['D0', 'D1', 'D2', 'D3', 'D4', '3V3', 'GND', 'D5', 'D6', 'D7', 'D8', 'RX', 'TX', 'GND', '3V3'],
    chip: 'ESP-12E', usb: 'micro-USB',
  },
  WEMOS_D1_MINI: {
    left: ['RST', 'A0', 'D0', 'D5', 'D6', 'D7', 'D8', '3V3'],
    right: ['TX', 'RX', 'D1', 'D2', 'D3', 'D4', 'GND', '5V'],
    chip: 'ESP-8266EX', usb: 'USB',
  },
};

const POWER_WHY: Record<string, string> = {
  G: 'ground (0 V)', GND: 'ground (0 V)', '3V': '3.3 V out — for sensors', '3V3': '3.3 V out — for sensors',
  VU: '5 V from USB — for relay modules', VIN: '5 V in/out — for relay modules', '5V': '5 V',
};
const GPIO: Record<string, number> = { A0: 17, D0: 16, D1: 5, D2: 4, D3: 0, D4: 2, D5: 14, D6: 12, D7: 13, D8: 15, RX: 3, TX: 1 };
const RESERVED_WHY: Record<string, string> = {
  D8: 'Must be LOW at boot — not offered', RX: 'Serial (logs and flashing)', TX: 'Serial (logs and flashing)',
  SD3: 'Flash chip', SD2: 'Flash chip', SD1: 'Flash chip', CMD: 'Flash chip', SD0: 'Flash chip', CLK: 'Flash chip',
  RSV: 'Not connected', S3: 'Flash chip', S2: 'Flash chip', S1: 'Flash chip', SC: 'Flash chip', S0: 'Flash chip', SK: 'Flash chip', A0: 'Analog input (not used yet)', EN: 'Enable', RST: 'Reset',
};

type PinInfo =
  | { kind: 'power'; label: string }
  | { kind: 'reserved'; label: string; why: string }
  | { kind: 'free'; label: string; gpio: number; note?: string; uses: string[] }
  | { kind: 'used'; label: string; gpio: number; what: string; tone: 'switch' | 'sensor' | 'button'; on?: boolean };

/** How many usable pins are taken and free on this board. */
export function pinStats(node: BoardNode, catalog: Catalog) {
  const allowed = catalog.boards.find((b) => b.type === node.board)?.pins ?? [];
  const taken = new Set([...node.devices.map((d) => d.pin), ...node.inputs.map((i) => i.pin)]);
  const usable = allowed.filter((p) => !(p.gpio === 17 && node.health?.vcc !== undefined));
  const used = usable.filter((p) => taken.has(p.gpio)).length;
  return { used, free: usable.length - used };
}

export function BoardDiagram({ node, catalog }: { node: BoardNode; catalog: Catalog }) {
  const layout = LAYOUTS[node.board] ?? LAYOUTS.NODEMCU_V2!;
  const allowed = catalog.boards.find((b) => b.type === node.board)?.pins ?? [];

  const info = (label: string): PinInfo => {
    if (/^(GND|G|3V3|3V|VIN|VU|5V)$/.test(label)) return { kind: 'power', label };
    const gpio = GPIO[label];
    if (gpio === undefined) return { kind: 'reserved', label, why: RESERVED_WHY[label] ?? 'Reserved' };
    const device = node.devices.find((d) => d.pin === gpio);
    if (device) {
      const sensor = !catalog.deviceTypes.find((t) => t.type === device.type)?.controllable;
      return { kind: 'used', label, gpio, what: device.name, tone: sensor ? 'sensor' : 'switch', on: device.state?.on === true };
    }
    const input = node.inputs.find((i) => i.pin === gpio);
    if (input) return { kind: 'used', label, gpio, what: `Button → ${input.targetName}`, tone: 'button' };
    if (gpio === 17 && node.health?.vcc !== undefined) return { kind: 'reserved', label, why: 'Measuring the board’s supply voltage' };
    const pin = allowed.find((p) => p.gpio === gpio);
    if (pin) return { kind: 'free', label, gpio, note: pin.note, uses: pin.uses };
    return { kind: 'reserved', label, why: RESERVED_WHY[label] ?? 'Not offered' };
  };

  const left = layout.left.map((l) => info(l!));
  const right = layout.right.map((l) => info(l!));
  const used = [...left, ...right].filter((p) => p.kind === 'used').length;
  const free = [...left, ...right].filter((p) => p.kind === 'free').length;

  const title = (p: PinInfo) =>
    p.kind === 'power' ? `${p.label}: ${POWER_WHY[p.label] ?? 'power'}`
      : p.kind === 'reserved' ? `${p.label}: ${p.why}`
      : p.kind === 'free' ? `${p.label} (GPIO ${p.gpio}) free — ${p.uses.join(', ')}${p.note ? `. ${p.note}` : ''}`
      : `${p.label} (GPIO ${p.gpio}): ${p.what}`;

  const Tag = ({ p }: { p: PinInfo }) =>
    p.kind === 'used' ? <span className={`pin-tag tag-${p.tone} ${p.on ? 'is-on' : ''}`}>{p.what}</span>
      : p.kind === 'free' ? <span className="pin-tag tag-free">free</span>
      : <span />;

  return (
    <div className="board-diagram">
      <div className="pin-legend">
        <span><i className="pin-dot pin-used" /> In use ({used})</span>
        <span><i className="pin-dot pin-free" /> Free ({free})</span>
        <span><i className="pin-dot pin-power" /> Power</span>
        <span><i className="pin-dot pin-reserved" /> Reserved</span>
      </div>
      {layout.horizontal ? (
        <div className="hboard-wrap">
          <div className="hboard">
            <div className="hrow htags top">{right.map((p, i) => <div key={i} className="hcell" title={title(p)}><Tag p={p} /></div>)}</div>
            <div className="hpcb">
              <div className="hrow hpins">{right.map((p, i) => (
                <div key={i} className="hcell" title={title(p)}><i className={`pin-dot pin-${p.kind}`} /><span className="pin-label">{p.label}</span></div>
              ))}</div>
              <div className="hpcb-mid">
                <div className="hmodule"><span className="hantenna" /><span className="hshield">{layout.chip}</span></div>
                <span className="hchip">CH340</span>
                <span className="hbtns"><i title="RST button" /><i title="FLASH button" /></span>
                <span className="husb">{layout.usb}</span>
              </div>
              <div className="hrow hpins">{left.map((p, i) => (
                <div key={i} className="hcell" title={title(p)}><span className="pin-label">{p.label}</span><i className={`pin-dot pin-${p.kind}`} /></div>
              ))}</div>
            </div>
            <div className="hrow htags bottom">{left.map((p, i) => <div key={i} className="hcell" title={title(p)}><Tag p={p} /></div>)}</div>
          </div>
        </div>
      ) : (
      <div className="pinout" style={{ gridTemplateRows: `56px repeat(${layout.left.length}, 26px) 48px` }}>
        <div className="pcb" style={{ gridRow: `1 / span ${layout.left.length + 2}` }}>
          <div className="pcb-chip"><span>{layout.chip}</span></div>
          <div className="pcb-usb">{layout.usb}</div>
        </div>
        {left.map((p, i) => (
          <div key={`l${i}`} className="pin-row left" style={{ gridRow: i + 2 }} title={title(p)}>
            <Tag p={p} /><span className="pin-label">{p.label}</span><i className={`pin-dot pin-${p.kind}`} />
          </div>
        ))}
        {right.map((p, i) => (
          <div key={`r${i}`} className="pin-row right" style={{ gridRow: i + 2 }} title={title(p)}>
            <i className={`pin-dot pin-${p.kind}`} /><span className="pin-label">{p.label}</span><Tag p={p} />
          </div>
        ))}
      </div>
      )}
    </div>
  );
}
