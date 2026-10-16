'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { del, patch, post } from '@/lib/api';
import { checksIn, HELP_SECTIONS, helpSection } from '@/lib/help';
import type { HelpArticle, HelpAudience, HelpCategory } from '@/lib/types';
import { Icon } from '../Icon';
import { Badge, Confirm, ErrorBox, Seg, useAction } from '../ui';
import { Markdown } from './Markdown';

type View = 'write' | 'preview' | 'split';

/**
 * Writing an article (super admins), on its own page: the details, the text in Markdown with a
 * live preview, and save / publish. Saving goes back to the article's read-only page.
 */
export function ArticleEditor({ article }: { article?: HelpArticle }) {
  const router = useRouter();
  const [title, setTitle] = useState(article?.title ?? '');
  const [category, setCategory] = useState<HelpCategory>(article?.category ?? 'USAGE');
  const [audience, setAudience] = useState<HelpAudience>(article?.audience ?? 'EVERYONE');
  const [tags, setTags] = useState((article?.tags ?? []).join(', '));
  const [body, setBody] = useState(article?.body ?? '');
  const [view, setView] = useState<View>('write');
  const [removing, setRemoving] = useState(false);
  const [askLeave, setAskLeave] = useState(false);   // "leave without saving?"
  const [done, setDone] = useState(false);           // saved or deleted: on our way out
  const area = useRef<HTMLTextAreaElement>(null);
  const { busy, error, run } = useAction();

  // side by side where there is room
  useEffect(() => { if (window.matchMedia('(min-width: 1180px)').matches) setView('split'); }, []);

  const checks = checksIn(body);
  const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
  const changed = !article || title !== article.title || category !== article.category || audience !== article.audience
    || body !== article.body || tagList.join(',') !== article.tags.join(',');
  const dirty = changed && (!!article || !!title.trim() || !!body.trim());
  const ready = title.trim().length >= 3 && !!body.trim();

  // don't lose unsaved writing by closing the tab
  useEffect(() => {
    if (!dirty || done) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, done]);

  const back = article ? `/console/help/${article.id}` : '/console/help';

  async function save(published?: boolean) {
    const data = { title, category, audience, tags: tagList, body, ...(published !== undefined ? { published } : {}) };
    const r = await run(() => (article ? patch<HelpArticle>(`/platform/help/${article.id}`, data) : post<HelpArticle>('/platform/help', data)));
    if (r) {
      setDone(true);
      router.push(`/console/help/${r.id}`);
    }
  }

  /** The formatting buttons: wrap the selection, or start the selected lines with a sign. */
  function format(kind: 'h2' | 'bold' | 'ol' | 'ul' | 'quote') {
    const el = area.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    let next = body;
    let caret: [number, number];
    if (kind === 'bold') {
      const word = body.slice(a, b) || 'button name';
      next = `${body.slice(0, a)}**${word}**${body.slice(b)}`;
      caret = [a + 2, a + 2 + word.length];
    } else {
      const start = body.lastIndexOf('\n', a - 1) + 1;
      const lines = body.slice(start, b).split('\n');
      const sign = (i: number) => (kind === 'h2' ? '## ' : kind === 'ul' ? '- ' : kind === 'quote' ? '> ' : `${i + 1}. `);
      const done = lines.map((l, i) => sign(i) + l.replace(/^(#{1,6} |[-*] |> |\d+\. )/, '')).join('\n');
      next = body.slice(0, start) + done + body.slice(b);
      caret = [start + done.length, start + done.length];
    }
    setBody(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(...caret); });
  }

  return (
    <div className="hce" data-screen-label={article ? 'Edit article' : 'New article'}>
      <header className="hce-head">
        <Link href={back} className="hcc-back" onClick={(e) => { if (dirty) { e.preventDefault(); setAskLeave(true); } }}>
          <Icon name="arrow-left" size={15} />{article ? 'Back to the article' : 'All articles'}
        </Link>
        <div className="row" style={{ gap: 10 }}>
          <h1 className="grow">{article ? 'Edit article' : 'New article'}</h1>
          {article && (article.published ? <Badge tone="ok">Published</Badge> : <Badge tone="warn">Draft</Badge>)}
        </div>
      </header>

      <ErrorBox error={error} />

      <section className="card card-pad hce-details">
        <label className="field">Title <span className="hint">written like the question people ask</span>
          <input className="hce-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160}
            placeholder="Add a family member and choose their rooms" autoFocus={!article} />
        </label>
        <div className="hce-grid">
          <label className="field">Section
            <select value={category} onChange={(e) => setCategory(e.target.value as HelpCategory)}>
              {HELP_SECTIONS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <span className="hint">{helpSection(category).hint}</span>
          </label>
          <label className="field">Who sees it
            <select value={audience} onChange={(e) => setAudience(e.target.value as HelpAudience)}>
              <option value="EVERYONE">Everyone (customers and staff)</option>
              <option value="STAFF">Staff only</option>
            </select>
          </label>
          <label className="field">Keywords <span className="hint">other words people use, also Roman Urdu</span>
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="invite, wife, family, ghar walay" />
          </label>
        </div>
      </section>

      <section className="card hce-body">
        <div className="hce-toolbar">
          <div className="hce-tools" role="toolbar" aria-label="Formatting">
            <button type="button" onClick={() => format('h2')} title="Heading" disabled={view === 'preview'}><b>H</b></button>
            <button type="button" onClick={() => format('bold')} title="Bold (button and screen names)" disabled={view === 'preview'}><b>B</b></button>
            <button type="button" onClick={() => format('ol')} title="Numbered steps" disabled={view === 'preview'}>1.</button>
            <button type="button" onClick={() => format('ul')} title="List" disabled={view === 'preview'}><Icon name="list" size={15} /></button>
            <button type="button" onClick={() => format('quote')} title="Note" disabled={view === 'preview'}>❝</button>
          </div>
          <Seg options={[
            { id: 'write', label: 'Write', icon: 'pencil' },
            { id: 'preview', label: 'Preview', icon: 'eye' },
            { id: 'split', label: 'Side by side', icon: 'layout-grid' },
          ]} value={view} onChange={setView} />
        </div>
        <div className={`hce-panes ${view}`}>
          {view !== 'preview' && (
            <textarea ref={area} className="mono hce-text" value={body} onChange={(e) => setBody(e.target.value)} maxLength={20000}
              aria-label="Article text (Markdown)" placeholder={'Start with one or two sentences: what this is about.\n\n## Steps\n\n1. Open **People**.\n2. Press **Invite someone**.'} />
          )}
          {view !== 'write' && (
            <div className="hce-preview">
              {title.trim() && <h1 className="hce-preview-title">{title}</h1>}
              {body.trim() ? <Markdown text={body} className="md-lg" /> : <span className="muted">The preview shows here as you write.</span>}
            </div>
          )}
        </div>
        <p className="hce-help small muted">
          <b>**bold**</b> for the buttons people press · <b>## </b> for a heading · <b>1. </b> for steps · <b>- </b> for a list ·
          <b> [[check: …]]</b> for a figure to confirm before publishing
        </p>
      </section>

      {checks.length > 0 && (
        <div className="help-checks">
          <b>Check before publishing</b>
          <ul>{checks.map((c, i) => <li key={i}>{c}</li>)}</ul>
          <span className="small muted">Replace each <code>[[check: …]]</code> with your real figure or promise.</span>
        </div>
      )}

      <footer className="hce-actions">
        {article && <button className="btn btn-ghost" onClick={() => setRemoving(true)}><Icon name="trash" size={14} />Delete</button>}
        <span className="grow small muted">{dirty ? 'Unsaved changes' : article ? 'No changes' : ''}</span>
        <Link className="btn" href={back} onClick={(e) => { if (dirty) { e.preventDefault(); setAskLeave(true); } }}>Cancel</Link>
        {article?.published ? (
          <>
            <button className="btn" disabled={busy} onClick={() => void save(false)}>Unpublish</button>
            <button className="btn btn-primary" disabled={busy || !changed || !ready} onClick={() => void save()}>{busy ? 'Saving…' : 'Save changes'}</button>
          </>
        ) : (
          <>
            <button className="btn" disabled={busy || !changed || !ready} onClick={() => void save()}>Save draft</button>
            <button className="btn btn-primary" disabled={busy || checks.length > 0 || !ready}
              title={checks.length ? 'Replace the [[check: …]] notes first' : 'Customers and the assistant see it at once'} onClick={() => void save(true)}>
              {busy ? 'Saving…' : changed && article ? 'Save and publish' : 'Publish'}
            </button>
          </>
        )}
      </footer>

      {askLeave && dirty && !done && (
        <Confirm title="Leave without saving?" body="What you changed here will be lost." confirmLabel="Leave"
          onClose={() => setAskLeave(false)} onConfirm={async () => { setDone(true); router.push(back); }} />
      )}
      {removing && article && (
        <Confirm title="Delete this article?" body={`“${article.title}” leaves the Help Center and the assistant stops using it.`} confirmLabel="Delete"
          onClose={() => setRemoving(false)}
          onConfirm={async () => { await del(`/platform/help/${article.id}`); setDone(true); router.push('/console/help'); }} />
      )}
    </div>
  );
}
