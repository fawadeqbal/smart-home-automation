'use client';
import { useRouter } from 'next/navigation';
import { ReactNode, useEffect } from 'react';
import { Loader } from '@/components/Loader';
import { useSession } from '@/lib/session';

/** Pages of the current home; `admins`: owners and admins (and staff acting as one) only. */
export function HomeOnly({ admins = false, children }: { admins?: boolean; children: ReactNode }) {
  const router = useRouter();
  const { home, isAdmin } = useSession();
  const allowed = !!home && (!admins || isAdmin);
  useEffect(() => { if (!allowed) router.replace('/'); }, [allowed, router]);
  return allowed ? <>{children}</> : <Loader />;
}
