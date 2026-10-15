'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { get } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Icon } from './Icon';
import { Modal } from './ui';

interface Results {
  homes: { id: string; name: string; city: string }[];
  boards: { id: string; name: string; status: string; homeId: string | null; homeName: string | null }[];
  people: { id: string; name: string; email: string; role: string; homeId: string; homeName: string }[];
}

interface Item { key: string; icon: string; title: string; sub: string; href: string; group: string }

/** ⌘K: jump to a home, a board or a person, or any console page. */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { staffRole } = useSession();
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Results | null>(null);
  const [focus, setFocus] = useState(0);

  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return; }
    const t = setTimeout(() => { void get<Results>(`/platform/search?q=${encodeURIComponent(q.trim())}`).then(setRes).catch(() => setRes(null)); }, 160);
    return () => clearTimeout(t);
  }, [q]);

  const items: Item[] = useMemo(() => {
    if (!res) {
      const pages: [string, string, string, boolean][] = [
        ['Overview', '/console', 'layout-grid', staffRole !== 'INSTALLER'],
        [staffRole === 'INSTALLER' ? 'My jobs' : 'Homes', '/console/homes', 'house', true],
        ['Inventory', '/console/inventory', 'package', staffRole !== 'INSTALLER'],
        ['Team', '/console/team', 'users', staffRole === 'SUPERADMIN'],
        ['Roles & permissions', '/console/roles', 'key', staffRole !== 'INSTALLER'],
        ['Audit log', '/console/audit', 'file-text', staffRole !== 'INSTALLER'],
        ['Plan & billing', '/console/settings', 'credit-card', staffRole === 'SUPERADMIN'],
      ];
      return pages.filter((p) => p[3] && p[0].toLowerCase().includes(q.toLowerCase())).map(([title, href, icon]) => ({ key: href, icon, title, sub: 'Go to page', href, group: 'Pages' }));
    }
    return [
      ...res.homes.map((h) => ({ key: `h${h.id}`, icon: 'house', title: h.name, sub: h.city || 'Home', href: `/console/homes/${h.id}`, group: 'Homes' })),
      ...res.boards.map((b) => ({
        key: `b${b.id}`, icon: 'cpu', title: b.id, sub: `${b.homeName ?? 'Inventory'}${b.status === 'ADOPTED' ? ` · ${b.name}` : ` · ${b.status.toLowerCase()}`}`,
        href: b.homeId ? `/console/homes/${b.homeId}?tab=boards` : `/console/inventory?board=${b.id}`, group: 'Boards',
      })),
      ...res.people.map((p) => ({ key: `p${p.id}${p.homeId}`, icon: 'users', title: p.name, sub: `${p.role} · ${p.homeName}`, href: `/console/homes/${p.homeId}?tab=people`, group: 'People' })),
    ];
  }, [res, q, staffRole]);

  useEffect(() => setFocus(0), [items.length]);

  function go(item?: Item) {
    if (!item) return;
    onClose();
    router.push(item.href);
  }

  let lastGroup = '';
  return (
    <Modal title={<span className="sr-only">Search</span>} onClose={onClose} className="palette">
      <div className="input-icon">
        <Icon name="search" size={17} />
        <input
          autoFocus placeholder="Search homes, boards, people…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setFocus((f) => Math.min(items.length - 1, f + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setFocus((f) => Math.max(0, f - 1)); }
            if (e.key === 'Enter') { e.preventDefault(); go(items[focus]); }
          }}
        />
        <span className="kbd">esc</span>
      </div>
      <div className="palette-list">
        {items.length === 0 && <p className="muted small" style={{ padding: 14 }}>{q.trim().length < 2 ? 'Type at least two letters.' : 'Nothing found.'}</p>}
        {items.map((it, i) => {
          const head = it.group !== lastGroup ? <div className="menu-label" key={`g${it.group}`}>{it.group}</div> : null;
          lastGroup = it.group;
          return (
            <div key={it.key}>
              {head}
              <button className={`menu-item ${i === focus ? 'focus' : ''}`} onMouseEnter={() => setFocus(i)} onClick={() => go(it)}>
                <span className="li-icon"><Icon name={it.icon} size={15} /></span>
                <span className="grow stack-tight"><b className={it.group === 'Boards' ? 'mono' : ''}>{it.title}</b><span>{it.sub}</span></span>
                <Icon name="chevron-right" size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
