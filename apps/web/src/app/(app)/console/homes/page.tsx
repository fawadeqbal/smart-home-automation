'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { NewHomeDialog } from '@/components/console/Dialogs';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { useCrumbs } from '@/components/Shell';
import { Badge, Empty, PageHead, Seg } from '@/components/ui';
import { useLoad } from '@/lib/hooks';
import { useLive } from '@/lib/live';
import { useSession } from '@/lib/session';
import type { HomeRow } from '@/lib/types';

type Filter = 'all' | 'attention' | 'setup' | 'live' | 'archived';

export default function HomesPage() {
  const router = useRouter();
  const { staffRole } = useSession();
  const installer = staffRole === 'INSTALLER';
  const { data, error, reload } = useLoad<HomeRow[]>('/platform/homes');
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const title = installer ? 'My jobs' : 'Homes';
  useCrumbs([{ label: 'Platform', href: installer ? '/console/homes' : '/console' }, { label: title }]);
  useLive('homes.changed', () => void reload());
  useLive('inventory.changed', () => void reload());

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data ?? []).filter((h) =>
      (filter === 'all' ? h.status !== 'archived' : h.status === filter) &&
      (!term || [h.name, h.city, h.owner ?? '', h.installer ?? ''].some((v) => v.toLowerCase().includes(term))));
  }, [data, filter, q]);

  if (!data) return error ? <div className="alert">{error}</div> : <Loader label="Loading homes…" />;
  const n = (f: Filter) => data.filter((h) => (f === 'all' ? h.status !== 'archived' : h.status === f)).length;
  const live = data.filter((h) => h.status !== 'archived');

  return (
    <>
      <PageHead title={title}
        sub={installer ? 'Homes you are installing or looking after.' : `${live.length} homes · ${n('attention')} need attention · ${n('setup')} setting up`}
        actions={staffRole === 'SUPERADMIN' && <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" size={15} />New home</button>}
      />
      <div className="row mb16" style={{ gap: 10 }}>
        <Seg<Filter> value={filter} onChange={setFilter} options={[
          { id: 'all', label: 'All', n: n('all') }, { id: 'attention', label: 'Needs attention', n: n('attention') },
          { id: 'setup', label: 'Setting up', n: n('setup') }, { id: 'live', label: 'Live', n: n('live') },
          ...(n('archived') ? [{ id: 'archived' as Filter, label: 'Archived', n: n('archived') }] : []),
        ]} />
        <label className="input-icon push" style={{ width: 'min(260px, 100%)' }}>
          <Icon name="search" size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name, owner, city" aria-label="Filter homes" />
        </label>
      </div>

      {data.length === 0 ? (
        <Empty action={staffRole === 'SUPERADMIN' && <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" size={15} />New home</button>}>
          {installer ? 'No homes are assigned to you yet. Your administrator assigns homes to installers.' : 'No homes yet. Create the first customer home to start.'}
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="table" style={{ minWidth: 860 }}>
            <thead><tr>{['Home', 'Owner', 'Status', 'Setup', 'Boards', 'People', 'Installer', 'Last activity'].map((c) => <th key={c}>{c}</th>)}<th /></tr></thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.id} className="click" onClick={() => router.push(`/console/homes/${h.id}`)}>
                  <td>
                    <div className="cell-main">
                      <span className="li-icon house"><Icon name="house" size={15} /></span>
                      <span className="stack-tight"><b>{h.name}</b><span className="cell-sub">{h.city || '—'}</span></span>
                    </div>
                  </td>
                  <td className="nowrap">{h.owner ?? <span className="muted">—</span>}{h.ownerPending && <span className="cell-sub"> · invited</span>}</td>
                  <td><Badge tone={h.tone}>{h.statusLabel}</Badge></td>
                  <td>
                    <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                      <span className={`segs ${h.steps === 6 ? 'complete' : ''}`}>{h.stepFlags.map((d, i) => <i key={i} className={d ? 'done' : ''} />)}</span>
                      <span className="cell-sub">{h.steps}/6</span>
                    </div>
                  </td>
                  <td className="nowrap"><b className={h.boardsOnline < h.boardsInstalled ? 'fg-warn' : ''}>{h.boardsOnline}</b><span className="muted"> / {h.boardsTotal}</span></td>
                  <td>{h.people}</td>
                  <td className="nowrap">{h.installer ?? <span className="muted">—</span>}</td>
                  <td className="muted nowrap">{h.lastActivityLabel}</td>
                  <td className="muted" style={{ paddingLeft: 4, paddingRight: 10 }}><Icon name="chevron-right" size={16} /></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={9} className="muted" style={{ textAlign: 'center', padding: 24 }}>No homes match.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {creating && <NewHomeDialog onClose={() => setCreating(false)} onCreated={() => void reload()} />}
    </>
  );
}
