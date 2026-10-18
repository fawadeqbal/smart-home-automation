'use client';
import { useParams } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { errorText, get, post } from '@/lib/api';
import type { PublicQuote } from '@/lib/types';
import { dayText, rs } from '@/lib/whatsapp';
import '@/components/service/service.css';

/** A quote, opened by the secret link the company sent: no sign-in. The customer accepts or declines it. */
export default function QuotePage() {
  const { token } = useParams<{ token: string }>();
  const [q, setQ] = useState<PublicQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answering, setAnswering] = useState<null | 'accept' | 'decline'>(null);
  const [busy, setBusy] = useState(false);
  const [actError, setActError] = useState<string | null>(null);

  useEffect(() => { get<PublicQuote>(`/public/quotes/${token}`).then(setQ).catch((e) => setError(errorText(e))); }, [token]);

  async function answer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!answering) return;
    const f = new FormData(e.currentTarget);
    setBusy(true); setActError(null);
    try {
      setQ(await post<PublicQuote>(`/public/quotes/${token}/${answering}`, { name: String(f.get('name') ?? '').trim() || undefined, reason: String(f.get('reason') ?? '').trim() || undefined }));
      setAnswering(null);
    } catch (err) { setActError(errorText(err)); } finally { setBusy(false); }
  }

  if (error) {
    return (
      <main className="pq"><div className="pq-card"><div className="pq-body">
        <h1 style={{ margin: 0, fontSize: 20 }}>This link doesn’t open a quote</h1>
        <p className="muted" style={{ margin: 0 }}>{error}</p>
      </div></div></main>
    );
  }
  if (!q) return <Loader full label="Opening your quote…" />;
  const initials = q.company.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');

  return (
    <main className="pq">
      <article className="pq-card">
        <header className="pq-head">
          {q.company.logo ? <img className="pq-logo" src={q.company.logo} alt="" /> : <span className="pq-logo" aria-hidden>{initials}</span>}
          <div className="stack-tight grow">
            <b style={{ fontSize: 17 }}>{q.company.name}</b>
            <span className="small muted">Quote {q.ref}{q.validUntil ? ` · valid until ${dayText(q.validUntil)}` : ''}</span>
          </div>
        </header>
        <div className="pq-body">
          <div className="stack-tight">
            <span className="small muted">For</span>
            <b style={{ fontSize: 16 }}>{q.customerName}{q.city ? `, ${q.city}` : ''}</b>
          </div>

          {q.status === 'ACCEPTED' && <div className="ok-note"><b>Accepted — thank you{q.decidedName ? `, ${q.decidedName.split(' ')[0]}` : ''}!</b> {q.company.name} will call you to fix a day for the installation.</div>}
          {q.status === 'DECLINED' && <div className="notice">You declined this quote. If you change your mind, just let {q.company.name} know.</div>}
          {q.expired && <div className="alert">This quote has expired. Ask {q.company.name} for a new one.</div>}

          <div className="table-wrap">
            <table className="quote-lines">
              <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Total</th></tr></thead>
              <tbody>
                {q.items.map((l, i) => (
                  <tr key={i}>
                    <td>{l.name}{l.unit !== 'each' ? <span className="muted small"> · per {l.unit}</span> : null}</td>
                    <td className="num">{l.qty}</td>
                    <td className="num">{rs(l.price)}</td>
                    <td className="num">{rs(l.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="quote-sum">
            <span className="muted">Subtotal</span><span>{rs(q.subtotal)}</span>
            {q.discount > 0 && <><span className="muted">Discount</span><span>– {rs(q.discount)}</span></>}
            <b>Total</b><b className="total">{rs(q.total)}</b>
          </div>
          {q.note && <p style={{ margin: 0 }}>{q.note}</p>}

          {q.canAnswer && !answering && (
            <div className="pq-actions">
              <button className="btn btn-primary" onClick={() => setAnswering('accept')}><Icon name="check" size={16} />Accept the quote</button>
              <button className="btn" onClick={() => setAnswering('decline')}>Not now</button>
              <button className="btn btn-ghost" onClick={() => window.print()}><Icon name="download" size={15} />Save as PDF</button>
            </div>
          )}
          {answering && (
            <form className="stack" onSubmit={answer}>
              {answering === 'accept' ? (
                <>
                  <p style={{ margin: 0 }}>By accepting, you agree to this work and price. {q.company.name} will call you to fix a day.</p>
                  <label className="field">Your name<input name="name" defaultValue={q.customerName} maxLength={80} required /></label>
                </>
              ) : (
                <label className="field">Anything we should know? <span className="hint">optional</span>
                  <textarea name="reason" rows={3} maxLength={500} placeholder="e.g. Too much for now, or we only want the kitchen for now." />
                </label>
              )}
              {actError && <div className="alert" role="alert">{actError}</div>}
              <div className="pq-actions">
                <button className={`btn ${answering === 'accept' ? 'btn-primary' : ''}`} disabled={busy}>{busy ? 'Please wait…' : answering === 'accept' ? 'Yes, accept it' : 'Decline the quote'}</button>
                <button type="button" className="btn btn-ghost" onClick={() => setAnswering(null)}>Back</button>
              </div>
            </form>
          )}
          {q.company.billingEmail && <span className="small muted">Questions? Reply on WhatsApp or write to {q.company.billingEmail}.</span>}
        </div>
      </article>
    </main>
  );
}
