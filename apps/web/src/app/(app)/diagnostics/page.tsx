'use client';
import { DiagnosticsView } from '@/components/home/DiagnosticsView';
import { HomeOnly } from '@/components/home/HomeOnly';
import { OutagesPanel } from '@/components/home/OutagesPanel';
import { SheddingPanel } from '@/components/home/PowerPanels';
import { useCrumbs } from '@/components/Shell';
import { PageHead } from '@/components/ui';
import { useSession } from '@/lib/session';

export default function DiagnosticsPage() {
  const { home, isAdmin } = useSession();
  useCrumbs([{ label: home?.name ?? 'Home', href: '/' }, { label: 'Diagnostics' }]);
  return (
    <HomeOnly admins>
      <PageHead eyebrow={home?.name} title="Diagnostics" sub="How each board behind your switchboards is doing, and what is wired to it." />
      <DiagnosticsView canSetup={!!home?.canSetup} allowSupport={!home?.viaStaff}
        editHref={(nodeId) => `/console/homes/${home?.id}/boards/${encodeURIComponent(nodeId)}?tab=devices`}
        openHref={home?.viaStaff ? (nodeId) => `/console/homes/${home.id}/boards/${encodeURIComponent(nodeId)}` : undefined} />
      <div style={{ marginTop: 28 }}><OutagesPanel /></div>
      <div style={{ marginTop: 16 }}><SheddingPanel canEdit={isAdmin && !home?.readOnly} /></div>
    </HomeOnly>
  );
}
