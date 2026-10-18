'use client';
import { FormEvent, useMemo, useState } from 'react';
import { errorText } from '@/lib/api';
import { devicePins } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import type { BoardNode, Catalog, Device, NodeDevice, Room } from '@/lib/types';
import { Tip } from './Help';

export interface DeviceFormValues {
  name: string;
  type: string;
  pin: number;
  activeLow: boolean;
  roomId: string | null;
  aliases: string[];
  settings: Record<string, unknown>;
  restoreOff: boolean;
}

/** Pins of this board that suit the use and are not taken (the pins of the device being edited stay allowed). */
export function freePins(catalog: Catalog, node: BoardNode, use: string, keep?: number | number[]) {
  const board = catalog.boards.find((b) => b.type === node.board) ?? catalog.boards[0];
  const taken = new Set([...node.devices.flatMap((d) => devicePins(d)), ...node.inputs.map((i) => i.pin)]);
  for (const k of keep === undefined ? [] : Array.isArray(keep) ? keep : [keep]) taken.delete(k);
  if (node.health?.vcc !== undefined) taken.add(17); // A0 is measuring the supply voltage
  return board.pins.filter((p) => p.uses.includes(use as never) && !taken.has(p.gpio));
}

const PLACEHOLDER: Record<string, string> = { dht: 'Room climate', contact: 'Front door', analog: 'Living room light level', fan: 'Ceiling fan', tank: 'Roof tank' };

type Settings = {
  model?: string; intervalSec?: number; kind?: string; invert?: boolean; pins?: number[];
  echoPin?: number; emptyCm?: number; fullCm?: number; motorDeviceId?: string; fillBelowPct?: number; stopAtPct?: number;
  dryRunMin?: number; maxRunMin?: number;
};

/** Add or edit a device on a board: name, type, pin (only valid free pins offered), room, polarity, settings. */
export function DeviceForm({ catalog, node, rooms, initial, submitLabel, onSubmit, onCancel }: {
  catalog: Catalog;
  node: BoardNode;
  rooms: Room[];
  initial?: NodeDevice;
  submitLabel: string;
  onSubmit: (values: DeviceFormValues) => Promise<void>;
  onCancel?: () => void;
}) {
  const [type, setType] = useState(initial?.type ?? 'switch');
  const def = catalog.deviceTypes.find((t) => t.type === type)!;
  const own = initial ? devicePins(initial) : undefined;
  const pins = useMemo(() => freePins(catalog, node, def.pinUse, own), [catalog, node, def.pinUse, own?.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const outputs = useMemo(() => freePins(catalog, node, 'output', own), [catalog, node, own?.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const inputs = useMemo(() => freePins(catalog, node, 'input', own), [catalog, node, own?.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const settings = (initial?.settings ?? {}) as Settings;
  const [kind, setKind] = useState(settings.kind ?? 'door');
  // a tank's motor can be on any board of the home
  const motors = useLoad<Device[]>(type === 'tank' ? '/devices' : null).data?.filter((d) => d.controllable) ?? [];
  const switching = def.controllable;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        name: String(f.get('name')).trim(),
        type,
        pin: Number(f.get('pin')),
        activeLow: f.get('activeLow') === 'on',
        roomId: (f.get('roomId') as string) || null,
        aliases: String(f.get('aliases') ?? '').split(',').map((a) => a.trim()).filter(Boolean),
        settings:
          type === 'dht' ? { model: f.get('model'), intervalSec: Number(f.get('intervalSec')) }
          : type === 'contact' ? { kind: f.get('kind') }
          : type === 'analog' ? { kind: f.get('kind'), intervalSec: Number(f.get('intervalSec')), invert: f.get('invert') === 'on' }
          : type === 'fan' ? { pins: [Number(f.get('relay2')), Number(f.get('relay3'))] }
          : type === 'tank' ? {
            echoPin: Number(f.get('echoPin')), emptyCm: Number(f.get('emptyCm')), fullCm: Number(f.get('fullCm')),
            intervalSec: Number(f.get('intervalSec')), motorDeviceId: String(f.get('motorDeviceId') ?? ''),
            fillBelowPct: Number(f.get('fillBelowPct')), stopAtPct: Number(f.get('stopAtPct')),
            dryRunMin: Number(f.get('dryRunMin')), maxRunMin: Number(f.get('maxRunMin')),
          }
          : {},
        restoreOff: f.get('restoreOff') === 'off',
      });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="subtle-box stack" onSubmit={submit}>
      <div className="form-grid">
        <label className="field">Name
          <input name="name" defaultValue={initial?.name} placeholder={PLACEHOLDER[type] ?? 'Bulb'} required maxLength={60} />
        </label>
        <label className="field">Type
          <select value={type} onChange={(e) => setType(e.target.value)} disabled={!!initial}>
            {catalog.deviceTypes.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
          </select>
        </label>
        <label className="field"><span>{type === 'fan' ? 'Relay 1 (small capacitor) pin' : type === 'tank' ? 'Sensor TRIG pin' : 'Pin it is wired to'} <Tip>The label printed next to the pin on your board (D1, D2…). Only safe pins that are still free are listed.</Tip></span>
          <select name="pin" defaultValue={initial?.pin} required>
            {pins.map((p) => <option key={p.gpio} value={p.gpio}>{p.label} (GPIO {p.gpio}){p.note ? ` — ${p.note}` : ''}</option>)}
          </select>
        </label>
        {type === 'fan' && (
          <>
            <label className="field"><span>Relay 2 (bigger capacitor) pin <Tip>The usual 3-relay regulator: relay 1 and relay 2 switch two capacitors (speeds 1, 2 and 3 with both), relay 3 bypasses them for full speed.</Tip></span>
              <select name="relay2" defaultValue={settings.pins?.[0] ?? outputs[1]?.gpio} required>
                {outputs.map((p) => <option key={p.gpio} value={p.gpio}>{p.label} (GPIO {p.gpio})</option>)}
              </select>
            </label>
            <label className="field">Relay 3 (full speed) pin
              <select name="relay3" defaultValue={settings.pins?.[1] ?? outputs[2]?.gpio} required>
                {outputs.map((p) => <option key={p.gpio} value={p.gpio}>{p.label} (GPIO {p.gpio})</option>)}
              </select>
            </label>
          </>
        )}
        {type === 'tank' && (
          <>
            <label className="field"><span>Sensor ECHO pin <Tip>The JSN‑SR04T&apos;s echo output is 5 V: connect it through a divider (e.g. 1 kΩ and 2 kΩ), never straight to the board.</Tip></span>
              <select name="echoPin" defaultValue={settings.echoPin ?? inputs.find((p) => p.gpio !== pins[0]?.gpio)?.gpio} required>
                {inputs.map((p) => <option key={p.gpio} value={p.gpio}>{p.label} (GPIO {p.gpio})</option>)}
              </select>
            </label>
            <label className="field"><span>Distance when empty (cm) <Tip>From the sensor down to the water when the tank is empty — usually the tank&apos;s depth.</Tip></span>
              <input name="emptyCm" type="number" min={20} max={600} defaultValue={settings.emptyCm ?? 150} required />
            </label>
            <label className="field"><span>Distance when full (cm) <Tip>From the sensor to the water when it is full. The sensor can&apos;t see closer than about 20 cm.</Tip></span>
              <input name="fullCm" type="number" min={20} max={400} defaultValue={settings.fullCm ?? 25} required />
            </label>
            <label className="field">Read every (seconds)
              <input name="intervalSec" type="number" min={5} max={600} defaultValue={settings.intervalSec ?? 30} />
            </label>
            <label className="field"><span>Water motor <Tip>On this board, the board stops the motor by itself when the tank is full, even without internet.</Tip></span>
              <select name="motorDeviceId" defaultValue={settings.motorDeviceId ?? ''}>
                <option value="">No motor (just show the level)</option>
                {motors.map((d) => <option key={d.id} value={d.id}>{d.name}{d.nodeId === node.id ? ' (this board)' : ` (${d.nodeName})`}</option>)}
              </select>
            </label>
            <label className="field"><span>Start the motor below (%) <Tip>0 = never by itself. People can always switch it on.</Tip></span>
              <input name="fillBelowPct" type="number" min={0} max={90} defaultValue={settings.fillBelowPct ?? 0} />
            </label>
            <label className="field">Stop the motor at (%)
              <input name="stopAtPct" type="number" min={50} max={100} defaultValue={settings.stopAtPct ?? 95} />
            </label>
            <label className="field"><span>Stop if not rising after (min) <Tip>A dry well or a closed valve: the motor is stopped and people are told.</Tip></span>
              <input name="dryRunMin" type="number" min={2} max={60} defaultValue={settings.dryRunMin ?? 10} />
            </label>
            <label className="field">Never run longer than (min)
              <input name="maxRunMin" type="number" min={5} max={240} defaultValue={settings.maxRunMin ?? 60} />
            </label>
          </>
        )}
        <label className="field">Room
          <select name="roomId" defaultValue={initial?.roomId ?? rooms[0]?.id ?? ''}>
            <option value="">No room (admins only)</option>
            {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        {def.hasActiveLow && type === 'contact' && (
          <label className="field">Active when
            <select name="activeLow" defaultValue={initial ? (initial.activeLow ? 'on' : '') : 'on'}>
              <option value="on">Pin is connected to GND (reed switch, leak probe)</option>
              <option value="">Pin goes HIGH (PIR motion module)</option>
            </select>
          </label>
        )}
        {type === 'contact' && (
          <label className="field">What it senses
            <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="door">Door (open / closed)</option>
              <option value="window">Window (open / closed)</option>
              <option value="motion">Motion (PIR)</option>
              <option value="leak">Water leak</option>
              <option value="mains">Grid power (WAPDA) sense</option>
              <option value="generic">Other on/off contact</option>
            </select>
          </label>
        )}
        {type === 'contact' && kind === 'mains' && (
          <div className="notice span-2">An electrician wires a mains-sense module (an optocoupler module, or a small 5 V adapter through a divider) to a <b>grid-only</b> socket, not one on the UPS. Never connect mains to the board. &ldquo;Active&rdquo; = grid power is on.</div>
        )}
        {type === 'analog' && (
          <>
            <label className="field">What it measures
              <select name="kind" defaultValue={settings.kind ?? 'light'}>
                <option value="light">Light level (LDR)</option>
                <option value="gas">Gas / smoke (MQ-2, MQ-135)</option>
                <option value="moisture">Soil moisture</option>
                <option value="water">Water level</option>
                <option value="generic">Other (0–100 %)</option>
              </select>
            </label>
            <label className="field">Read every (seconds)
              <input name="intervalSec" type="number" min={1} max={3600} defaultValue={settings.intervalSec ?? 10} />
            </label>
            <label className="field">Reverse the scale
              <select name="invert" defaultValue={settings.invert ? 'on' : ''}>
                <option value="">No (higher voltage = higher %)</option>
                <option value="on">Yes (e.g. capacitive soil sensors read lower when wet)</option>
              </select>
            </label>
          </>
        )}
        {def.hasActiveLow && type !== 'contact' && (
          <label className="field">Relay module
            <select name="activeLow" defaultValue={initial ? (initial.activeLow ? 'on' : '') : 'on'}>
              <option value="on">Switches on LOW (most relay boards)</option>
              <option value="">Switches on HIGH</option>
            </select>
          </label>
        )}
        {type === 'dht' && (
          <>
            <label className="field">Sensor model
              <select name="model" defaultValue={settings.model ?? 'dht22'}>
                <option value="dht22">DHT22 / AM2302</option>
                <option value="dht11">DHT11</option>
              </select>
            </label>
            <label className="field">Read every (seconds)
              <input name="intervalSec" type="number" min={5} max={3600} defaultValue={settings.intervalSec ?? 30} />
            </label>
          </>
        )}
        {switching && (
          <label className="field"><span>After a power cut <Tip>Most things come back the way they were. A motor, an iron or a geyser is safer staying off until someone switches it on.</Tip></span>
            <select name="restoreOff" defaultValue={initial?.restoreOff ? 'off' : 'last'}>
              <option value="last">Comes back the way it was</option>
              <option value="off">Stays off</option>
            </select>
          </label>
        )}
        <label className="field"><span>Other names for voice <Tip>Extra words the assistant should understand for this device, separated by commas — e.g. lamp, batti, tube light.</Tip></span>
          <input name="aliases" defaultValue={initial?.aliases.join(', ')} placeholder="lamp, batti" />
        </label>
      </div>
      {pins.length === 0 && <div className="notice">No free pin on this board suits this type of device.</div>}
      {error && <div className="alert">{error}</div>}
      <div className="row">
        <button className="btn btn-primary" disabled={busy || pins.length === 0}>{busy ? 'Saving…' : submitLabel}</button>
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
