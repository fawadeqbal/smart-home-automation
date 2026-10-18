'use client';
import { useState } from 'react';
import { ErrorBox, useAction } from '@/components/ui';
import { post } from '@/lib/api';
import type { Ticket } from '@/lib/types';
import './service.css';

const STAR = 'M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z';
const WORDS = ['', 'Poor', 'Not great', 'Okay', 'Good', 'Excellent'];

/** "★★★★☆" for a rating (read-only). */
export const starsText = (n: number) => `${'★'.repeat(Math.round(n))}${'☆'.repeat(5 - Math.round(n))}`;

/** Pick 1 to 5 stars (keyboard: arrow keys move, like radio buttons). */
export function StarPicker({ value, onChange, disabled }: { value: number; onChange: (n: number) => void; disabled?: boolean }) {
  return (
    <span className="stars" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n === 1 ? '' : 's'}: ${WORDS[n]}`}
                className={n <= value ? 'on' : ''} disabled={disabled} onClick={() => onChange(n)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onChange(Math.min(5, value + 1)); }
                  if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onChange(Math.max(1, value - 1)); }
                }}>
          <svg width={26} height={26} viewBox="0 0 24 24" fill={n <= value ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" aria-hidden><path d={STAR} /></svg>
        </button>
      ))}
    </span>
  );
}

/** The home's side of a solved ticket: rate the help (once; can be changed for 7 days). */
export function RateTicket({ t, onRated }: { t: Ticket; onRated: () => void }) {
  const [stars, setStars] = useState(t.rating ?? 0);
  const [comment, setComment] = useState(t.ratingComment ?? '');
  const [editing, setEditing] = useState(!t.rating);
  const { busy, error, run } = useAction();
  if (!t.canRate && !t.rating) return null;
  const until = t.rateUntil ? new Date(t.rateUntil).toLocaleDateString([], { day: 'numeric', month: 'short' }) : null;

  if (t.rating && !editing) {
    return (
      <div className="card card-pad rate-card">
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <b className="grow">Your rating</b>
          <span className="stars-text" aria-label={`${t.rating} out of 5`}>{starsText(t.rating)}</span>
        </div>
        {t.ratingComment && <span className="muted">“{t.ratingComment}”</span>}
        {t.canRate && <span className="small muted">Thank you! You can change it until {until}. <button className="link-btn small" onClick={() => setEditing(true)}>Change</button></span>}
      </div>
    );
  }
  return (
    <form className="card card-pad rate-card" onSubmit={(e) => {
      e.preventDefault();
      if (!stars) return;
      void run(async () => { await post(`/support/tickets/${t.id}/rating`, { stars, comment: comment.trim() || undefined }); setEditing(false); onRated(); });
    }}>
      <b>How was the help you got?</b>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <StarPicker value={stars} onChange={setStars} disabled={busy} />
        {stars > 0 && <span className="muted">{WORDS[stars]}</span>}
      </div>
      <label className="field">A few words <span className="hint">optional</span>
        <textarea rows={2} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What went well, or what could be better?" />
      </label>
      <ErrorBox error={error} />
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-primary" disabled={busy || !stars}>{t.rating ? 'Save rating' : 'Send rating'}</button>
        {t.rating && <button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button>}
      </div>
    </form>
  );
}
