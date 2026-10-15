'use client';
import { useEffect, useRef, useState } from 'react';
import { useLive } from '@/lib/live';

interface Ran { key: number; name: string; result: string; ok: boolean }

/** A short notice when one of my timers/schedules ran (admins see everyone's). */
export function ScheduleNotices({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
  const [list, setList] = useState<Ran[]>([]);
  const next = useRef(1);
  useLive('schedule.ran', (e: { name: string; result: string; createdById: string }) => {
    if (!isAdmin && e.createdById !== userId) return;
    if (e.result.includes('Failed') || e.result.startsWith('Skipped')) return; // failures arrive as notifications
    setList((l) => [...l, { key: next.current++, name: e.name, result: e.result, ok: !e.result.includes('Failed') && !e.result.startsWith('Skipped') }].slice(-3));
  });
  useEffect(() => {
    if (!list.length) return;
    const t = setTimeout(() => setList((l) => l.slice(1)), 8000);
    return () => clearTimeout(t);
  }, [list]);
  if (!list.length) return null;
  return (
    <div className="toasts toasts-left" aria-live="polite">
      {list.map((n) => (
        <div key={n.key} className={`toast ${n.ok ? 'ok' : 'bad'}`} role="status">
          <span className={`live-dot ${n.ok ? '' : 'off'}`} />
          <div className="toast-body"><b>⏱ {n.name}</b><span>{n.result}</span></div>
          <button className="icon-btn" aria-label="Close" onClick={() => setList((l) => l.filter((x) => x.key !== n.key))}>×</button>
        </div>
      ))}
    </div>
  );
}
