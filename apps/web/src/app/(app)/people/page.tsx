'use client';
import { HomeOnly } from '@/components/home/HomeOnly';
import { PeopleView } from '@/components/home/PeopleView';
import { useCrumbs } from '@/components/Shell';
import { PageHead } from '@/components/ui';
import { useSession } from '@/lib/session';

export default function PeoplePage() {
  const { me, home } = useSession();
  useCrumbs([{ label: home?.name ?? 'Home', href: '/' }, { label: 'People' }]);
  const installer = me.staff?.role === 'INSTALLER' && home?.viaStaff && home.role !== 'OWNER';
  return (
    <HomeOnly admins>
      <PageHead eyebrow={home?.name} title="People" sub="Who can sign in, and what each person may do in each room." />
      {home && <PeopleView actorRole={home.role} actorId={me.id} canManage={!home.readOnly && !installer} ownerInviteOnly={!!installer} timeZone={home.timezone || undefined} />}
    </HomeOnly>
  );
}
