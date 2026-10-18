'use client';
import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Badge, CopyField, ErrorBox, inviteUrl, MessageButton, Modal, useAction } from '@/components/ui';
import { del, get, patch, post } from '@/lib/api';
import type { PriceItem, Quote, QuoteLine, QuoteList, QuoteStatus, StaffList, Tone } from '@/lib/types';
import { dayText, MESSAGES, rs } from '@/lib/whatsapp';
import './service.css';

export const QUOTE_STATUS: Record<QuoteStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Draft', tone: 'mute' }, SENT: { label: 'Sent', tone: 'info' }, ACCEPTED: { label: 'Accepted', tone: 'ok' }, DECLINED: { label: 'Declined', tone: 'bad' },
};

/** The same sums as the API (lines × price, minus the discount, never below zero), shown while typing. */
function totals(lines: QuoteLine[], discount: number) {
  const subtotal = lines.reduce((a, l) => a + Math.max(1, Math.round(l.qty || 1)) * Math.max(0, Math.round(l.price || 0)), 0);
  const off = Math.min(subtotal, Math.max(0, Math.round(discount || 0)));
  return { subtotal, discount: off, total: subtotal - off };
}

/**
 * The quotes of a visit request or a home: a list, the editor for a draft, sending the link
 * (WhatsApp), and an accepted one turned into an installation job (super admins).
 */
export function QuotesPanel({ visitRequestId, homeId, compact = false, onConverted }: { visitRequestId?: string; homeId?: string; compact?: boolean; onConverted?: (homeId: string) => void }) {
  const q = visitRequestId ? `visitRequestId=${visitRequestId}` : `homeId=${homeId}`;
  const [list, setList] = useState<QuoteList | null>(null);
  const [open, setOpen] = useState<Quote | null>(null);
  const { busy, error, run } = useAction();
  const load = () => run(async () => setList(await get<QuoteList>(`/platform/quotes?${q}`)));
  useEffect(() => { void load(); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  async function create() {
    const made = await run(() => post<Quote>('/platform/quotes', visitRequestId ? { visitRequestId } : { homeId }));
    if (made) { setOpen(made); void load(); }
  }

  if (!list) return error ? <ErrorBox error={error} /> : null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="spread">
        <b style={{ fontSize: 13.5 }}>Quotes</b>
        {list.canEdit && <button className="btn btn-sm" disabled={busy} onClick={() => void create()}><Icon name="plus" size={14} />New quote</button>}
      </div>
      {list.quotes.length === 0 && <span className="small muted">No quotes yet. Price the work from your price list and send the customer a link to accept it.</span>}
      {list.quotes.map((x) => (
        <button key={x.id} type="button" className="li li-btn" style={{ padding: compact ? '8px 4px' : '10px 12px' }} onClick={() => setOpen(x)}>
          <span className="li-text">
            <b>{x.ref} · {rs(x.total)}</b>
            <span className="sub">{x.items.length} item{x.items.length === 1 ? '' : 's'}{x.convertedAt ? ' · installation job made' : ''}</span>
          </span>
          <Badge tone={QUOTE_STATUS[x.status].tone}>{QUOTE_STATUS[x.status].label}</Badge>
        </button>
      ))}
      {open && (
        <QuoteDialog quote={open} canEdit={list.canEdit} canConvert={list.canConvert}
                     onClose={() => setOpen(null)} onChanged={(x) => { if (x) setOpen(x); else setOpen(null); void load(); }}
                     onConverted={(h) => { setOpen(null); void load(); onConverted?.(h); }} />
      )}
    </div>
  );
}

/** One quote: edit while it is a draft; send, share, see the customer's answer; turn an accepted one into a job. */
export function QuoteDialog({ quote, canEdit, canConvert, onClose, onChanged, onConverted }: {
  quote: Quote; canEdit: boolean; canConvert: boolean; onClose: () => void; onChanged: (q: Quote | null) => void; onConverted: (homeId: string) => void;
}) {
  const [prices, setPrices] = useState<PriceItem[]>([]);
  const [lines, setLines] = useState<QuoteLine[]>(quote.items);
  const [discount, setDiscount] = useState(quote.discount);
  const [note, setNote] = useState(quote.note);
  const [converting, setConverting] = useState(false);
  const { busy, error, run } = useAction();
  const draft = quote.status === 'DRAFT' && canEdit;
  useEffect(() => { setLines(quote.items); setDiscount(quote.discount); setNote(quote.note); }, [quote]);
  useEffect(() => { if (draft) void get<{ items: PriceItem[] }>('/platform/price-items').then((p) => setPrices(p.items)).catch(() => undefined); }, [draft]);
  const t = useMemo(() => totals(lines, discount), [lines, discount]);
  const dirty = JSON.stringify(lines) !== JSON.stringify(quote.items) || discount !== quote.discount || note !== quote.note;

  const setLine = (i: number, change: Partial<QuoteLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...change } : l)));
  const add = (p?: PriceItem) => setLines((ls) => {
    const same = p && ls.findIndex((l) => l.priceItemId === p.id);
    if (p && same !== undefined && same >= 0) return ls.map((l, j) => (j === same ? { ...l, qty: l.qty + 1 } : l));
    return [...ls, p ? { priceItemId: p.id, name: p.name, unit: p.unit, qty: 1, price: p.price } : { priceItemId: null, name: '', unit: 'each', qty: 1, price: 0 }];
  });
  const body = () => ({ items: lines.filter((l) => l.name.trim()).map(({ total: _t, ...l }) => l), discount, note });
  const save = () => run(async () => onChanged(await patch<Quote>(`/platform/quotes/${quote.id}`, body())));
  const send = () => run(async () => {
    if (dirty) await patch<Quote>(`/platform/quotes/${quote.id}`, body());
    onChanged(await post<Quote>(`/platform/quotes/${quote.id}/send`));
  });
  const link = inviteUrl(quote.path);
  // one dialog at a time (Escape closes only the one on top)
  if (converting) return <ConvertDialog quote={quote} onClose={() => setConverting(false)} onDone={onConverted} />;

  return (
    <Modal wide title={<span className="row" style={{ gap: 10 }}>{quote.ref} · {quote.customerName}<Badge tone={QUOTE_STATUS[quote.status].tone}>{QUOTE_STATUS[quote.status].label}</Badge></span>}
           sub={`${quote.city ? `${quote.city} · ` : ''}${quote.createdBy ? `by ${quote.createdBy} · ` : ''}${quote.validUntil ? `valid until ${dayText(quote.validUntil)}` : ''}`}
           onClose={onClose}>
      <div className="dialog-body stack">
        {quote.status === 'ACCEPTED' && <div className="ok-note">Accepted by {quote.decidedName ?? quote.customerName} on {new Date(quote.decidedAt!).toLocaleDateString([], { day: 'numeric', month: 'short' })}.{quote.convertedAt ? ' The installation job is made.' : ''}</div>}
        {quote.status === 'DECLINED' && <div className="alert">Declined{quote.declineReason ? `: “${quote.declineReason}”` : '.'} You can change it and send it again.</div>}

        <div className="table-wrap">
          <table className="quote-lines">
            <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Price (Rs)</th><th className="num">Total</th>{draft && <th />}</tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>{draft ? <input value={l.name} maxLength={120} placeholder="What is it?" aria-label="Item" onChange={(e) => setLine(i, { name: e.target.value })} /> : <>{l.name} <span className="muted small">{l.unit !== 'each' ? `· per ${l.unit}` : ''}</span></>}</td>
                  <td className="num">{draft ? <input className="qty" type="number" min={1} max={9999} value={l.qty} aria-label="Quantity" onChange={(e) => setLine(i, { qty: Math.max(1, Number(e.target.value) || 1) })} /> : l.qty}</td>
                  <td className="num">{draft ? <input className="price" type="number" min={0} step={50} value={l.price} aria-label="Price" onChange={(e) => setLine(i, { price: Math.max(0, Number(e.target.value) || 0) })} /> : rs(l.price)}</td>
                  <td className="num">{rs(Math.max(1, l.qty) * Math.max(0, l.price))}</td>
                  {draft && <td><button type="button" className="icon-btn" aria-label={`Remove ${l.name || 'item'}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Icon name="x" size={14} /></button></td>}
                </tr>
              ))}
              {lines.length === 0 && <tr><td colSpan={5} className="muted" style={{ padding: 16, textAlign: 'center' }}>Add items from your price list below.</td></tr>}
            </tbody>
          </table>
        </div>

        {draft && (
          <div className="stack-sm">
            <span className="small muted">Add from your price list</span>
            <div className="price-pick">
              {prices.map((p) => <button key={p.id} type="button" className="btn btn-sm" onClick={() => add(p)}>{p.name} · {rs(p.price)}</button>)}
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => add()}><Icon name="plus" size={13} />Something else</button>
            </div>
          </div>
        )}

        <div className="quote-sum">
          <span className="muted">Subtotal</span><span className="num">{rs(t.subtotal)}</span>
          <span className="muted">Discount</span>
          <span>{draft ? <input type="number" min={0} step={100} value={discount} style={{ width: 110, textAlign: 'right' }} aria-label="Discount in rupees" onChange={(e) => setDiscount(Math.max(0, Number(e.target.value) || 0))} /> : `– ${rs(t.discount)}`}</span>
          <b>Total</b><b className="total">{rs(t.total)}</b>
        </div>

        {draft ? (
          <label className="field">Note for the customer <span className="hint">optional</span>
            <textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Includes wiring for 3 boards; one year of free check-ups." />
          </label>
        ) : quote.note ? <p className="small" style={{ margin: 0 }}>{quote.note}</p> : null}

        {quote.status !== 'DRAFT' && (
          <label className="field">The customer’s link <span className="hint">no sign-in needed</span><CopyField value={link} /></label>
        )}
        <ErrorBox error={error} />
      </div>
      <div className="dialog-foot" style={{ flexWrap: 'wrap' }}>
        {draft && <button className="btn btn-ghost" disabled={busy} onClick={() => confirm('Delete this draft?') && void run(async () => { await del(`/platform/quotes/${quote.id}`); onChanged(null); })}><Icon name="trash" size={14} />Delete</button>}
        <span className="grow" />
        {draft && dirty && <button className="btn" disabled={busy} onClick={() => void save()}>Save draft</button>}
        {draft && <button className="btn btn-primary" disabled={busy || !lines.some((l) => l.name.trim())} onClick={() => void send()}><Icon name="send" size={14} />Ready to send</button>}
        {quote.status === 'SENT' && canEdit && <button className="btn" disabled={busy} onClick={() => void run(async () => onChanged(await patch<Quote>(`/platform/quotes/${quote.id}`, { status: 'DRAFT' })))}>Change it</button>}
        {quote.status === 'DECLINED' && canEdit && <button className="btn" disabled={busy} onClick={() => void run(async () => onChanged(await patch<Quote>(`/platform/quotes/${quote.id}`, { status: 'DRAFT' })))}>Change and send again</button>}
        {(quote.status === 'SENT' || quote.status === 'ACCEPTED') && (
          <MessageButton whatsapp={quote.whatsapp} label={quote.status === 'SENT' ? 'Send on WhatsApp' : 'WhatsApp'}
                         text={MESSAGES.quote({ customerName: quote.customerName, ref: quote.ref, total: quote.total, path: quote.path, company: quote.company, validUntil: quote.validUntil })} />
        )}
        {quote.status === 'ACCEPTED' && !quote.convertedAt && canConvert && <button className="btn btn-primary" onClick={() => setConverting(true)}><Icon name="wrench" size={14} />Start installation job</button>}
        {quote.convertedAt && quote.homeId && <a className="btn btn-primary" href={`/console/homes/${quote.homeId}?tab=installation`}><Icon name="house" size={14} />Open the job</a>}
      </div>
    </Modal>
  );
}

/** Accepted quote → installation job: pick the installer; a new home (with the owner's invite) when there is none. */
function ConvertDialog({ quote, onClose, onDone }: { quote: Quote; onClose: () => void; onDone: (homeId: string) => void }) {
  const [team, setTeam] = useState<{ id: string; name: string; staffRole: string }[]>([]);
  const [result, setResult] = useState<{ homeId: string; invite: { path: string } | null } | null>(null);
  const { busy, error, run } = useAction();
  useEffect(() => {
    void get<StaffList>('/platform/staff').then((s) => setTeam(s.people.filter((p) => !p.disabled && (p.staffRole === 'INSTALLER' || p.staffRole === 'SUPERADMIN')))).catch(() => undefined);
  }, []);
  const needsHome = !quote.homeId;
  if (result) {
    return (
      <Modal title="Installation job made" onClose={() => onDone(result.homeId)} footer={<a className="btn btn-primary" href={`/console/homes/${result.homeId}?tab=installation`}>Open the job</a>}>
        <div className="dialog-body stack">
          <div className="ok-note">The installer sees it under My jobs and My day. The accepted items are on the home’s Installation tab.</div>
          {result.invite && <label className="field">Owner invite link (valid 7 days) — send it to the customer<CopyField value={inviteUrl(result.invite.path)} /></label>}
        </div>
      </Modal>
    );
  }
  return (
    <Modal title="Start the installation job" sub={needsHome ? 'Their home is created, with its installer. Add their email to send the owner invite.' : `For ${quote.home?.name ?? 'their home'}.`} onClose={onClose}>
      <form onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void run(async () => setResult(await post<{ homeId: string; invite: { path: string } | null }>(`/platform/quotes/${quote.id}/convert`, {
          installerId: f.get('installerId'), homeName: f.get('homeName') || undefined, ownerEmail: f.get('ownerEmail') || undefined, ownerName: quote.customerName,
        })));
      }}>
        <div className="dialog-body stack">
          <label className="field">Installer
            <select name="installerId" required defaultValue={quote.home?.installerId ?? ''}>
              <option value="" disabled>Pick who installs it</option>
              {team.map((p) => <option key={p.id} value={p.id}>{p.name}{p.staffRole === 'SUPERADMIN' ? ' (super admin)' : ''}</option>)}
            </select>
          </label>
          {needsHome && (
            <div className="form-grid">
              <label className="field">Home name<input name="homeName" maxLength={80} defaultValue={`${quote.customerName.split(' ')[0]}’s home`} /></label>
              <label className="field">Owner’s email <span className="hint">optional</span><input name="ownerEmail" type="email" placeholder="for the owner invite" /></label>
            </div>
          )}
          <ErrorBox error={error} />
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>Start the job</button>
        </div>
      </form>
    </Modal>
  );
}
