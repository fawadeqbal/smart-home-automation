'use client';
import { FormEvent, useMemo, useState } from 'react';
import { errorText } from '@/lib/api';
import type { BoardNode, Catalog, NodeDevice, Room } from '@/lib/types';
import { Tip } from './Help';

export interface DeviceFormValues {
  name: string;
  type: string;
  pin: number;
  activeLow: boolean;
  roomId: string | null;
  aliases: string[];
  settings: Record<string, unknown>;
}

/** Pins of this board that suit the use and are not taken (the current device's own pin stays allowed). */
export function freePins(catalog: Catalog, node: BoardNode, use: string, keep?: number) {
  const board = catalog.boards.find((b) => b.type === node.board) ?? catalog.boards[0];
  const taken = new Set([...node.devices.map((d) => d.pin), ...node.inputs.map((i) => i.pin)]);
  if (keep !== undefined) taken.delete(keep);
  if (node.health?.vcc !== undefined) taken.add(17); // A0 is measuring the supply voltage
  return board.pins.filter((p) => p.uses.includes(use as never) && !taken.has(p.gpio));
}

const PLACEHOLDER: Record<string, string> = { dht: 'Room climate', contact: 'Front door', analog: 'Living room light level' };

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
  const pins = useMemo(() => freePins(catalog, node, def.pinUse, initial?.pin), [catalog, node, def.pinUse, initial?.pin]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const settings = (initial?.settings ?? {}) as { model?: string; intervalSec?: number; kind?: string; invert?: boolean };
  const [contactKind, setContactKind] = useState(settings.kind ?? 'door');

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
          : {},
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
        <label className="field"><span>Pin it is wired to <Tip>The label printed next to the pin on your board (D1, D2…). Only safe pins that are still free are listed.</Tip></span>
          <select name="pin" defaultValue={initial?.pin} required>
            {pins.map((p) => <option key={p.gpio} value={p.gpio}>{p.label} (GPIO {p.gpio}){p.note ? ` — ${p.note}` : ''}</option>)}
          </select>
        </label>
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
            <select name="kind" value={contactKind} onChange={(e) => setContactKind(e.target.value)}>
              <option value="door">Door (open / closed)</option>
              <option value="window">Window (open / closed)</option>
              <option value="motion">Motion (PIR)</option>
              <option value="leak">Water leak</option>
              <option value="mains">Grid power (mains-sense module: UPS mode)</option>
              <option value="generic">Other on/off contact</option>
            </select>
          </label>
        )}
        {type === 'contact' && contactKind === 'mains' && (
          <div className="wiring-note" role="note">
            <span aria-hidden>⚠</span>
            <span>An electrician wires a mains-sense module to a circuit fed only by the grid (not the UPS); the module’s low-voltage output goes to this pin. <b>Never connect mains to the board.</b> It reads “active” while the grid is on.</span>
          </div>
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
