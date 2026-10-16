'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect } from 'react';
import { Markdown } from '@/components/help/Markdown';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { useCrumbs } from '@/components/Shell';
import { Badge, ErrorBox } from '@/components/ui';
import { checksIn, helpSection } from '@/lib/help';
import { timeAgo, useLoad } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { HelpArticleFull } from '@/lib/types';

/** One article in the console, read-only: the article as customers see it, and its details. */
export default function ConsoleArticlePage() {
  const { id } = useParams<{ id: string }>();
  const { staffRole } = useSession();
  const editor = staffRole === 'SUPERADMIN';
  const { data: a, error } = useLoad<HelpArticleFull>(`/platform/help/${id}`);
  useCrumbs([{ label: 'Platform', href: '/console' }, { label: 'Help Center', href: '/console/help' }, { label: a?.title ?? 'Article' }]);
  useEffect(() => { if (a) document.title = `${a.title} · Help Center`; }, [a]);

  if (!a) return error ? <NotFound error={error} /> : <Loader label="Loading the article…" />;
  const s = helpSection(a.category);
  const checks = checksIn(a.body);

  return (
    <div className="hcc-page" data-screen-label="Help article">
      <Link href="/console/help" className="hcc-back"><Icon name="arrow-left" size={15} />All articles</Link>

      <div className="hcc-layout">
        <article className="hc-article hcc-article">
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <Badge tone={s.tone}>{s.label}</Badge>
            {a.published ? <Badge tone="ok">Published</Badge> : <Badge tone="warn">Draft</Badge>}
            {a.audience === 'STAFF' && <Badge tone="mute">Staff only</Badge>}
          </div>
          <h1>{a.title}</h1>
          <p className="small muted hc-updated">
            Updated {timeAgo(a.updatedAt)}{a.updatedBy ? ` by ${a.updatedBy}` : a.starter ? ' · starter article from Switchboard' : ''}
          </p>
          {checks.length > 0 && (
            <div className="help-checks">
              <b>{checks.length} figure{checks.length === 1 ? '' : 's'} to confirm before publishing</b>
              <span className="small muted">Highlighted below. {editor ? 'Edit the article and replace each one with your real figure or promise.' : 'A super admin replaces them.'}</span>
            </div>
          )}
          <Markdown text={a.body} className="md-lg" />
        </article>

        <aside className="hcc-side">
          {editor && (
            <div className="card card-pad stack">
              <Link className="btn btn-primary" href={`/console/help/${a.id}/edit`}><Icon name="pencil" size={15} />Edit article</Link>
              <span className="small muted">
                {a.published ? 'Changes you save are live at once: in Help and in the assistant’s answers.' : 'A draft: customers and the assistant don’t see it until you publish.'}
              </span>
            </div>
          )}
          <dl className="card card-pad hcc-facts">
            <dt>Section</dt><dd>{s.label}</dd>
            <dt>Who sees it</dt><dd>{a.audience === 'STAFF' ? 'Staff only (console and the console assistant)' : 'Everyone: customers in Help, and the assistant'}</dd>
            <dt>Status</dt><dd>{a.published ? 'Published' : 'Draft (not used yet)'}</dd>
            {a.tags.length > 0 && (<><dt>Keywords</dt><dd className="hcc-tags">{a.tags.map((t) => <span key={t} className="pill">{t}</span>)}</dd></>)}
            <dt>Created</dt><dd>{new Date(a.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}</dd>
          </dl>
        </aside>
      </div>
    </div>
  );
}

function NotFound({ error }: { error: string }) {
  return (
    <div className="card card-pad stack" style={{ maxWidth: 560 }}>
      <b>{/no such/i.test(error) ? 'This article doesn’t exist any more' : 'The article couldn’t be loaded'}</b>
      <span className="muted">{/no such/i.test(error) ? 'It may have been deleted.' : error}</span>
      <Link href="/console/help" className="btn" style={{ alignSelf: 'flex-start' }}><Icon name="arrow-left" size={15} />All articles</Link>
    </div>
  );
}
