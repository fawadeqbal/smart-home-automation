'use client';
import { HomeOnly } from '@/components/home/HomeOnly';
import { RoomsView } from '@/components/home/RoomsView';
import { useCrumbs } from '@/components/Shell';
import { PageHead } from '@/components/ui';
import { useSession } from '@/lib/session';

export default function RoomsPage() {
  const { home } = useSession();
  useCrumbs([{ label: home?.name ?? 'Home', href: '/' }, { label: 'Rooms' }]);
  return (
    <HomeOnly admins>
      <PageHead title="Rooms" sub="Group devices by room. Members and guests are given access room by room." />
      <RoomsView canEdit={!home?.readOnly} />
    </HomeOnly>
  );
}
