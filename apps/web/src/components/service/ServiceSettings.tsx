'use client';
import { FormEvent, useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { ErrorBox, useAction } from '@/components/ui';
import { get, patch, put } from '@/lib/api';
import type { OrgDetails, PriceItem } from '@/lib/types';
import './service.css';

/**
 * Company settings for the service work: how customers pay (in bill reminders), where the installers
 * start their day (the day planner's driving order) and when to warn about low stock.
 */
export function ServiceSettings({ org, onSaved }: { org: OrgDetails; onSaved: (o: OrgDetails) => void }) {
  const { busy, error, run } = useAction();
  const [saved, setSaved] = useState(false);
  const [lat, setLat] = useState(org.baseLat?.toString() ?? '');
  const [lng, setLng] = useState(org.baseLng?.toString() ?? '');

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => (String(f.get(k) ?? '').trim() || null);
    const base = lat.trim() && lng.trim() ? { baseLat: Number(lat), baseLng: Number(lng) } : { baseLat: null, baseLng: null };
    const next = await run(() => patch<OrgDetails>('/platform/org', {
      bankAccount: v('bankAccount'), jazzcashNumber: v('jazzcashNumber'), easypaisaNumber: v('easypaisaNumber'),
      ...base, stockMin: Math.max(0, Number(f.get('stockMin')) || 0),
    }));
    if (next) { onSaved(next); setSaved(true); setTimeout(() => setSaved(false), 2000); }
  }

  function here() {
    navigator.geolocation?.getCurrentPosition((p) => { setLat(p.coords.latitude.toFixed(5)); setLng(p.coords.longitude.toFixed(5)); }, () => undefined, { enableHighAccuracy: true, timeout: 10_000 });
  }

  return (
    <form className="panel panel-pad stack" onSubmit={save}>
      <h2>Payments, base and stock</h2>
      <p className="small muted" style={{ margin: 0 }}>How customers pay goes into the bill reminders you send on WhatsApp.</p>
      <label className="field">Bank account <span className="hint">bank, account title and IBAN</span>
        <input name="bankAccount" maxLength={300} defaultValue={org.bankAccount ?? ''} placeholder="Meezan Bank · Your Company · PK36MEZN0001234567890" />
      </label>
      <div className="form-grid">
        <label className="field">JazzCash number<input name="jazzcashNumber" maxLength={24} inputMode="tel" defaultValue={org.jazzcashNumber ?? ''} placeholder="0300 1234567" /></label>
        <label className="field">Easypaisa number<input name="easypaisaNumber" maxLength={24} inputMode="tel" defaultValue={org.easypaisaNumber ?? ''} placeholder="0345 1234567" /></label>
      </div>
      <div className="stack-sm">
        <span className="small"><b>Your base</b> <span className="muted">— where installers start the day (office or store). My day orders the stops from here.</span></span>
        <div className="form-grid">
          <label className="field">Latitude<input value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" placeholder="31.5204" /></label>
          <label className="field">Longitude<input value={lng} onChange={(e) => setLng(e.target.value)} inputMode="decimal" placeholder="74.3587" /></label>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-sm" onClick={here}><Icon name="map-pin" size={14} />Use where I am now</button>
          {lat && lng && <a className="btn btn-sm btn-ghost" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`} target="_blank" rel="noreferrer"><Icon name="external" size={14} />Check on the map</a>}
        </div>
      </div>
      <label className="field">Warn me when boards in stock drop below <span className="hint">0: never</span>
        <input name="stockMin" type="number" min={0} max={10000} defaultValue={org.stockMin ?? 0} style={{ maxWidth: 140 }} />
      </label>
      <ErrorBox error={error} />
      <div className="row"><button className="btn btn-primary" disabled={busy}>{saved ? 'Saved ✓' : 'Save'}</button></div>
    </form>
  );
}

/** The price list quotes are made from (rupees). Super admins change it; quotes keep the prices they had. */
export function PriceList() {
  const [items, setItems] = useState<PriceItem[] | null>(null);
  const [rows, setRows] = useState<(Omit<PriceItem, 'id'> & { id?: string })[]>([]);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  useEffect(() => { void get<{ items: PriceItem[] }>('/platform/price-items').then((p) => { setItems(p.items); setRows(p.items); }).catch(() => undefined); }, []);
  if (!items) return null;
  const dirty = JSON.stringify(rows) !== JSON.stringify(items);
  const set = (i: number, change: Partial<PriceItem>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...change } : r)));
  return (
    <section className="panel panel-pad stack">
      <div className="spread"><h2>Price list</h2><span className="small muted">For quotes · rupees</span></div>
      <div className="table-wrap">
        <table className="quote-lines">
          <thead><tr><th>Item</th><th>Per</th><th className="num">Price (Rs)</th><th /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id ?? `new-${i}`}>
                <td><input value={r.name} maxLength={120} aria-label="Item" onChange={(e) => set(i, { name: e.target.value })} /></td>
                <td><input value={r.unit} maxLength={20} aria-label="Per" style={{ width: 90 }} onChange={(e) => set(i, { unit: e.target.value })} /></td>
                <td className="num"><input className="price" type="number" min={0} step={50} value={r.price} aria-label="Price" onChange={(e) => set(i, { price: Math.max(0, Number(e.target.value) || 0) })} /></td>
                <td><button type="button" className="icon-btn" aria-label={`Remove ${r.name}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}><Icon name="x" size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn btn-sm" onClick={() => setRows((rs) => [...rs, { name: '', unit: 'each', price: 0 }])}><Icon name="plus" size={14} />Add an item</button>
        <span className="grow" />
        {(dirty || saved) && (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || !dirty || rows.some((r) => !r.name.trim())}
                  onClick={() => void run(async () => { const p = await put<{ items: PriceItem[] }>('/platform/price-items', { items: rows }); setItems(p.items); setRows(p.items); setSaved(true); setTimeout(() => setSaved(false), 2000); })}>
            {saved && !dirty ? 'Saved ✓' : 'Save prices'}
          </button>
        )}
      </div>
      <ErrorBox error={error} />
    </section>
  );
}
