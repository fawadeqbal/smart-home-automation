'use client';
import { useState } from 'react';
import { ActivityView } from '@/components/home/ActivityView';
import { Icon } from '@/components/Icon';
import { useCrumbs } from '@/components/Shell';
import { PageHead } from '@/components/ui';
import { useLoad } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { HomeRow } from '@/lib/types';

export default function AuditPage() {
  const { staffRole } = useSession();
  const homes = useLoad<HomeRow[]>('/platform/homes');
  const [home, setHome] = useState('');
  useCrumbs([{ label: 'Platform', href: '/console' }, { label: 'Audit log' }]);
  const source = `/platform/audit${home ? `?home=${home}` : ''}`;
  return (
    <>
      <PageHead title="Audit log" sub="Every change on the platform — who, what, and in which home."
        actions={
          <>
            <select className="inline-select" style={{ height: 34 }} value={home} onChange={(e) => setHome(e.target.value)} aria-label="Home">
              <option value="">All homes</option>
              {homes.data?.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
            {staffRole !== 'INSTALLER' && <a className="btn" href={`/api/platform/audit.csv${home ? `?home=${home}` : ''}`} download><Icon name="download" size={15} />Export CSV</a>}
          </>
        }
      />
      <ActivityView source={source} showHome={!home} billing={staffRole === 'SUPERADMIN'} />
    </>
  );
}
