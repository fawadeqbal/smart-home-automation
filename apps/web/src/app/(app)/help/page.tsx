'use client';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useEffect, useMemo, useState } from 'react';
import { Markdown } from '@/components/help/Markdown';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { ErrorBox } from '@/components/ui';
import { get } from '@/lib/api';
import { useAssistant } from '@/lib/assistant';
import { HELP_SECTIONS, helpSection, plainText, searchHelp, snippet } from '@/lib/help';
import { useSession } from '@/lib/session';
import type { HelpCategory } from '@/lib/types';

interface Article { id: string; title: string; category: HelpCategory; tags: string[]; body: string; updatedAt: string }

/**
 * The Help Center for the people in a home: sections, search, and each article as a readable page.
 * The articles are the company's published ones (what the assistant answers from); anything they don't
 * cover goes to the assistant in one tap.
 */
export default function HelpPage() {
  return <Suspense fallback={<Loader label="Loading help…" />}><HelpCenter /></Suspense>;
}

function HelpCenter() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const [articles, setArticles] = useState<Article[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = params.get('q') ?? '';
  const sectionId = params.get('s') as HelpCategory | null;
  const articleId = params.get('a');
  const [typed, setTyped] = useState(q);
  useEffect(() => setTyped(q), [q]);

  useEffect(() => {
    get<{ articles: Article[] }>('/help/feed?articles=1&view=customer')
      .then((r) => setArticles([...r.articles].sort((x, y) => x.title.localeCompare(y.title))))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const go = (next: Record<string, string | null>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    router.push(p.size ? `${path}?${p}` : path, { scroll: true });
  };
  const search = (e: FormEvent) => {
    e.preventDefault();
    go({ q: typed.trim() || null });
  };

  if (!articles) return error ? <ErrorBox error={error} /> : <Loader label="Loading help…" />;
  const article = articleId ? articles.find((a) => a.id === articleId) : null;

  return (
    <div className="hc" data-screen-label="Help">
      {article ? (
        <ArticleView article={article} articles={articles} go={go} />
      ) : (
        <>
          <header className="hc-hero">
            <h1>How can we help?</h1>
            <form className="hc-search" onSubmit={search} role="search">
              <Icon name="search" size={18} />
              <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search: offline board, add family, warranty, batti…"
                aria-label="Search the Help Center" />
              {typed && <button type="button" className="icon-btn" aria-label="Clear" onClick={() => { setTyped(''); go({}); }}><Icon name="x" size={15} /></button>}
              <button className="btn btn-primary">Search</button>
            </form>
            <AskLine question={q} />
          </header>
          {q ? (
            <Results articles={articles} q={q} go={go} />
          ) : sectionId ? (
            <SectionView id={sectionId} articles={articles} go={go} />
          ) : (
            <Sections articles={articles} go={go} />
          )}
        </>
      )}
    </div>
  );
}

type Go = (next: Record<string, string | null>) => void;

/** "Ask the assistant" — only where the person may use it (not read-only support looking in). */
function AskLine({ question, title }: { question?: string; title?: string }) {
  const { home } = useSession();
  const a = useAssistant();
  if (!home || home.readOnly) return null;
  const ask = () => {
    a.setOpen(true);
    if (question) a.send(question);
  };
  return (
    <button type="button" className="hc-ask" onClick={ask}>
      <span className="hc-ask-orb"><Icon name="sparkles" size={15} /></span>
      <span className="grow">
        <b>{question ? `Ask the assistant: “${question}”` : title ? 'Still stuck? Ask the assistant' : 'Or just ask the assistant'}</b>
        <span className="small muted">{title ? `It knows this article and your home — say what you see.` : 'By voice or typing, in English or Urdu. It answers from these articles and your home.'}</span>
      </span>
      <Icon name="arrow-right" size={16} />
    </button>
  );
}

function Sections({ articles, go }: { articles: Article[]; go: Go }) {
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
            <button type="button" className="hc-section-head" onClick={() => go({ s: s.id })}>
              <span className={`hc-icon t-${s.tone}`}><Icon name={s.icon} size={18} /></span>
              <span className="grow stack-tight">
                <b>{s.label}</b>
                <span className="small muted">{s.blurb}</span>
              </span>
              <span className="pill">{list.length}</span>
            </button>
            <ul className="hc-links">
              {list.slice(0, 4).map((a) => (
                <li key={a.id}><button type="button" onClick={() => go({ a: a.id })}>{a.title}</button></li>
              ))}
              {list.length > 4 && <li><button type="button" className="hc-more" onClick={() => go({ s: s.id })}>All {list.length} articles →</button></li>}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function SectionView({ id, articles, go }: { id: HelpCategory; articles: Article[]; go: Go }) {
  const s = helpSection(id);
  const list = articles.filter((a) => a.category === id);
  return (
    <section className="stack">
      <nav className="hc-crumbs"><button type="button" onClick={() => go({})}>Help</button><Icon name="chevron-right" size={13} /><span>{s.label}</span></nav>
      <h2 className="hc-h2">{s.label}</h2>
      <ArticleList items={list.map((a) => ({ article: a, snippet: snippet(plainText(a.body)) }))} go={go} />
    </section>
  );
}

function Results({ articles, q, go }: { articles: Article[]; q: string; go: Go }) {
  const hits = useMemo(() => searchHelp(articles, q), [articles, q]);
  return (
    <section className="stack">
      <h2 className="hc-h2">{hits.length ? `${hits.length} article${hits.length === 1 ? '' : 's'} for “${q}”` : `Nothing found for “${q}”`}</h2>
      {hits.length ? <ArticleList items={hits} go={go} /> : (
        <p className="muted">Try other words — or ask the assistant above: it understands whole questions, also in Urdu.</p>
      )}
    </section>
  );
}

function ArticleList({ items, go }: { items: { article: Article; snippet: string }[]; go: Go }) {
  return (
    <ul className="hc-list card">
      {items.map(({ article: a, snippet: text }) => (
        <li key={a.id}>
          <button type="button" onClick={() => go({ a: a.id })}>
            <span className="grow stack-tight">
              <b>{a.title}</b>
              <span className="small muted">{text}</span>
            </span>
            <span className={`badge ${helpSection(a.category).tone}`}>{helpSection(a.category).label}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ArticleView({ article, articles, go }: { article: Article; articles: Article[]; go: Go }) {
  const s = helpSection(article.category);
  const related = articles.filter((a) => a.category === article.category && a.id !== article.id).slice(0, 6);
  useEffect(() => { document.title = `${article.title} · Help`; }, [article.title]);
  return (
    <div className="hc-article-wrap">
      <article className="hc-article">
        <nav className="hc-crumbs">
          <button type="button" onClick={() => go({})}>Help</button><Icon name="chevron-right" size={13} />
          <button type="button" onClick={() => go({ s: s.id })}>{s.label}</button>
        </nav>
        <h1>{article.title}</h1>
        <p className="small muted hc-updated">Updated {new Date(article.updatedAt).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        <Markdown text={article.body} className="md-lg" />
        <AskLine title={article.title} />
      </article>
      {related.length > 0 && (
        <aside className="hc-related">
          <b className="small">More in {s.label}</b>
          <ul>{related.map((a) => <li key={a.id}><button type="button" onClick={() => go({ a: a.id })}>{a.title}</button></li>)}</ul>
          <Link href="/help" className="small">All help →</Link>
        </aside>
      )}
    </div>
  );
}
