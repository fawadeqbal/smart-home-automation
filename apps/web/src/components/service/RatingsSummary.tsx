'use client';
import { useLoad } from '@/lib/hooks';
import type { Ratings } from '@/lib/types';
import { starsText } from './Stars';
import './service.css';

const avg = (n: number | null) => (n === null ? '–' : n.toFixed(1));

/** How customers rated the help: the company's average, and each person's (from solved tickets). */
export function RatingsSummary({ compact = false }: { compact?: boolean }) {
  const r = useLoad<Ratings>('/platform/tickets/ratings');
  if (!r.data) return null;
  const { company, people } = r.data;
  if (!company.count) return compact ? null : <p className="small muted">No ratings yet. When a ticket is solved, the person who asked can give it 1 to 5 stars.</p>;
  if (compact) {
    return (
      <span className="small muted" title={people.map((p) => `${p.name}: ${avg(p.average)} (${p.count})`).join('\n')}>
        Customers rate the help <span className="stars-text">{starsText(company.average ?? 0)}</span> {avg(company.average)} from {company.count} rating{company.count === 1 ? '' : 's'}
      </span>
    );
  }
  return (
    <section className="panel">
      <div className="panel-head"><h2>Ratings from customers</h2><span className="small muted">{avg(company.average)} average · {company.count} rating{company.count === 1 ? '' : 's'}</span></div>
      {people.map((p) => (
        <div className="li" key={p.id}>
          <div className="li-text"><b>{p.name}</b><span className="sub">{p.count} rated ticket{p.count === 1 ? '' : 's'}</span></div>
          <span className="stars-text" aria-label={`${avg(p.average)} out of 5`}>{starsText(p.average ?? 0)}</span>
          <b style={{ minWidth: 28, textAlign: 'right' }}>{avg(p.average)}</b>
        </div>
      ))}
      {!people.length && <div className="li"><span className="small muted">Ratings show here for tickets that were assigned to someone.</span></div>}
    </section>
  );
}
