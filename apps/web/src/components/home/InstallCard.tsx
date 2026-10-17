'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { get } from '@/lib/api';
import type { InstallReport } from '@/lib/types';

/** On the home page, for the owner: the installation is ready to be signed. */
export function InstallCard() {
  const [r, setR] = useState<InstallReport | null>(null);
  useEffect(() => { void get<InstallReport | null>('/home/installation').then((x) => setR(x ?? null)).catch(() => undefined); }, []);
  if (!r || r.signed || !r.canSign || r.done < r.total) return null;
  return (
    <Link className="energy-card card" href="/installation">
      <span className="outage-ic" style={{ background: 'var(--acs)', color: 'var(--act)' }}><Icon name="check" size={15} /></span>
      <span className="grow stack-tight" style={{ minWidth: 0 }}>
        <b>Your installation is finished</b>
        <span className="small muted">{r.installer ?? 'Your installer'} checked {r.total} things and added {r.photos.length} photo{r.photos.length === 1 ? '' : 's'}. Have a look and sign it off.</span>
      </span>
      <Icon name="chevron-right" size={16} />
    </Link>
  );
}
