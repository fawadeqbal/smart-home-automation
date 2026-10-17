'use client';
import { DiagnosticsView } from '@/components/home/DiagnosticsView';
import { HomeOnly } from '@/components/home/HomeOnly';
import { OutagesPanel } from '@/components/home/OutagesPanel';
import { useCrumbs } from '@/components/Shell';
import { PageHead } from '@/components/ui';
import { useSession } from '@/lib/session';

export default function DiagnosticsPage() {
  const { home } = useSession();
  useCrumbs([{ label: home?.name ?? 'Home', href: '/' }, { label: 'Diagnostics' }]);
  return (
    <HomeOnly admins>
      <PageHead title="Diagnostics" sub="How each board behind your switchboards is doing, and what is wired to it." />
      <DiagnosticsView canSetup={!!home?.canSetup} allowSupport={!home?.viaStaff}
        editHref={(nodeId) => `/console/homes/${home?.id}/boards/${encodeURIComponent(nodeId)}?tab=devices`}
        openHref={home?.viaStaff ? (nodeId) => `/console/homes/${home.id}/boards/${encodeURIComponent(nodeId)}` : undefined} />
      <div style={{ marginTop: 28 }}><OutagesPanel /></div>
    </HomeOnly>
  );
}
