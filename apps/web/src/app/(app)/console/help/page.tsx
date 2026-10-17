'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { useCrumbs } from '@/components/Shell';
import { Badge, Empty, ErrorBox, PageHead, Seg } from '@/components/ui';
import { HELP_SECTIONS, helpSection, plainText } from '@/lib/help';
import { timeAgo, useLoad } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { HelpArticle, HelpCategory } from '@/lib/types';

type Filter = HelpCategory | 'all' | 'drafts';

/**
 * The console's Help Center: only the list of articles. Each one opens on its own page to read
 * (/console/help/<id>); super admins edit on a separate page (/console/help/<id>/edit).
 */
export default function HelpCenterPage() {
  useCrumbs([{ label: 'Platform', href: '/console' }, { label: 'Help Center' }]);
  const { staffRole } = useSession();
  const editor = staffRole === 'SUPERADMIN';
  const { data, error } = useLoad<HelpArticle[]>('/platform/help');
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data ?? [])
      .filter((a) => (filter === 'all' ? true : filter === 'drafts' ? !a.published : a.category === filter))
      .filter((a) => !term || `${a.title} ${a.tags.join(' ')} ${plainText(a.body)}`.toLowerCase().includes(term));
  }, [data, filter, q]);

  if (!data) return error ? <ErrorBox error={error} /> : <Loader label="Loading the Help Center…" />;
  const drafts = data.filter((a) => !a.published).length;
  const filters: { id: Filter; label: string; n: number }[] = [
    { id: 'all', label: 'All', n: data.length },
    ...HELP_SECTIONS.map((c) => ({ id: c.id as Filter, label: c.label, n: data.filter((a) => a.category === c.id).length })),
    ...(drafts ? [{ id: 'drafts' as Filter, label: 'Drafts', n: drafts }] : []),
  ];

  return (
    <div data-screen-label="Help Center">
      <PageHead
        eyebrow="Platform" title="Help Center"
        sub="What customers read in Help and what the assistant answers from. Only published articles are used."
        actions={
          <>
            <Link className="btn" href="/console/help/try"><Icon name="sparkles" size={15} />Test a question</Link>
            {editor && <Link className="btn btn-primary" href="/console/help/new"><Icon name="plus" size={15} />New article</Link>}
          </>
        }
      />

      {drafts > 0 && filter !== 'drafts' && (
        <div className="help-note mb16">
          <Icon name="alert-triangle" size={16} />
          <span><b>{drafts} draft{drafts === 1 ? '' : 's'}</b> not used yet. Policies start as drafts: check the highlighted figures, then publish.</span>
          <button className="btn btn-sm" onClick={() => setFilter('drafts')}>Show drafts</button>
        </div>
      )}

      <div className="row mb16" style={{ gap: 10, flexWrap: 'wrap' }}>
        <Seg options={filters} value={filter} onChange={setFilter} />
        <label className="input-icon push" style={{ width: 'min(280px, 100%)' }}>
          <Icon name="search" size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search articles" aria-label="Search articles" />
        </label>
      </div>

      {data.length === 0 ? (
        <Empty>No articles yet.</Empty>
      ) : (
        <ul className="hcc-list card">
          {rows.map((a) => {
            const s = helpSection(a.category);
            return (
              <li key={a.id} className="hcc-row">
                <Link className="hcc-main" href={`/console/help/${a.id}`}>
                  <span className={`hc-icon sm t-${s.tone}`}><Icon name={s.icon} size={15} /></span>
                  <span className="grow stack-tight" style={{ minWidth: 0 }}>
                    <b>{a.title}</b>
                    <span className="small muted">{s.label} · {a.audience === 'STAFF' ? 'Staff only' : 'Everyone'} · updated {timeAgo(a.updatedAt)}</span>
                  </span>
                  {a.published ? <Badge tone="ok">Published</Badge> : <Badge tone="warn">Draft</Badge>}
                </Link>
                {editor && (
                  <Link className="icon-btn" href={`/console/help/${a.id}/edit`} title="Edit" aria-label={`Edit ${a.title}`}>
                    <Icon name="pencil" size={15} />
                  </Link>
                )}
              </li>
            );
          })}
          {rows.length === 0 && <li className="muted" style={{ textAlign: 'center', padding: 24 }}>Nothing matches.</li>}
        </ul>
      )}
    </div>
  );
}
