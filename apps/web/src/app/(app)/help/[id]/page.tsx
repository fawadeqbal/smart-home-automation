'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect } from 'react';
import { Markdown } from '@/components/help/Markdown';
import { articleHref, AskLine, sectionHref, useHelpFeed } from '@/components/help/reader';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { ErrorBox } from '@/components/ui';
import { helpSection } from '@/lib/help';

/** One Help Center article on its own page: just the article, formatted, and where to go next. */
export default function HelpArticlePage() {
  const { id } = useParams<{ id: string }>();
  const { articles, error } = useHelpFeed();
  const article = articles?.find((a) => a.id === id) ?? null;
  useEffect(() => { if (article) document.title = `${article.title} · Help`; }, [article]);

  if (!articles) return error ? <ErrorBox error={error} /> : <Loader label="Loading the article…" />;
  if (!article) {
    return (
      <div className="hc">
        <div className="card card-pad stack" style={{ maxWidth: 560 }}>
          <b>This article isn’t available</b>
          <span className="muted">It may have been moved or taken down.</span>
          <Link href="/help" className="btn" style={{ alignSelf: 'flex-start' }}><Icon name="arrow-left" size={15} />All help</Link>
        </div>
      </div>
    );
  }

  const s = helpSection(article.category);
  const related = articles.filter((a) => a.category === article.category && a.id !== article.id).slice(0, 6);
  return (
    <div className="hc" data-screen-label="Help article">
      <div className="hc-article-wrap">
        <article className="hc-article">
          <nav className="hc-crumbs">
            <Link href="/help">Help</Link><Icon name="chevron-right" size={13} />
            <Link href={sectionHref(s.id)}>{s.label}</Link>
          </nav>
          <h1>{article.title}</h1>
          <p className="small muted hc-updated">Updated {new Date(article.updatedAt).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          <Markdown text={article.body} className="md-lg" />
          <AskLine title={article.title} />
        </article>
        <aside className="hc-related">
          {related.length > 0 && (
            <>
              <b className="small">More in {s.label}</b>
              <ul>{related.map((a) => <li key={a.id}><Link href={articleHref(a.id)}>{a.title}</Link></li>)}</ul>
            </>
          )}
          <Link href="/help" className="small"><Icon name="arrow-left" size={13} /> All help</Link>
        </aside>
      </div>
    </div>
  );
}
