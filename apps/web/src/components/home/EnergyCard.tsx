'use client';
import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { useLoad } from '@/lib/hooks';
import type { Energy } from '@/lib/types';

/** On the home page: this week's electricity, roughly, and what used the most. */
export function EnergyCard() {
  const { data } = useLoad<Energy>('/energy?days=7');
  if (!data || data.total.kwh < 0.05) return null;
  const top = data.devices.find((d) => d.kwh > 0);
  return (
    <Link className="energy-card card" href="/energy">
      <span className="outage-ic"><Icon name="zap" size={15} /></span>
      <span className="grow stack-tight" style={{ minWidth: 0 }}>
        <b>This week: about {data.total.kwh < 10 ? data.total.kwh.toFixed(1) : Math.round(data.total.kwh)} units · Rs {data.total.cost.toLocaleString('en-PK')}</b>
        <span className="small muted">{top ? `Most from ${top.name}` : ''}{top ? ' · ' : ''}a month at this pace ≈ Rs {data.month.cost.toLocaleString('en-PK')} (estimate)</span>
      </span>
      <Icon name="chevron-right" size={16} />
    </Link>
  );
}
