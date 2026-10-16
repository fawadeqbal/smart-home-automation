'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useEffect, useMemo, useState } from 'react';
import { ArticleList, articleHref, AskLine, ReaderArticle, sectionHref, useHelpFeed } from '@/components/help/reader';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { ErrorBox } from '@/components/ui';
import { HELP_SECTIONS, helpSection, plainText, searchHelp, snippet } from '@/lib/help';
import type { HelpCategory } from '@/lib/types';

/**
 * The Help Center's front page for the people in a home: search, and the sections with their
 * articles. Each article opens on its own page (/help/<id>); a section or a search stays here.
 */
export default function HelpPage() {
  return <Suspense fallback={<Loader label="Loading help…" />}><HelpHome /></Suspense>;
}

function HelpHome() {
  const params = useSearchParams();
  const router = useRouter();
  const { articles, error } = useHelpFeed();
  const q = params.get('q') ?? '';
  const sectionId = params.get('s') as HelpCategory | null;
  const legacy = params.get('a');                    // older links: /help?a=<id>
  const [typed, setTyped] = useState(q);
  useEffect(() => setTyped(q), [q]);
  useEffect(() => { if (legacy) router.replace(articleHref(legacy)); }, [legacy, router]);
  useEffect(() => { document.title = 'Help'; }, []);

  const search = (e: FormEvent) => {
    e.preventDefault();
    const term = typed.trim();
    router.push(term ? `/help?q=${encodeURIComponent(term)}` : '/help');
  };

  if (legacy) return <Loader label="Opening the article…" />;
  if (!articles) return error ? <ErrorBox error={error} /> : <Loader label="Loading help…" />;
  const section = sectionId && HELP_SECTIONS.some((s) => s.id === sectionId) ? sectionId : null;

  return (
    <div className="hc" data-screen-label="Help">
      {section && !q ? (
        <SectionView id={section} articles={articles} />
      ) : (
        <>
          <header className="hc-hero">
            <h1>How can we help?</h1>
            <form className="hc-search" onSubmit={search} role="search">
              <Icon name="search" size={18} />
              <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search: offline board, add family, warranty, batti…"
                aria-label="Search the Help Center" />
              {typed && <button type="button" className="icon-btn" aria-label="Clear" onClick={() => { setTyped(''); router.push('/help'); }}><Icon name="x" size={15} /></button>}
              <button className="btn btn-primary">Search</button>
            </form>
            <AskLine question={q || undefined} />
          </header>
          {q ? <Results articles={articles} q={q} /> : <Sections articles={articles} />}
        </>
      )}
    </div>
  );
}

function Sections({ articles }: { articles: ReaderArticle[] }) {
  if (!articles.length) {
    return <div className="card card-pad muted">The Help Center is being written. Ask the assistant, or message your installer from <b>Me</b>.</div>;
  }
  return (
    <div className="hc-sections">
      {HELP_SECTIONS.map((s) => {
        const list = articles.filter((a) => a.category === s.id);
        if (!list.length) return null;
        return (
          <section key={s.id} className="hc-section card">
            <Link className="hc-section-head" href={sectionHref(s.id)}>
              <span className={`hc-icon t-${s.tone}`}><Icon name={s.icon} size={18} /></span>
              <span className="grow stack-tight">
                <b>{s.label}</b>
                <span className="small muted">{s.blurb}</span>
              </span>
              <span className="pill">{list.length}</span>
            </Link>
            <ul className="hc-links">
              {list.slice(0, 4).map((a) => <li key={a.id}><Link href={articleHref(a.id)}>{a.title}</Link></li>)}
              {list.length > 4 && <li><Link className="hc-more" href={sectionHref(s.id)}>All {list.length} articles →</Link></li>}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function SectionView({ id, articles }: { id: HelpCategory; articles: ReaderArticle[] }) {
  const s = helpSection(id);
  const list = articles.filter((a) => a.category === id);
  return (
    <section className="stack">
      <nav className="hc-crumbs"><Link href="/help">Help</Link><Icon name="chevron-right" size={13} /><span>{s.label}</span></nav>
      <header className="hc-section-title">
        <span className={`hc-icon t-${s.tone}`}><Icon name={s.icon} size={20} /></span>
        <div className="stack-tight">
          <h1>{s.label}</h1>
          <span className="muted">{s.blurb}</span>
        </div>
      </header>
      {list.length
        ? <ArticleList section={false} items={list.map((a) => ({ article: a, snippet: snippet(plainText(a.body)) }))} />
        : <p className="muted">Nothing here yet.</p>}
    </section>
  );
}

function Results({ articles, q }: { articles: ReaderArticle[]; q: string }) {
  const hits = useMemo(() => searchHelp(articles, q), [articles, q]);
  return (
    <section className="stack">
      <h2 className="hc-h2">{hits.length ? `${hits.length} article${hits.length === 1 ? '' : 's'} for “${q}”` : `Nothing found for “${q}”`}</h2>
      {hits.length ? <ArticleList items={hits} /> : (
        <p className="muted">Try other words, or ask the assistant above: it understands whole questions, also in Urdu.</p>
      )}
    </section>
  );
}
