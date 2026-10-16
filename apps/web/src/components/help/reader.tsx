'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { get } from '@/lib/api';
import { useAssistant } from '@/lib/assistant';
import { helpSection } from '@/lib/help';
import { useSession } from '@/lib/session';
import type { HelpCategory } from '@/lib/types';
import { Icon } from '../Icon';

/** A published article as the people in a home read it. */
export interface ReaderArticle { id: string; title: string; category: HelpCategory; tags: string[]; body: string; updatedAt: string }

// one copy for the whole visit: going from the Help home to an article and back doesn't load it again
let cache: { at: number; list: Promise<ReaderArticle[]> } | null = null;
const FRESH_MS = 60_000;

/** The company's published Help Center articles (the same ones the assistant answers from). */
export function useHelpFeed() {
  const [articles, setArticles] = useState<ReaderArticle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!cache || Date.now() - cache.at > FRESH_MS) {
      cache = {
        at: Date.now(),
        list: get<{ articles: ReaderArticle[] }>('/help/feed?articles=1&view=customer')
          .then((r) => [...r.articles].sort((x, y) => x.title.localeCompare(y.title))),
      };
      cache.list.catch(() => { cache = null; });
    }
    let live = true;
    cache.list.then((list) => live && setArticles(list)).catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, []);
  return { articles, error };
}

export const articleHref = (id: string) => `/help/${id}`;
export const sectionHref = (id: HelpCategory) => `/help?s=${id}`;

/** "Ask the assistant": only where the person may use it (not read-only support looking in). */
export function AskLine({ question, title }: { question?: string; title?: string }) {
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
        <span className="small muted">{title ? 'It knows this article and your home: say what you see.' : 'By voice or typing, in English or Urdu. It answers from these articles and your home.'}</span>
      </span>
      <Icon name="arrow-right" size={16} />
    </button>
  );
}

/** Articles as a list of links, each with a short preview. */
export function ArticleList({ items, section = true }: { items: { article: ReaderArticle; snippet: string }[]; section?: boolean }) {
  return (
    <ul className="hc-list card">
      {items.map(({ article: a, snippet }) => (
        <li key={a.id}>
          <Link href={articleHref(a.id)}>
            <span className="grow stack-tight">
              <b>{a.title}</b>
              <span className="small muted">{snippet}</span>
            </span>
            {section && <span className={`badge ${helpSection(a.category).tone}`}>{helpSection(a.category).label}</span>}
            <Icon name="chevron-right" size={16} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
