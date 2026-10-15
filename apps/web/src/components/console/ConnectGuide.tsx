'use client';
import { useEffect, useState } from 'react';
import { errorText, get } from '@/lib/api';
import { Icon } from '../Icon';
import { Spinner } from '../Loader';

interface SetupInfo { server: string | null; port: number; login: string; password: string; encrypted: boolean }

function Copy({ value, secret = false }: { value: string; secret?: boolean }) {
  const [shown, setShown] = useState(!secret);
  const [copied, setCopied] = useState(false);
  return (
    <span className="copy-field">
      <span className="mono">{shown ? value : '••••••••••'}</span>
      {secret && <button type="button" className="link-btn small" onClick={() => setShown((v) => !v)}>{shown ? 'Hide' : 'Show'}</button>}
      <button type="button" className="link-btn small" onClick={async () => {
        try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setShown(true); }
      }}>{copied ? 'Copied ✓' : 'Copy'}</button>
    </span>
  );
}

/** For the installer on site: flash, power, join the setup hotspot, type the server details. */
export function ConnectGuide() {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<SetupInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open && !info) get<SetupInfo>('/nodes/setup-info').then(setInfo).catch((e) => setError(errorText(e))); }, [open, info]);
  return (
    <section className="panel">
      <button className="diag-head" onClick={() => setOpen((o) => !o)} aria-expanded={open} style={{ padding: '12px 16px' }}>
        <span className="li-icon"><Icon name="wrench" size={15} /></span>
        <span className="li-text"><b>How to connect a board on site</b><span className="sub">Flash once, power it, fill in its setup page — it appears above, ready to install.</span></span>
        <span className="chev" style={{ transform: open ? 'rotate(180deg)' : 'none' }}><Icon name="chevron-down" size={16} /></span>
      </button>
      {open && (
        <div className="diag-body">
          <ol className="wizard-list" style={{ margin: 0 }}>
            <li><b>Firmware</b> (once per board, USB): open <span className="mono">firmware/home_node/home_node.ino</span> in Arduino IDE 2, board <b>NodeMCU 1.0 (ESP‑12E)</b>, upload speed 115200, press Upload. After this, updates go over Wi‑Fi.</li>
            <li><b>Power it</b> — its blue light blinks fast. On your phone join the Wi‑Fi <b>HomeNode‑xxxxxx</b> (no password); the setup page opens (or go to <span className="mono">http://192.168.4.1</span>).</li>
            <li><b>Setup page</b>: tap <b>Configure WiFi</b>, pick the home’s 2.4 GHz Wi‑Fi and its password, then fill in:</li>
          </ol>
          {!info && !error && <p className="row muted small"><Spinner /> Loading…</p>}
          {error && <div className="alert">{error}</div>}
          {info && (
            <table className="table setup-table">
              <tbody>
                <tr><th>Server address</th><td>{info.server ? <Copy value={info.server} /> : <span className="text-bad">Unknown — set PUBLIC_API_URL in .env</span>}</td></tr>
                <tr><th>Port</th><td><Copy value={String(info.port)} /></td></tr>
                <tr><th>Board login</th><td><Copy value={info.login} /></td></tr>
                <tr><th>Board password</th><td>{info.password ? <Copy value={info.password} secret /> : <span className="text-bad">MQTT_NODE_PASSWORD is not set</span>}</td></tr>
                <tr><th>Encrypted</th><td className="mono">{info.encrypted ? 'yes' : 'no'}</td></tr>
              </tbody>
            </table>
          )}
          <p className="small muted">Tap <b>Save</b>. When the board reaches the server its light goes dark and it shows as <b>Online · ready to install</b> in the list above — give it the name of where it is and press Install.</p>
        </div>
      )}
    </section>
  );
}
