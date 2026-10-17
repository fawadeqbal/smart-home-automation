'use client';
import { ActivityView } from '@/components/home/ActivityView';
import { HomeOnly } from '@/components/home/HomeOnly';
import { useCrumbs } from '@/components/Shell';
import { PageHead } from '@/components/ui';
import { useSession } from '@/lib/session';

export default function ActivityPage() {
  const { home } = useSession();
  useCrumbs([{ label: home?.name ?? 'Home', href: '/' }, { label: 'Activity' }]);
  return (
    <HomeOnly admins>
      <PageHead title="Activity" sub="Changes to your home — by you, your family and your installer." />
      <ActivityView source="/home/activity" showHome={false} />
    </HomeOnly>
  );
}
