'use client';
import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { useLoad } from '@/lib/hooks';
import { useLive } from '@/lib/live';
import type { PresenceStatus, WhoIsHome } from '@/lib/types';

const STATUS: Record<PresenceStatus, { label: string; tone: string }> = {
  home: { label: 'Home', tone: 'ok' },
  away: { label: 'Out', tone: 'mute' },
  unknown: { label: 'Not known', tone: 'mute' },
};

/**
 * On the home page: who's home, for owners and admins and for the people who share it themselves
 * (sharing is turned on in the phone app). Nothing for anyone else.
 */
export function WhoIsHomeCard({ isAdmin }: { isAdmin: boolean }) {
  const who = useLoad<WhoIsHome>('/presence');
  useLive('presence.changed', () => void who.reload());
  const w = who.data;
  if (!w || (!isAdmin && !w.sharing)) return null;
  if (!w.people.length) {
    return isAdmin ? (
      <div className="away-card card">
        <span className="away-ic"><Icon name="users" size={17} /></span>
        <span className="grow stack-tight">
          <b>Who’s home</b>
          <span className="small muted">Nobody shares when they’re home yet. Each person can turn it on in the phone app, under Me. Then you can switch things off when the last one leaves (<Link href="/automations">Automations</Link>).</span>
        </span>
      </div>
    ) : null;
  }
  return (
    <div className="away-card card">
      <span className="away-ic"><Icon name="users" size={17} /></span>
      <span className="grow stack-tight" style={{ minWidth: 0 }}>
        <b>{w.line}</b>
        <span className="row small" style={{ gap: 6, flexWrap: 'wrap' }}>
          {w.people.map((p) => (
            <span key={p.id} className={`badge ${STATUS[p.status].tone}`} title={p.since ? `Since ${new Date(p.since).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : undefined}>
              {p.name.split(' ')[0]}{p.me ? ' (you)' : ''}: {STATUS[p.status].label}
            </span>
          ))}
        </span>
        {w.rule?.lastResult && w.rule.lastEventAt && (
          <span className="small muted">
            {w.rule.lastEvent === 'left' ? 'When everyone left' : 'When someone came home'} ({new Date(w.rule.lastEventAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}): {w.rule.lastResult}
          </span>
        )}
      </span>
    </div>
  );
}
