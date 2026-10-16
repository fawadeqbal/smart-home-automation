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

  const meta = !device.online ? 'Offline'
    : sensor ? `Updated ${timeAgo(device.updatedAt)}`
      : busy ? 'Switching…' : `${on ? 'On' : 'Off'}${device.source === 'button' ? ' · wall switch' : ''}`;
  const classes = ['tile', sensor ? 'sensor' : '', on ? 'is-on' : '', !device.online ? 'is-offline' : ''].join(' ');
  const body = (
    <>
      <span className="tile-top">
        <span className="tile-icon"><Icon name={deviceIcon(device.type, device.settings)} size={18} /></span>
        {!sensor && (busy ? <Spinner size={20} /> : <span className="toggle" aria-hidden />)}
      </span>
      {sensor && (
        <span className="tile-read">
          {device.type === 'contact' ? (
            <span className={`v ${device.state?.active && device.settings?.kind === 'leak' ? 'alert-text' : ''}`}>{contactText(device.settings, device.state?.active)}</span>
          ) : device.type === 'analog' ? (
            <><span className="v">{fmt(device.state?.level)}%</span><span className="x">{analogLabel(device.settings)}</span></>
          ) : (
            device.stateFields.map((f, i) => (
              <span key={f.key} className={i === 0 ? 'v' : 'x'}>
                {fmt(device.state?.[f.key])}{i === 0 ? (f.unit === '°C' ? '°' : f.unit) : f.unit}{i > 0 ? ` ${f.label.toLowerCase()}` : ''}
              </span>
            ))
          )}
        </span>
      )}
      <span className="tile-text"><b>{device.name}</b><span>{meta}{viewOnly && !sensor ? ' · view only' : locked ? ' · child lock' : ''}</span></span>
    </>
  );

  return (
    <div className={classes}>
      {sensor ? (
        <div className="tile-body">{body}</div>
      ) : (
        <button className="tile-body" onClick={toggle} disabled={!canSwitch || busy} aria-pressed={on}
          title={viewOnly ? 'You can see this device but not switch it' : locked ? 'Child lock: only the owner or an admin can switch it' : !device.online ? 'Its board is offline — the wall switch still works' : undefined}>
          {body}
        </button>
      )}
      {error && <div className="tile-error">{error}</div>}
      <Link className="tile-foot" href={`/devices/${device.id}`}>History<Icon name="chevron-right" size={14} /></Link>
    </div>
  );
}
