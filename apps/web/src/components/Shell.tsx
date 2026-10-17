'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { get } from '@/lib/api';
import { useLive, useLiveStatus } from '@/lib/live';
import { ROLE_LABEL, STAFF_LABEL } from '@/lib/roles';
import { useSession } from '@/lib/session';
import type { Overview } from '@/lib/types';
import { AppInstall } from './AppInstall';
import { AssistantDrawer, AssistantLauncher, VoiceOverlay } from './assistant/Assistant';
import { AssistantProvider } from '@/lib/assistant';
import { CommandPalette } from './CommandPalette';
import { Icon, toggleTheme } from './Icon';
import { NoticeToasts, NotificationBell } from './NotificationBell';
import { ScheduleNotices } from './ScheduleNotices';
import { Avatar, Dropdown } from './ui';

/* ---------------------------------------------------------------- breadcrumbs, set by each page */
export interface Crumb { label: string; href?: string }
const CrumbsContext = createContext<{ set: (path: string, c: Crumb[]) => void }>({ set: () => undefined });

/** The page's breadcrumbs in the top bar (kept per path, so a page without them never shows stale ones). */
export function useCrumbs(crumbs: Crumb[]) {
  const { set } = useContext(CrumbsContext);
  const path = usePathname();
  const key = JSON.stringify(crumbs);
  useEffect(() => { set(path, JSON.parse(key) as Crumb[]); }, [key, set, path]);
}

/* ---------------------------------------------------------------- navigation */
interface NavItem { href: string; label: string; icon: string; count?: string | null; countBad?: boolean; exact?: boolean; sub?: { href: string; label: string } }

function useConsoleCounts(enabled: boolean, installer: boolean) {
  const [counts, setCounts] = useState<{ attention: number; homes: number; stock: number; visits: number } | null>(null);
  const [tickets, setTickets] = useState(0);
  const load = useCallback(() => {
    if (!enabled) return;
    if (installer) {
      void get<unknown[]>('/platform/homes').then((h) => setCounts({ attention: 0, homes: h.length, stock: 0, visits: 0 })).catch(() => undefined);
    } else {
      void get<Overview>('/platform/overview').then((o) => setCounts({ attention: o.attentionCount, homes: o.kpis.homes, stock: o.kpis.inStock, visits: o.visitsWaiting ?? 0 })).catch(() => undefined);
    }
  }, [enabled, installer]);
  const loadTickets = useCallback(() => {
    if (enabled) void get<{ open: number }>('/platform/tickets?status=open').then((t) => setTickets(t.open)).catch(() => undefined);
  }, [enabled]);
  useEffect(() => { load(); loadTickets(); }, [load, loadTickets]);
  useLive('notification', loadTickets);
  useLive('inventory.changed', load);
  useLive('homes.changed', load);
  useLive('visits.changed', load);
  return counts ? { ...counts, tickets } : null;
}

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  useEffect(() => { setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'); }, []);
  return { theme, toggle: () => setTheme(toggleTheme() as 'light' | 'dark') };
}

export function Shell({ children }: { children: ReactNode }) {
  const { me, home, isAdmin, staffRole, logout, switchHome } = useSession();
  const live = useLiveStatus();
  const path = usePathname();
  const router = useRouter();
  const [crumbState, setCrumbState] = useState<{ path: string; crumbs: Crumb[] }>({ path: '', crumbs: [] });
  const setCrumbs = useCallback((p: string, c: Crumb[]) => setCrumbState({ path: p, crumbs: c }), []);
  const crumbs = crumbState.path === path ? crumbState.crumbs : [];
  const [palette, setPalette] = useState(false);
  const { theme, toggle } = useTheme();
  const platform = path.startsWith('/console');
  const counts = useConsoleCounts(!!staffRole, staffRole === 'INSTALLER');
  const wsMatch = path.match(/^\/console\/homes\/([^/?]+)/);
  const [wsName, setWsName] = useState<string | null>(null);
  useEffect(() => {
    const last = crumbs[crumbs.length - 1];
    if (wsMatch && crumbs.length >= 3) setWsName(crumbs[2]!.label);
    else if (!wsMatch) setWsName(null);
    void last;
  }, [crumbs, wsMatch]);

  // ⌘K / Ctrl+K opens the search for staff
  useEffect(() => {
    if (!staffRole) return;
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [staffRole]);

  const nav: NavItem[] = useMemo(() => {
    if (platform) {
      if (!staffRole) return [];
      const homesItem: NavItem = {
        href: '/console/homes', label: staffRole === 'INSTALLER' ? 'My jobs' : 'Homes', icon: 'house', count: counts ? String(counts.homes) : null,
        sub: wsMatch && wsName ? { href: `/console/homes/${wsMatch[1]}`, label: wsName } : undefined,
      };
      const help: NavItem = { href: '/console/help', label: 'Help Center', icon: 'help' };
      const outages: NavItem = { href: '/console/outages', label: 'Power & outages', icon: 'zap' };
      const tickets: NavItem = { href: '/console/tickets', label: 'Tickets', icon: 'message', count: counts?.tickets ? String(counts.tickets) : null };
      if (staffRole === 'INSTALLER') return [homesItem, tickets, outages, help];
      const base: NavItem[] = [
        { href: '/console', label: 'Overview', icon: 'layout-grid', exact: true, count: counts?.attention ? String(counts.attention) : null, countBad: true },
        homesItem,
      ];
      const billing: NavItem = { href: '/console/billing', label: 'Contracts & invoices', icon: 'wallet' };
      const visits: NavItem = { href: '/console/requests', label: 'Visit requests', icon: 'phone', count: counts?.visits ? String(counts.visits) : null };
      if (staffRole === 'SUPPORT') return [...base, tickets, outages, visits, billing, { href: '/console/inventory', label: 'Inventory', icon: 'package' }, help, { href: '/console/audit', label: 'Audit log', icon: 'file-text' }, { href: '/console/roles', label: 'Roles & permissions', icon: 'key' }];
      return [
        ...base,
        tickets,
        outages,
        visits,
        billing,
        { href: '/console/inventory', label: 'Inventory', icon: 'package', count: counts ? String(counts.stock) : null },
        { href: '/console/firmware', label: 'Firmware', icon: 'cpu' },
        ...(me.staff?.org.selfHosted ? [{ href: '/console/backups', label: 'Backups', icon: 'database' }] : []),
        { href: '/console/team', label: 'Team', icon: 'users' },
        help,
        { href: '/console/roles', label: 'Roles & permissions', icon: 'key' },
        { href: '/console/audit', label: 'Audit log', icon: 'file-text' },
        me.staff?.org.selfHosted
          ? { href: '/console/settings', label: 'Company', icon: 'building' }
          : { href: '/console/settings', label: 'Plan & billing', icon: 'credit-card' },
      ];
    }
    if (!home) return [{ href: '/', label: 'Home', icon: 'house', exact: true }];
    const items: NavItem[] = [{ href: '/', label: 'Home', icon: 'house', exact: true }];
    if (!home.readOnly) items.push({ href: '/automations', label: 'Automations', icon: 'clock' });
    items.push({ href: '/energy', label: 'Electricity', icon: 'zap' });
    if (!home.readOnly) items.push({ href: '/support', label: 'Help requests', icon: 'message' });
    if (isAdmin && !home.readOnly) items.push({ href: '/billing', label: 'Plan & bills', icon: 'wallet' });
    if (isAdmin) {
      items.push(
        { href: '/rooms', label: 'Rooms', icon: 'door-open' },
        { href: '/diagnostics', label: 'Diagnostics', icon: 'activity' },
        { href: '/people', label: 'People', icon: 'users' },
        { href: '/activity', label: 'Activity', icon: 'file-text' },
      );
    }
    return items;
  }, [platform, staffRole, counts, wsMatch, wsName, home, isAdmin]);

  const active = (n: NavItem) => (n.exact ? path === n.href : path === n.href || path.startsWith(`${n.href}/`));
  const roleLabel = platform || !home
    ? (staffRole ? `${STAFF_LABEL[staffRole]} · ${me.staff!.org.name}` : 'No home yet')
    : home.viaStaff ? `${STAFF_LABEL[staffRole!]} · viewing` : `${ROLE_LABEL[home.role]} · ${home.name}`;
  const avatarRole = platform || !home || home.viaStaff ? (staffRole ? STAFF_LABEL[staffRole] : 'member') : ROLE_LABEL[home.role];

  const ctx = platform
    ? { icon: 'shield', cls: 'platform', title: staffRole === 'INSTALLER' ? 'Field console' : 'Platform console', sub: me.staff ? (me.staff.org.selfHosted ? me.staff.org.name : `${me.staff.org.name} · ${me.staff.org.planName}`) : '' }
    : home
      ? { icon: 'house', cls: 'home', title: home.name, sub: home.viaStaff ? `Viewing as ${STAFF_LABEL[staffRole!].toLowerCase()}` : `${home.role === 'OWNER' ? 'Your home' : ROLE_LABEL[home.role]}${home.city ? ` · ${home.city}` : ''}` }
      : { icon: 'house', cls: 'home', title: 'No home yet', sub: 'Ask for an invite' };

  async function openHome(id: string) {
    await switchHome(id);
    router.push('/');
  }

  const switcher = (
    <Dropdown align="left" width="100%" trigger={(open, toggleMenu) => (
      <button className="ctx" onClick={toggleMenu} aria-expanded={open} aria-haspopup="menu">
        <span className={`ctx-icon ${ctx.cls}`}><Icon name={ctx.icon} size={16} /></span>
        <span className="ctx-text"><b>{ctx.title}</b><span>{ctx.sub}</span></span>
        <span className="muted"><Icon name="chevron-down" size={14} /></span>
      </button>
    )}>
      {(close) => (
        <>
          {staffRole && (
            <>
              <div className="menu-label">{me.staff!.org.name}</div>
              <button className="menu-item" onClick={() => { close(); router.push(staffRole === 'INSTALLER' ? '/console/homes' : '/console'); }}>
                <span className="ctx-icon platform" style={{ width: 26, height: 26, borderRadius: 7 }}><Icon name="shield" size={13} /></span>
                <span className="grow stack-tight"><b>{staffRole === 'INSTALLER' ? 'Field console' : 'Platform console'}</b><span>{STAFF_LABEL[staffRole]}</span></span>
                {platform && <Icon name="check" size={14} />}
              </button>
            </>
          )}
          {(me.homes.length > 0 || (home?.viaStaff)) && <div className="menu-label">Homes</div>}
          {me.homes.map((h) => (
            <button key={h.id} className="menu-item" onClick={() => { close(); void openHome(h.id); }}>
              <span className="ctx-icon home" style={{ width: 26, height: 26, borderRadius: 7 }}><Icon name="house" size={13} /></span>
              <span className="grow stack-tight"><b className="truncate">{h.name}</b><span>{ROLE_LABEL[h.role]}{h.city ? ` · ${h.city}` : ''}</span></span>
              {!platform && home?.id === h.id && <Icon name="check" size={14} />}
            </button>
          ))}
          {home?.viaStaff && !me.homes.some((h) => h.id === home.id) && (
            <button className="menu-item" onClick={() => { close(); router.push('/'); }}>
              <span className="ctx-icon home" style={{ width: 26, height: 26, borderRadius: 7 }}><Icon name="eye" size={13} /></span>
              <span className="grow stack-tight"><b className="truncate">{home.name}</b><span>Viewing as staff</span></span>
              {!platform && <Icon name="check" size={14} />}
            </button>
          )}
        </>
      )}
    </Dropdown>
  );

  const PAGE: Record<string, string> = { '/automations': 'Automations', '/energy': 'Electricity', '/summary': 'Summary', '/support': 'Help requests', '/installation': 'Installation', '/billing': 'Plan & bills', '/notifications': 'Notifications', '/help': 'Help' };
  const fallback = PAGE[path] ?? (path.startsWith('/devices/') ? 'Device' : null);
  const shownCrumbs: Crumb[] = crumbs.length ? crumbs
    : platform ? [{ label: 'Platform' }]
      : [{ label: home?.name ?? 'Home', href: '/' }, ...(fallback ? [{ label: fallback }] : [])];

  return (
    <CrumbsContext.Provider value={{ set: setCrumbs }}>
      <AssistantProvider homeId={platform ? 'console' : home?.id ?? null} console={platform && !!staffRole}>
      <div className="app">
        <aside className="side" aria-label="Main">
          <Link href={platform ? (staffRole === 'INSTALLER' ? '/console/homes' : '/console') : '/'} className="side-brand">
            <span className="brand-mark"><Icon name="toggle-right" size={16} stroke={2} /></span>
            <b>Switchboard</b>
            <span className="ctx-pill">{platform ? 'Console' : 'Home'}</span>
          </Link>
          <div className="ctx-wrap">{switcher}</div>
          <div className="side-label">{platform ? 'Platform' : 'Your home'}</div>
          <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {nav.map((n) => (
              <div key={n.href} style={{ display: 'contents' }}>
                <Link href={n.href} className={`nav-item ${active(n) && !(n.sub && path !== n.href) ? 'active' : ''} ${n.sub ? 'parent' : ''}`}>
                  <Icon name={n.icon} size={17} />
                  <span className="grow truncate">{n.label}</span>
                  {n.count && <span className={`count ${n.countBad ? 'bad' : ''}`}>{n.count}</span>}
                </Link>
                {n.sub && (
                  <Link href={n.sub.href} className="nav-item sub active">
                    <Icon name="chevron-right" size={14} /><span className="grow truncate">{n.sub.label}</span>
                  </Link>
                )}
              </div>
            ))}
          </nav>
          <AppInstall />
          <div className="side-foot">
            <span className={`live ${live ? '' : 'off'}`}><span className="live-dot" />{live ? 'Live connection' : 'Reconnecting…'}</span>
            <div className="me-row">
              <Link href="/account" className="me-link" title="Your account">
                <Avatar name={me.name} role={avatarRole} />
                <span className="me-text"><b>{me.name}</b><span>{roleLabel}</span></span>
              </Link>
              <button className="icon-btn" onClick={toggle} title="Light / dark" aria-label="Switch light or dark mode"><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} /></button>
              <button className="icon-btn" onClick={logout} title="Sign out" aria-label="Sign out"><Icon name="log-out" size={16} /></button>
            </div>
          </div>
        </aside>

        <div className="frame">
          <header className="topbar">
            <nav className="crumbs" aria-label="Breadcrumb">
              {shownCrumbs.map((c, i) => (
                <span key={`${c.label}-${i}`} style={{ display: 'contents' }}>
                  {i > 0 && <span className="crumb-sep">/</span>}
                  {c.href && i < shownCrumbs.length - 1 ? <Link href={c.href}>{c.label}</Link> : <span className="cur">{c.label}</span>}
                </span>
              ))}
            </nav>
            <span className="grow" />
            {staffRole && (
              <button className="searchbox hide-sm" onClick={() => setPalette(true)}>
                <Icon name="search" size={15} /><span className="grow truncate">Search homes, boards, people</span><span className="kbd">⌘K</span>
              </button>
            )}
            <NotificationBell />
          </header>

          <header className="m-head">
            <span className="brand-mark sm"><Icon name="toggle-right" size={15} stroke={2} /></span>
            <Dropdown align="left" width={280} trigger={(_o, t) => (
              <button className="ctx-btn" onClick={t}><b className="truncate">{ctx.title}</b><Icon name="chevron-down" size={14} /></button>
            )}>
              {(close) => (
                <>
                  {staffRole && <button className="menu-item" onClick={() => { close(); router.push(staffRole === 'INSTALLER' ? '/console/homes' : '/console'); }}><Icon name="shield" size={15} />Platform console</button>}
                  {me.homes.map((h) => <button key={h.id} className="menu-item" onClick={() => { close(); void openHome(h.id); }}><Icon name="house" size={15} />{h.name}</button>)}
                  <div className="menu-sep" />
                  <button className="menu-item" onClick={() => { close(); router.push('/account'); }}><Icon name="user" size={15} />Your account</button>
                  <button className="menu-item" onClick={() => { close(); toggle(); }}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />{theme === 'dark' ? 'Light mode' : 'Dark mode'}</button>
                  <button className="menu-item danger" onClick={() => { close(); void logout(); }}><Icon name="log-out" size={15} />Sign out</button>
                </>
              )}
            </Dropdown>
            <span className={`live-dot ${live ? '' : 'off'}`} title={live ? 'Live' : 'Reconnecting…'} />
            <span className="grow" />
            {staffRole && <button className="icon-btn icon-btn-lg" aria-label="Search" onClick={() => setPalette(true)}><Icon name="search" size={19} /></button>}
            <NotificationBell className="icon-btn icon-btn-lg" />
            <Avatar name={me.name} role={avatarRole} />
          </header>

          {!platform && home?.viaStaff && (
            <div className="view-as">
              <Icon name="eye" size={15} />
              <span className="grow">Viewing <b>{home.name}</b> as {STAFF_LABEL[staffRole!].toLowerCase()}{home.readOnly ? ' · read-only' : ''}.</span>
              <Link href={`/console/homes/${home.id}`}>Back to workspace</Link>
            </div>
          )}

          <div className="scroll">
            <main className="main">{children}</main>
          </div>

          {nav.length > 1 && (
            <nav className="tabbar" aria-label="Main">
              {nav.slice(0, 6).map((n) => (
                <Link key={n.href} href={n.href} className={`tab ${active(n) ? 'active' : ''}`}>
                  <Icon name={n.icon} size={21} /><span>{n.label.replace(' & permissions', '').replace('Plan & billing', 'Billing')}</span>
                </Link>
              ))}
            </nav>
          )}
        </div>
        <NoticeToasts />
        <ScheduleNotices userId={me.id} isAdmin={isAdmin} />
        {palette && <CommandPalette onClose={() => setPalette(false)} />}
        {/* in a home: people who may act there; in the console: any staff (read-only tools, their role's homes) */}
        {(platform ? !!staffRole : home && !home.readOnly) && <><AssistantLauncher /><AssistantDrawer /><VoiceOverlay /></>}
      </div>
      </AssistantProvider>
    </CrumbsContext.Provider>
  );
}
