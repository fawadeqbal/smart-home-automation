/** The Help Center's sections, search and small text helpers, shared by the reader (/help), the console and the assistant. */
import type { HelpCategory, Tone } from './types';

export interface HelpSection {
  id: HelpCategory;
  label: string;
  /** for readers (homeowners) */
  blurb: string;
  /** for editors (console) */
  hint: string;
  tone: Tone;
  icon: string;
}

export const HELP_SECTIONS: HelpSection[] = [
  { id: 'USAGE', label: 'Using it', blurb: 'Switching, timers, scenes, family, the assistant', hint: 'How to do things in the app and with the assistant', tone: 'info', icon: 'lightbulb' },
  { id: 'TROUBLESHOOTING', label: 'Problems', blurb: 'Something isn’t working? Start here', hint: 'What to do when something doesn’t work', tone: 'warn', icon: 'wrench' },
  { id: 'PROCESS', label: 'How we work', blurb: 'Visits, installation day, support', hint: 'Visits, installation, support', tone: 'mute', icon: 'users' },
  { id: 'POLICY', label: 'Policies', blurb: 'Warranty, charges, refunds, privacy', hint: 'Warranty, charges, refunds, privacy: promises to customers', tone: 'bad', icon: 'shield' },
  { id: 'FAQ', label: 'Questions', blurb: 'Short answers to common questions', hint: 'Short answers to common questions', tone: 'ok', icon: 'help' },
];

export const helpSection = (id: HelpCategory) => HELP_SECTIONS.find((c) => c.id === id) ?? HELP_SECTIONS[0]!;

/** "[[check: warranty length]]": a figure or promise for the owner to confirm before publishing. */
export const CHECKS = /\[\[check:([^\]]*)\]\]/g;
export const checksIn = (body: string) => [...body.matchAll(CHECKS)].map((m) => m[1]!.trim());

/** Article text without Markdown signs, for snippets and search. */
export function plainText(md: string) {
  return md
    .replace(CHECKS, '$1')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/[*_`~]+/g, '')
    .replace(/^\s*:?-{3,}:?\s*$/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

export interface Searchable { id: string; title: string; tags: string[]; body: string }

/**
 * Simple ranked search for the reader: every word must appear somewhere; titles and keywords count
 * most (they carry the words people use, Roman Urdu included). The assistant does the clever search.
 */
export function searchHelp<T extends Searchable>(articles: T[], query: string): { article: T; snippet: string }[] {
  const words = norm(query).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
  if (!words.length) return [];
  const scored = articles.map((a) => {
    const title = norm(a.title);
    const tags = norm(a.tags.join(' '));
    const text = norm(plainText(a.body));
    let score = 0;
    for (const w of words) {
      const s = (title.includes(w) ? 6 : 0) + (tags.includes(w) ? 4 : 0) + (text.includes(w) ? 1 : 0);
      if (!s) return null;
      score += s;
    }
    return { article: a, score, snippet: snippet(plainText(a.body), words) };
  }).filter((x): x is { article: T; score: number; snippet: string } => x !== null);
  return scored.sort((x, y) => y.score - x.score).map(({ article, snippet: s }) => ({ article, snippet: s }));
}

/** ~180 characters of the article around the first matching word. */
export function snippet(text: string, words: string[] = []) {
  const low = norm(text);
  const at = words.map((w) => low.indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - 60);
  const cut = text.slice(start, start + 180);
  return `${start > 0 ? '…' : ''}${cut}${start + 180 < text.length ? '…' : ''}`;
}
