'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AddStockDialog, InviteStaffDialog, NewHomeDialog } from '@/components/console/Dialogs';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { useCrumbs } from '@/components/Shell';
import { Dot, Kpi, PageHead } from '@/components/ui';
import { get } from '@/lib/api';
import { useLoad } from '@/lib/hooks';
import { useLive } from '@/lib/live';
import { useSession } from '@/lib/session';
import type { Inventory, Overview } from '@/lib/types';

const SERVICE_ICON: Record<string, string> = { api: 'server', database: 'database', broker: 'radio', assistant: 'mic', scheduler: 'clock' };

function ago(iso: string | null) {
  if (!iso) return '';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'now';
  if (min < 60) return `${min} min`;
  if (min < 1440) return `${Math.round(min / 60)} h`;
  return `${Math.round(min / 1440)} d`;
}

export default function ConsoleOverview() {
  const router = useRouter();
  const { staffRole, me } = useSession();
  const { data, error, reload } = useLoad<Overview>('/platform/overview');
  const [dialog, setDialog] = useState<null | 'home' | 'stock' | 'staff'>(null);
  const [inv, setInv] = useState<Inventory | null>(null);
  const [checked, setChecked] = useState(Date.now());
  const [, tick] = useState(0);
  useCrumbs([{ label: 'Platform', href: '/console' }, { label: 'Overview' }]);
  useLive('inventory.changed', () => void reload());
  useLive('firmware.changed', () => void reload());
  useLive('visits.changed', () => void reload());
  useLive('homes.changed', () => void reload());
  useLive('node.status', () => void reload());

  useEffect(() => { if (staffRole === 'INSTALLER') router.replace('/console/homes'); }, [staffRole, router]);
  useEffect(() => {
    const t = setInterval(() => { void reload().then(() => setChecked(Date.now())); }, 15000);
    const s = setInterval(() => tick((n) => n + 1), 1000);
    return () => { clearInterval(t); clearInterval(s); };
  }, [reload]);

  if (!data) return error ? <div className="alert">{error}</div> : <Loader label="Loading the platform…" />;
  const k = data.kpis;
  const canAdmin = staffRole === 'SUPERADMIN';
  const max = Math.max(1, ...data.bars.map((b) => b.ok + b.bad));
  const rate = `${(k.confirmed * 100).toFixed(1)}%`;
  const needs = data.attention.length;
  const servicesDown = data.services.filter((s) => !s.ok && s.key !== 'assistant').length;
  const firstRun = canAdmin && (k.homes === 0 || k.boardsInstalled + k.inStock + k.assigned === 0 || k.staff <= 1);

  return (
    <>
      <PageHead
        title="Overview"
        sub={`${needs ? `${needs} thing${needs === 1 ? '' : 's'} need${needs === 1 ? 's' : ''} attention` : 'Nothing needs attention'} across ${k.homes} home${k.homes === 1 ? '' : 's'}. ${servicesDown ? `${servicesDown} service${servicesDown === 1 ? ' is' : 's are'} down.` : 'Services are healthy.'}`}
        actions={
          <>
            <span className={`badge ${data.allOk ? 'ok' : 'bad'}`} style={{ height: 30, padding: '0 10px' }}>{data.allOk ? 'All systems running' : 'Service problem'}</span>
            {canAdmin && <button className="btn btn-primary" onClick={() => setDialog('home')}><Icon name="plus" size={15} />New home</button>}
          </>
        }
      />

      {staffRole === 'SUPERADMIN' && !me.twoFactor && (
        <div className="banner warn mb16">
          <span className="banner-led" />
          <div className="banner-text"><b>Protect your super admin account</b><span>Turn on two-step sign-in: a super admin can reach every home and board.</span></div>
          <Link className="btn" href="/account">Turn it on</Link>
        </div>
      )}

      {firstRun && (
        <div className="getting-started">
          {[
            { done: k.homes > 0, n: 1, title: 'Create a customer home', body: 'Name, city and the installer who sets it up. The owner gets an invite.', action: 'New home', go: () => setDialog('home') },
            { done: k.boardsInstalled + k.inStock + k.assigned > 0, n: 2, title: 'Add boards to stock', body: 'Register boards by their ID, then assign them to homes.', action: 'Add boards', go: () => { void get<Inventory>('/platform/inventory').then((i) => { setInv(i); setDialog('stock'); }); } },
            { done: k.staff > 1, n: 3, title: 'Invite your team', body: 'Installers set up the homes you give them; support can look into any home.', action: 'Invite', go: () => setDialog('staff') },
          ].map((c) => (
            <div key={c.n} className={`gs-card ${c.done ? 'done' : ''}`}>
              <span className="gs-n">{c.done ? <Icon name="check" size={13} stroke={2.5} /> : c.n}</span>
              <b>{c.title}</b>
              <span className="small muted">{c.body}</span>
              {!c.done && <button className="btn btn-sm" onClick={c.go}>{c.action}</button>}
            </div>
          ))}
        </div>
      )}

      <div className="grid-2 mb16">
        <section className="panel">
          <div className="panel-head">
            <h2>Needs attention</h2>
            {needs > 0 && <span className="pill bad">{needs}</span>}
            <Link href="/console/homes" className="link-btn">All homes</Link>
          </div>
          {data.attention.length === 0 && <div className="li"><span className="li-text"><span className="sub">All homes are healthy and set up.</span></span></div>}
          {data.attention.map((a, i) => (
            <div className="li" key={`${a.homeId}-${i}`}>
              <Dot tone={a.tone} />
              <div className="li-text">
                <span style={{ fontSize: 13.5 }}><b>{a.title}</b><span className="muted"> · {a.home}</span></span>
                <span className="sub">{a.detail}</span>
              </div>
              <span className="small muted nowrap">{ago(a.at)}</span>
              <Link className="btn btn-sm" href={a.href ?? (a.nodeId ? `/console/homes/${a.homeId}/boards/${encodeURIComponent(a.nodeId)}` : `/console/homes/${a.homeId}?tab=${a.tab}`)}>{a.nodeId ? 'Open board' : 'Open'}</Link>
            </div>
          ))}
        </section>

        <section className="panel">
          <div className="panel-head"><h2>Services</h2><span className="muted">Checked {Math.max(0, Math.round((Date.now() - checked) / 1000))} s ago</span></div>
          {data.services.map((s) => (
            <div className="li" key={s.key}>
              <span className={`li-icon ${s.ok ? 'ok' : 'bad'}`}><Icon name={SERVICE_ICON[s.key] ?? 'server'} size={15} /></span>
              <div className="li-text"><b>{s.name}</b><span className="sub">{s.line}</span></div>
              <span className="mono small muted">{s.metric}</span>
              <Dot tone={s.ok ? 'ok' : s.key === 'assistant' ? 'warn' : 'bad'} />
            </div>
          ))}
        </section>
      </div>

      <div className="kpis strip">
        <Kpi label="Homes" value={k.homes} sub={`${k.settingUp} setting up`} />
        <Kpi label="People" value={k.people} sub={`${k.staff} platform staff`} />
        <Kpi label="Boards online" value={`${k.boardsOnline}/${k.boardsInstalled}`} sub={`${k.boardsInstalled - k.boardsOnline} offline`} fg={k.boardsOnline < k.boardsInstalled ? 'fg-warn' : ''} />
        <Kpi label="In stock" value={k.inStock} sub={`${k.assigned} assigned, not installed`} />
        <Kpi label="Commands · 24 h" value={k.commands.toLocaleString('en-US')} sub={Object.keys(k.byChannel).length ? Object.entries(k.byChannel).sort((a, b) => b[1] - a[1]).map(([c]) => c === 'web' ? 'app' : c === 'automation' ? 'schedule' : c).filter((c, i, all) => all.indexOf(c) === i).join(' · ') : 'none yet'} />
        <Kpi label="Confirmed" value={k.commands ? rate : '—'} sub={`${k.failed} failed or unanswered`} fg="fg-ok" />
      </div>

      <section className="panel panel-pad stack">
        <div className="row" style={{ alignItems: 'baseline', gap: '8px 16px' }}>
          <h2>Commands · last 24 h</h2>
          <span className="small muted">{k.commands.toLocaleString('en-US')} sent · {k.commands ? rate : '—'} confirmed by the board</span>
          <span className="legend push"><span><i style={{ background: 'var(--chart)' }} />Confirmed</span><span><i style={{ background: 'var(--bad)' }} />Failed or no answer</span></span>
        </div>
        <div className="cmd-chart" role="img" aria-label="Commands per hour, last 24 hours">
          {data.bars.map((b) => (
            <div key={b.hour} title={`${new Date(b.hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}: ${b.ok} confirmed, ${b.bad} failed`}>
              <span className="ok" style={{ height: `${(b.ok / max) * 100}%` }} />
              <span className="bad" style={{ height: `${(b.bad / max) * 100}%` }} />
            </div>
          ))}
        </div>
        <div className="chart-axis"><span>24 h ago</span><span>12 h ago</span><span>now</span></div>
      </section>

      {dialog === 'home' && <NewHomeDialog onClose={() => setDialog(null)} onCreated={() => void reload()} />}
      {dialog === 'stock' && inv && <AddStockDialog inv={inv} onClose={() => setDialog(null)} onDone={() => void reload()} />}
      {dialog === 'staff' && <InviteStaffDialog onClose={() => setDialog(null)} onDone={() => void reload()} />}
    </>
  );
}
