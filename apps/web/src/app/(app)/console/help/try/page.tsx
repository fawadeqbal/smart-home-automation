'use client';
import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useCrumbs } from '@/components/Shell';
import { Badge, ErrorBox, PageHead, Seg, useAction } from '@/components/ui';
import { post } from '@/lib/api';
import { helpSection } from '@/lib/help';
import type { HelpHit } from '@/lib/types';

/** Ask what a customer would ask and see which articles the assistant would answer from. */
export default function TryQuestionPage() {
  useCrumbs([{ label: 'Platform', href: '/console' }, { label: 'Help Center', href: '/console/help' }, { label: 'Test a question' }]);
  const [question, setQuestion] = useState('');
  const [as, setAs] = useState<'customer' | 'staff'>('customer');
  const [hits, setHits] = useState<HelpHit[] | null>(null);
  const { busy, error, run } = useAction();

  async function ask(e: FormEvent) {
    e.preventDefault();
    if (question.trim().length < 2) return;
    const r = await run(() => post<{ hits: HelpHit[] }>('/platform/help/try', { question, staff: as === 'staff' }));
    if (r) setHits(r.hits);
  }

  return (
    <div className="hcc-page" data-screen-label="Test a question">
      <Link href="/console/help" className="hcc-back"><Icon name="arrow-left" size={15} />All articles</Link>
      <PageHead title="Test a question"
        sub="Type what a customer would ask, in their words. You see the articles the assistant would answer from, best first. If nothing fits, write an article for it." />

      <form className="card card-pad stack" onSubmit={ask}>
        <label className="input-icon">
          <Icon name="sparkles" size={15} />
          <input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300} autoFocus
            placeholder="“meri board offline hai” or “how long is the warranty?”" aria-label="A question to try" />
        </label>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Seg options={[{ id: 'customer', label: 'As a customer' }, { id: 'staff', label: 'As staff' }]} value={as} onChange={setAs} />
          <button className="btn btn-primary push" disabled={busy || question.trim().length < 2}>{busy ? 'Searching…' : 'See what it finds'}</button>
        </div>
      </form>
      <ErrorBox error={error} />

      {hits && (
        hits.length === 0 ? (
          <div className="card card-pad mt16 muted">Nothing matches: the assistant would say it doesn’t know and suggest the installer.</div>
        ) : (
          <ol className="hcc-hits">
            {hits.map((h, i) => {
              const s = helpSection(h.category);
              return (
                <li key={`${h.articleId}-${i}`} className="card">
                  <Link href={`/console/help/${h.articleId}`}>
                    <span className="hcc-rank">{i + 1}</span>
                    <span className="grow stack-tight" style={{ minWidth: 0 }}>
                      <span className="row" style={{ gap: 8 }}>
                        <b>{h.title}</b><Badge tone={s.tone}>{s.label}</Badge>
                      </span>
                      <span className="small muted">{h.text.split('\n').slice(h.text.includes('\nKeywords:') ? 2 : 1).join(' ').slice(0, 240)}…</span>
                      <span className="small muted">
                        {[h.keywordRank !== null && `matched words #${h.keywordRank + 1}`, h.meaningRank !== null && `matched meaning #${h.meaningRank + 1}`].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <Icon name="chevron-right" size={16} />
                  </Link>
                </li>
              );
            })}
          </ol>
        )
      )}
    </div>
  );
}
