/** Time-zone maths for daily schedules, without a date library: HH:MM in the home's zone -> UTC instant. */

/** Minutes the zone is ahead of UTC at `at` (Asia/Karachi -> 300). */
export function zoneOffsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** The local calendar date (y, m 1-12, d, weekday 0=Sun) in `timeZone` at `at`. */
export function localDate(timeZone: string, at: Date) {
  const shifted = new Date(at.getTime() + zoneOffsetMinutes(timeZone, at) * 60000);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate(), weekday: shifted.getUTCDay() };
}

/** UTC instant of local y-m-d hh:mm in `timeZone`. */
export function zonedToUtc(timeZone: string, y: number, m: number, d: number, hh: number, mm: number): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let at = new Date(guess - zoneOffsetMinutes(timeZone, new Date(guess)) * 60000);
  at = new Date(guess - zoneOffsetMinutes(timeZone, at) * 60000); // second pass handles DST edges
  return at;
}

export function parseHhMm(time: string): { hh: number; mm: number } | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
  return m ? { hh: Number(m[1]), mm: Number(m[2]) } : null;
}

/** Next time a daily schedule fires strictly after `after` (days: 0=Sun..6=Sat, empty = every day). */
export function nextDaily(time: string, days: number[], timeZone: string, after: Date): Date | null {
  const t = parseHhMm(time);
  if (!t) return null;
  for (let i = 0; i <= 8; i++) {
    const day = localDate(timeZone, new Date(after.getTime() + i * 86400000));
    if (days.length && !days.includes(day.weekday)) continue;
    const at = zonedToUtc(timeZone, day.y, day.m, day.d, t.hh, t.mm);
    if (at.getTime() > after.getTime()) return at;
  }
  return null;
}
