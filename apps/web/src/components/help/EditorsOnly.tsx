'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useSession } from '@/lib/session';
import { Icon } from '../Icon';

/** Writing Help Center articles is for super admins; everyone else reads them. */
export function EditorsOnly({ children, back = '/console/help' }: { children: ReactNode; back?: string }) {
  const { staffRole } = useSession();
  if (staffRole === 'SUPERADMIN') return <>{children}</>;
  return (
    <div className="card card-pad stack" style={{ maxWidth: 560 }}>
      <b>Only super admins edit the Help Center</b>
      <span className="muted">You can read every article. To change one, ask a super admin.</span>
      <Link href={back} className="btn" style={{ alignSelf: 'flex-start' }}><Icon name="arrow-left" size={15} />Back</Link>
    </div>
  );
}
