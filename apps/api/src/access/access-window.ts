/**
 * Time-limited access for a member or guest: an end ("until Sunday 17:00") and/or hours on some days
 * ("9:00 to 17:00, Monday to Saturday"; "22:00 to 06:00" crosses midnight). Pure functions, so the rules
 * are easy to test; AuthService uses them where it decides someone's rights in a home.
 */
import { localDate, parseHhMm, zoneOffsetMinutes, zonedToUtc } from '../automation/time';

export interface AccessLimits {
  accessUntil: Date | null;
  /** "09:00" in the home's time zone (both or neither) */
  accessFrom: string | null;
  accessTo: string | null;
  /** 0 = Sunday … 6 = Saturday; empty = every day */
  accessDays: number[];
}

export type AccessReason = 'expired' | 'hours';

export type AccessCheck =
  | { ok: true; limited: boolean; endsAt: Date | null }
  | { ok: false; reason: AccessReason };

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** The week as people here say it: Monday first. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

export const NO_LIMITS: AccessLimits = { accessUntil: null, accessFrom: null, accessTo: null, accessDays: [] };

export function hasLimits(l: AccessLimits): boolean {
  return !!l.accessUntil || !!(l.accessFrom && l.accessTo) || (l.accessDays?.length ?? 0) > 0;
}

/** Minute of the day and weekday in the home's time zone. */
function localClock(timeZone: string, at: Date) {
  const local = new Date(at.getTime() + zoneOffsetMinutes(timeZone, at) * 60000);
  return { minute: local.getUTCHours() * 60 + local.getUTCMinutes(), weekday: local.getUTCDay() };
}

function window(l: AccessLimits) {
  const from = l.accessFrom ? parseHhMm(l.accessFrom) : null;
  const to = l.accessTo ? parseHhMm(l.accessTo) : null;
  if (!from || !to) return null;
  const a = from.hh * 60 + from.mm;
  const b = to.hh * 60 + to.mm;
  return a === b ? null : { a, b, to }; // "9:00 to 9:00" is the whole day
}

/** Within the allowed hours and days? An overnight window belongs to the day it starts on. */
export function insideHours(l: AccessLimits, timeZone: string, at: Date): boolean {
  const days = l.accessDays ?? [];
  const dayOk = (d: number) => !days.length || days.includes(d);
  const { minute, weekday } = localClock(timeZone, at);
  const w = window(l);
  if (!w) return dayOk(weekday);
  if (w.a < w.b) return dayOk(weekday) && minute >= w.a && minute < w.b;
  // "22:00 to 06:00": Monday's night goes on into Tuesday morning
  return (minute >= w.a && dayOk(weekday)) || (minute < w.b && dayOk((weekday + 6) % 7));
}

function addDays(d: { y: number; m: number; d: number }, n: number) {
  const t = new Date(Date.UTC(d.y, d.m - 1, d.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), weekday: t.getUTCDay() };
}

/**
 * When the stretch of access someone is in now ends (null: it doesn't). Phone passes for switching over
 * the Wi‑Fi stop working then, so a pass taken at 16:00 doesn't work at 18:00.
 */
export function accessEndsAt(l: AccessLimits, timeZone: string, now: Date): Date | null {
  let end: Date | null = null;
  const w = window(l);
  const today = localDate(timeZone, now);
  if (w) {
    const { minute } = localClock(timeZone, now);
    const day = w.a > w.b && minute >= w.a ? addDays(today, 1) : today;
    end = zonedToUtc(timeZone, day.y, day.m, day.d, w.to.hh, w.to.mm);
  } else if (l.accessDays?.length) {
    // whole days: until midnight before the first day that isn't allowed
    for (let i = 1; i <= 7; i++) {
      const day = addDays(today, i);
      if (!l.accessDays.includes(day.weekday)) {
        end = zonedToUtc(timeZone, day.y, day.m, day.d, 0, 0);
        break;
      }
    }
  }
  if (l.accessUntil && (!end || l.accessUntil < end)) end = l.accessUntil;
  return end;
}

/** The one answer the API needs: may this person use the home right now, and until when. */
export function checkAccess(l: AccessLimits, timeZone: string, now = new Date()): AccessCheck {
  if (!hasLimits(l)) return { ok: true, limited: false, endsAt: null };
  if (l.accessUntil && now.getTime() >= l.accessUntil.getTime()) return { ok: false, reason: 'expired' };
  if (!insideHours(l, timeZone, now)) return { ok: false, reason: 'hours' };
  return { ok: true, limited: true, endsAt: accessEndsAt(l, timeZone, now) };
}

// ---------------------------------------------------------------- in words
/** "09:00" -> "9:00" */
export const clockText = (hhmm: string) => {
  const t = parseHhMm(hhmm);
  return t ? `${t.hh}:${String(t.mm).padStart(2, '0')}` : hhmm;
};

/** [1..6] -> "Monday to Saturday"; [6, 0] -> "Saturday and Sunday"; [1, 3, 5] -> "Monday, Wednesday and Friday". */
export function daysText(days: number[], short = false): string {
  const names = short ? SHORT_DAYS : DAY_NAMES;
  const picked = WEEK.filter((d) => days.includes(d));
  if (!picked.length || picked.length === 7) return short ? 'every day' : 'every day';
  const at = picked.map((d) => WEEK.indexOf(d));
  const together = at.every((x, i) => i === 0 || x === at[i - 1]! + 1);
  if (together && picked.length >= 3) return `${names[picked[0]!]}${short ? '–' : ' to '}${names[picked[picked.length - 1]!]}`;
  const words = picked.map((d) => names[d]!);
  return words.length === 1 ? words[0]! : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** "Sun 20 Oct, 17:00" in the home's time zone. */
export function whenText(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(at);
}

/** "9:00 to 17:00, Monday to Saturday" (or "" when there are no hours or days). */
export function hoursText(l: AccessLimits, short = false): string {
  const w = window(l);
  const days = l.accessDays?.length && l.accessDays.length < 7 ? daysText(l.accessDays, short) : '';
  const hours = w ? `${clockText(l.accessFrom!)}${short ? '–' : ' to '}${clockText(l.accessTo!)}` : '';
  return [hours, days].filter(Boolean).join(short ? ' ' : ', ');
}

/** One line for the people list: "9:00–17:00 Mon–Sat · until Sun 20 Oct, 17:00". */
export function limitsSummary(l: AccessLimits, timeZone: string): string | null {
  if (!hasLimits(l)) return null;
  const parts = [hoursText(l, true), l.accessUntil ? `until ${whenText(l.accessUntil, timeZone)}` : ''].filter(Boolean);
  return parts.join(' · ');
}

/** What the person is told when they open the app outside their access. */
export function blockedMessage(homeName: string, l: AccessLimits, reason: AccessReason, timeZone: string): string {
  if (reason === 'expired') {
    return `Your access to ${homeName} ended on ${whenText(l.accessUntil!, timeZone)}. Ask the home’s owner if you need it again.`;
  }
  const w = window(l);
  const days = l.accessDays?.length && l.accessDays.length < 7 ? daysText(l.accessDays) : '';
  if (w) return `Your access to ${homeName} is from ${clockText(l.accessFrom!)} to ${clockText(l.accessTo!)}${days ? `, ${days}` : ''}.`;
  return `Your access to ${homeName} is on ${days || 'some days only'}.`;
}

// ---------------------------------------------------------------- from forms and the assistant
export interface LimitsInput {
  /** an ISO time, or "2026-10-20T17:00" meaning that time in the home; null clears it */
  accessUntil?: string | null;
  accessFrom?: string | null;
  accessTo?: string | null;
  accessDays?: number[];
}

/**
 * Checks and completes what someone typed. A time without a zone is the home's local time, so the owner
 * gets what they mean even when their phone is set to another zone. Throws a plain message on bad input.
 */
export function readLimits(input: LimitsInput, timeZone: string, current: AccessLimits = NO_LIMITS, now = new Date()): AccessLimits {
  // only the four limits (current may be a whole database row)
  const out: AccessLimits = {
    accessUntil: current.accessUntil, accessFrom: current.accessFrom, accessTo: current.accessTo, accessDays: [...(current.accessDays ?? [])],
  };
  if (input.accessUntil !== undefined) {
    if (input.accessUntil === null || input.accessUntil === '') out.accessUntil = null;
    else {
      const naive = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::\d{2})?$/.exec(input.accessUntil.trim());
      const at = naive
        ? zonedToUtc(timeZone, Number(naive[1]), Number(naive[2]), Number(naive[3]), Number(naive[4]), Number(naive[5]))
        : new Date(input.accessUntil);
      if (Number.isNaN(at.getTime())) throw new Error('Say when their access ends, like 2026-10-20T17:00.');
      if (at.getTime() <= now.getTime()) throw new Error('That end time has already passed. Pick a later one.');
      if (at.getTime() > now.getTime() + 2 * 366 * 86400000) throw new Error('Access can end at most two years ahead.');
      out.accessUntil = at;
    }
  }
  if (input.accessFrom !== undefined || input.accessTo !== undefined) {
    const from = input.accessFrom ?? null;
    const to = input.accessTo ?? null;
    if (!from && !to) {
      out.accessFrom = null;
      out.accessTo = null;
    } else {
      const a = from ? parseHhMm(from) : null;
      const b = to ? parseHhMm(to) : null;
      if (!a || !b) throw new Error('Hours need a start and an end, like 9:00 to 17:00.');
      out.accessFrom = `${String(a.hh).padStart(2, '0')}:${String(a.mm).padStart(2, '0')}`;
      out.accessTo = `${String(b.hh).padStart(2, '0')}:${String(b.mm).padStart(2, '0')}`;
    }
  }
  if (input.accessDays !== undefined) {
    const days = [...new Set(input.accessDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    out.accessDays = days.length === 7 ? [] : days;
  }
  return out;
}
