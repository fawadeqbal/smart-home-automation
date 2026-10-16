'use client';
import { useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useEffect, useMemo, useState } from 'react';
import { Markdown } from '@/components/help/Markdown';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { useCrumbs } from '@/components/Shell';
import { Badge, Confirm, Empty, ErrorBox, PageHead, Seg, useAction } from '@/components/ui';
import { del, patch, post } from '@/lib/api';
import { timeAgo, useLoad } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { checksIn, HELP_SECTIONS, helpSection } from '@/lib/help';
import type { HelpArticle, HelpAudience, HelpCategory, HelpHit, Tone } from '@/lib/types';

const CATEGORIES: { id: HelpCategory; label: string; tone: Tone; hint: string }[] = HELP_SECTIONS;
const cat = (id: HelpCategory) => helpSection(id);
type Filter = HelpCategory | 'all' | 'drafts';

/**
 * The Help Center: everything the assistant may tell customers (and staff) about using the product,
 * fixing problems, how the company works and its policies. Only published articles are used.
 */
export default function HelpCenterPage() {
  return <Suspense fallback={<Loader label="Loading the Help Center…" />}><HelpCenter /></Suspense>;
}

function HelpCenter() {
  useCrumbs([{ label: 'Platform', href: '/console' }, { label: 'Help Center' }]);
  const linked = useSearchParams().get('a');   // e.g. from an article the assistant mentioned
  const { staffRole } = useSession();
  const editor = staffRole === 'SUPERADMIN';
  const { data, error, reload } = useLoad<HelpArticle[]>('/platform/help');
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(linked);
  useEffect(() => { if (linked) { setSel(linked); setFilter('all'); setQ(''); } }, [linked]);
  const ready = !!data;
  useEffect(() => {   // a linked article on a phone sits under the list: bring it into view
    if (linked && ready && window.matchMedia('(max-width: 900px)').matches) requestAnimationFrame(() => document.querySelector('.side-panel')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }, [linked, ready]);
  const [creating, setCreating] = useState(false);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data ?? [])
      .filter((a) => (filter === 'all' ? true : filter === 'drafts' ? !a.published : a.category === filter))
      .filter((a) => !term || `${a.title} ${a.tags.join(' ')} ${a.body}`.toLowerCase().includes(term));
  }, [data, filter, q]);
  useEffect(() => {
    if (!data || creating) return;
    if (!sel || !data.some((a) => a.id === sel)) setSel(rows[0]?.id ?? null);
  }, [data, rows, sel, creating]);

  if (!data) return error ? <ErrorBox error={error} /> : <Loader label="Loading the Help Center…" />;
  const drafts = data.filter((a) => !a.published).length;
  const filters: { id: Filter; label: string; n: number }[] = [
    { id: 'all', label: 'All', n: data.length },
    ...CATEGORIES.map((c) => ({ id: c.id as Filter, label: c.label, n: data.filter((a) => a.category === c.id).length })),
    { id: 'drafts', label: 'Drafts', n: drafts },
  ];
  const chosen = data.find((a) => a.id === sel) ?? null;

  return (
    <div data-screen-label="Help Center">
      <PageHead
        eyebrow="Platform" title="Help Center"
        sub="What the assistant knows: how to use Switchboard, fixing problems, how you work and your policies. It answers from published articles only, and never makes up the rest."
        actions={editor && <button className="btn btn-primary" onClick={() => { setCreating(true); setSel(null); }}><Icon name="plus" size={15} />New article</button>}
      />

      {drafts > 0 && (
        <div className="help-note mb16">
          <Icon name="alert-triangle" size={16} />
          <span><b>{drafts} draft{drafts === 1 ? '' : 's'}</b> the assistant doesn’t use yet. Policies start as drafts: check the highlighted figures, then publish.</span>
          <button className="btn btn-sm" onClick={() => setFilter('drafts')}>Show drafts</button>
        </div>
      )}

      <TryQuestion />

      <div className="row mb16" style={{ gap: 10, flexWrap: 'wrap' }}>
        <Seg options={filters} value={filter} onChange={setFilter} />
        <label className="input-icon push" style={{ width: 'min(280px, 100%)' }}>
          <Icon name="search" size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search articles" aria-label="Search articles" />
        </label>
      </div>

      {data.length === 0 ? (
        <Empty>No articles yet.</Empty>
      ) : (
        <div className="grid-2-wide">
          <div className="table-wrap">
            <table className="table" style={{ minWidth: 520 }}>
              <thead><tr>{['Article', 'Section', 'For', 'Status'].map((c) => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className={`click ${sel === a.id && !creating ? 'selected' : ''}`} onClick={() => { setCreating(false); setSel(a.id); }}>
                    <td><span className="stack-tight"><b>{a.title}</b><span className="cell-sub">Updated {timeAgo(a.updatedAt)}</span></span></td>
                    <td><Badge tone={cat(a.category).tone}>{cat(a.category).label}</Badge></td>
                    <td className="muted nowrap">{a.audience === 'STAFF' ? 'Staff' : 'Everyone'}</td>
                    <td>{a.published ? <Badge tone="ok">Published</Badge> : <Badge tone="warn">Draft</Badge>}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 24 }}>Nothing here.</td></tr>}
              </tbody>
            </table>
          </div>
          {creating ? (
            <Editor key="new" editor={editor} onSaved={async (id) => { setCreating(false); await reload(); setSel(id); }} onClose={() => setCreating(false)} />
          ) : chosen ? (
            <Editor key={chosen.id + chosen.updatedAt} article={chosen} editor={editor} onSaved={() => void reload()} onClose={() => setSel(null)} />
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Ask what a customer would ask and see what the assistant finds: the way to check an article works. */
function TryQuestion() {
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
    <div className="card mb16 help-try">
      <form className="row" style={{ gap: 8, flexWrap: 'wrap' }} onSubmit={ask}>
        <label className="input-icon grow" style={{ minWidth: 220 }}>
          <Icon name="sparkles" size={15} />
          <input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300}
            placeholder="Try a question: “meri board offline hai” or “how long is the warranty?”" aria-label="A question to try" />
        </label>
        <Seg options={[{ id: 'customer', label: 'As a customer' }, { id: 'staff', label: 'As staff' }]} value={as} onChange={setAs} />
        <button className="btn" disabled={busy || question.trim().length < 2}>{busy ? 'Searching…' : 'See what it finds'}</button>
      </form>
      <ErrorBox error={error} />
      {hits && (
        hits.length === 0 ? (
          <p className="small muted mt8">Nothing matches: the assistant would say it doesn’t know and suggest their installer. Write an article for it.</p>
        ) : (
          <ol className="help-hits">
            {hits.map((h, i) => (
              <li key={`${h.articleId}-${i}`}>
                <div className="row" style={{ gap: 8 }}>
                  <b>{h.title}</b><Badge tone={cat(h.category).tone}>{cat(h.category).label}</Badge>
                  <span className="small muted push">
                    {[h.keywordRank !== null && `words #${h.keywordRank + 1}`, h.meaningRank !== null && `meaning #${h.meaningRank + 1}`].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <p className="small muted">{h.text.split('\n').slice(h.text.includes('\nKeywords:') ? 2 : 1).join(' ').slice(0, 260)}…</p>
              </li>
            ))}
          </ol>
        )
      )}
    </div>
  );
}

function Editor({ article, editor, onSaved, onClose }: {
  article?: HelpArticle; editor: boolean; onSaved: (id: string) => void; onClose: () => void;
}) {
  const [title, setTitle] = useState(article?.title ?? '');
  const [category, setCategory] = useState<HelpCategory>(article?.category ?? 'USAGE');
  const [audience, setAudience] = useState<HelpAudience>(article?.audience ?? 'EVERYONE');
  const [tags, setTags] = useState((article?.tags ?? []).join(', '));
  const [body, setBody] = useState(article?.body ?? '');
  const [removing, setRemoving] = useState(false);
  const { busy, error, run } = useAction();
  const checks = checksIn(body);
  const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
  const changed = !article || title !== article.title || category !== article.category || audience !== article.audience
    || body !== article.body || tagList.join(',') !== article.tags.join(',');

  async function save(published?: boolean) {
    const data = { title, category, audience, tags: tagList, body, ...(published !== undefined ? { published } : {}) };
    const r = await run(() => (article ? patch<HelpArticle>(`/platform/help/${article.id}`, data) : post<HelpArticle>('/platform/help', data)));
    if (r) onSaved(r.id);
  }

  const [mode, setMode] = useState<'write' | 'preview'>(article ? 'preview' : 'write');

  if (!editor && article) {
    return (
      <aside className="side-panel">
        <div className="sp-head">
          <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
            <b style={{ fontSize: 16 }} className="grow">{article.title}</b>
            <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
          </div>
          <span className="small muted">{cat(article.category).label} · {article.audience === 'STAFF' ? 'Staff only' : 'Everyone'} · updated {timeAgo(article.updatedAt)}</span>
        </div>
        <div className="sp-body"><Markdown text={article.body} /></div>
      </aside>
    );
  }

  return (
    <aside className="side-panel">
      <div className="sp-head">
        <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
          <b style={{ fontSize: 15 }} className="grow">{article ? 'Edit article' : 'New article'}</b>
          {article && (article.published ? <Badge tone="ok">Published</Badge> : <Badge tone="warn">Draft</Badge>)}
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
      </div>
      <div className="sp-body">
        <ErrorBox error={error} />
        <label className="field">Title <span className="hint">written like the question people ask</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="Add a family member and choose their rooms" />
        </label>
        <div className="row" style={{ gap: 10 }}>
          <label className="field grow">Section
            <select value={category} onChange={(e) => setCategory(e.target.value as HelpCategory)}>
              {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <label className="field grow">For
            <select value={audience} onChange={(e) => setAudience(e.target.value as HelpAudience)}>
              <option value="EVERYONE">Everyone</option>
              <option value="STAFF">Staff only</option>
            </select>
          </label>
        </div>
        <span className="small muted" style={{ marginTop: -4 }}>{cat(category).hint}</span>
        <label className="field">Keywords <span className="hint">other words people use, also Roman Urdu: batti, pankha, wifi nahi</span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="invite, wife, family, ghar walay" />
        </label>
        <div className="field">
          <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
            <span className="grow">Article</span>
            <Seg options={[{ id: 'write', label: 'Write', icon: 'pencil' }, { id: 'preview', label: 'Preview', icon: 'eye' }]} value={mode} onChange={setMode} />
          </div>
          <span className="hint">Markdown: short steps, **bold** for the button names people see, ## for headings</span>
          {mode === 'write'
            ? <textarea className="mono" rows={18} value={body} onChange={(e) => setBody(e.target.value)} maxLength={20000} aria-label="Article (Markdown)" />
            : <div className="help-preview">{body.trim() ? <Markdown text={body} /> : <span className="muted small">Nothing written yet.</span>}</div>}
        </div>
        {checks.length > 0 && (
          <div className="help-checks">
            <b>Check before publishing</b>
            <ul>{checks.map((c, i) => <li key={i}>{c}</li>)}</ul>
            <span className="small muted">Replace each <code>[[check: …]]</code> with your real figure or promise.</span>
          </div>
        )}
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" disabled={busy || !changed || title.trim().length < 3 || !body.trim()} onClick={() => void save()}>Save</button>
          {(!article || !article.published) ? (
            <button className="btn btn-primary" disabled={busy || checks.length > 0 || title.trim().length < 3 || !body.trim()}
              title={checks.length ? 'Replace the [[check: …]] notes first' : 'The assistant starts using it at once'} onClick={() => void save(true)}>
              {changed ? 'Save and publish' : 'Publish'}
            </button>
          ) : (
            <button className="btn" disabled={busy} onClick={() => void save(false)}>Unpublish</button>
          )}
          {article && <button className="btn btn-ghost push" onClick={() => setRemoving(true)}><Icon name="trash" size={14} />Delete</button>}
        </div>
      </div>
      {removing && article && (
        <Confirm title="Delete this article?" body={`“${article.title}” leaves the Help Center and the assistant stops using it.`} confirmLabel="Delete"
          onClose={() => setRemoving(false)} onConfirm={async () => { await del(`/platform/help/${article.id}`); onSaved(''); }} />
      )}
    </aside>
  );
}
