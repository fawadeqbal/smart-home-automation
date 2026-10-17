'use client';
import Link from 'next/link';
import { useState } from 'react';
import { errorText, post } from '@/lib/api';
import { timeAgo } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { Device } from '@/lib/types';
import { Icon } from './Icon';
import { analogLabel, contactText, deviceIcon } from '@/lib/format';
import { Spinner } from './Loader';

function fmt(value: unknown): string {
  return typeof value === 'number' ? (Number.isInteger(value) ? String(value) : value.toFixed(1)) : '–';
}

/** A device tile: tap a switch to turn it on or off (amber = on); sensors show their reading. */
export function DeviceCard({ device, onChange }: { device: Device; onChange: (d: Device) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const on = device.state?.on === true && device.online;
  const { isAdmin } = useSession();
  const viewOnly = device.access === 'VIEW';
  const sensor = !device.controllable;
  const locked = !!device.childLock && !isAdmin;
  const canSwitch = !sensor && device.online && !viewOnly && device.enabled && !locked;

  async function toggle() {
    if (!canSwitch) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await post<Device>(`/devices/${device.id}/commands`, { on: !(device.state?.on === true) }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const reading = sensor ? sensorReading(device) : null;
  const meta = !device.online ? 'Offline'
    : busy ? 'Switching…'
      : sensor ? `Updated ${timeAgo(device.updatedAt)}`
        : `${on ? 'On' : 'Off'}${device.source === 'button' ? ' · wall switch' : ''}`;
  const extra = viewOnly && !sensor ? ' · view only' : locked ? ' · child lock' : '';
  const classes = ['tile', sensor ? 'sensor' : '', on ? 'is-on' : '', !device.online ? 'is-offline' : ''].join(' ');
  const body = (
    <>
      <span className="tile-icon"><Icon name={!device.online ? 'wifi-off' : locked ? 'lock' : deviceIcon(device.type, device.settings, device.name)} size={19} /></span>
      <span className="tile-text">
        <b>{device.name}</b>
        {reading && device.online
          ? <span className={`reading ${reading.alert ? 'alert-text' : ''}`}>{reading.text}</span>
          : <span>{meta}{extra}</span>}
      </span>
      {busy && <Spinner size={16} />}
    </>
  );

  return (
    <div className={classes}>
      {sensor ? (
        <div className="tile-body">{body}</div>
      ) : (
        <button className="tile-body" onClick={toggle} disabled={!canSwitch || busy} aria-pressed={on}
          aria-label={`${device.name}: ${meta}${extra}. ${canSwitch ? `Tap to turn ${on ? 'off' : 'on'}.` : ''}`}
          title={viewOnly ? 'You can see this device but not switch it' : locked ? 'Child lock: only the owner or an admin can switch it' : !device.online ? 'Its board is offline — the wall switch still works' : undefined}>
          {body}
        </button>
      )}
      <Link className="tile-more" href={`/devices/${device.id}`} aria-label={`${device.name}: details and history`} title="Details and history">
        <Icon name="chevron-right" size={16} />
      </Link>
      {error && <div className="tile-error">{error}</div>}
    </div>
  );
}

/** A sensor's reading in one line: "27.5° · 61% humidity", "Closed", "62% tank". */
function sensorReading(device: Device): { text: string; alert: boolean } {
  if (device.type === 'contact') {
    return { text: contactText(device.settings, device.state?.active), alert: !!device.state?.active && device.settings?.kind === 'leak' };
  }
  if (device.type === 'analog') return { text: `${fmt(device.state?.level)}% ${analogLabel(device.settings)}`.trim(), alert: false };
  const parts = device.stateFields.map((f, i) => {
    const v = fmt(device.state?.[f.key]);
    if (i === 0) return `${v}${f.unit === '°C' ? '°' : f.unit ?? ''}`;
    return `${v}${f.unit ?? ''} ${f.label.toLowerCase()}`;
  });
  return { text: parts.join(' · ') || '–', alert: false };
}
