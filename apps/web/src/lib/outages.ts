/** Showing outages: durations, times in the home's time zone, one entry per cut across boards. */
import type { Outage, OutageKind } from './types';

export const OUTAGE_LOOK: Record<OutageKind, { icon: string; tone: 'bad' | 'warn' | 'info' | 'mute'; short: string }> = {
  POWER: { icon: 'zap', tone: 'bad', short: 'Power cut' },
  NETWORK: { icon: 'wifi-off', tone: 'warn', short: 'Wi‑Fi or internet down' },
  RESTART: { icon: 'rotate', tone: 'mute', short: 'Board restarted' },
  RESET: { icon: 'rotate', tone: 'mute', short: 'Board reset' },
  CRASH: { icon: 'alert-triangle', tone: 'warn', short: 'Board restarted after a fault' },
  UNKNOWN: { icon: 'help', tone: 'mute', short: 'Board was offline' },
};

export function dur(seconds: number) {
  const m = Math.round(seconds / 60);
  if (m < 1) return `${Math.max(1, Math.round(seconds))} s`;
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

export const clock = (iso: string, tz: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz }).replace(' ', ' ');

export function dayLabel(iso: string, tz: string, now = new Date()) {
  const key = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: tz });
  const d = new Date(iso);
  if (key(d) === key(now)) return 'Today';
  if (key(d) === key(new Date(now.getTime() - 86_400_000))) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz });
}

export interface OutageItem { kind: OutageKind; startedAt: string; endedAt: string; seconds: number; boards: string[]; reset: string | null }

/** A cut seen by several boards of the home is one entry (same kind, overlapping times). */
export function mergeOutages(list: Outage[]): OutageItem[] {
  const sorted = [...list].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const out: OutageItem[] = [];
  for (const o of sorted) {
    const last = [...out].reverse().find((x) => x.kind === o.kind);
    if (last && new Date(o.startedAt).getTime() <= new Date(last.endedAt).getTime() + 120_000) {
      if (o.endedAt > last.endedAt) last.endedAt = o.endedAt;
      last.seconds = Math.round((new Date(last.endedAt).getTime() - new Date(last.startedAt).getTime()) / 1000);
      if (!last.boards.includes(o.board)) last.boards.push(o.board);
    } else out.push({ kind: o.kind, startedAt: o.startedAt, endedAt: o.endedAt, seconds: o.seconds, boards: [o.board], reset: o.reset });
  }
  return out.reverse();
}
