/**
 * The electricity bill from meter readings: the billing month (from the day the meter reader comes),
 * units used so far, a projection to the end of the month at the current pace, and what that costs
 * with a flat rate or slabs. Pure functions, no database.
 */
import { localDate, zonedToUtc } from '../automation/time';

const DAY = 86_400_000;
/** a reading this close to the start of the billing month is the month's opening reading */
const NEAR_START_MS = DAY;

export interface Reading { id?: string; kwh: number; readAt: Date; newMeter?: boolean }
export interface Slab { upTo: number | null; rate: number }
export interface Cycle { start: Date; end: Date }

/** The billing day in a month: past the month's end (the 31st in February) it is the month's last day. */
function dayIn(y: number, m: number, billingDay: number) {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Math.min(Math.max(1, billingDay), last);
}

/** The billing month `now` falls in: from the billing day (local midnight) to the next one. */
export function cycleFor(billingDay: number, timeZone: string, now: Date): Cycle {
  const t = localDate(timeZone, now);
  let y = t.y;
  let m = t.m;
  if (t.d < dayIn(y, m, billingDay)) {
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  const start = zonedToUtc(timeZone, y, m, dayIn(y, m, billingDay), 0, 0);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const end = zonedToUtc(timeZone, ny, nm, dayIn(ny, nm, billingDay), 0, 0);
  return { start, end };
}

/** The cycle before this one. */
export function previousCycle(billingDay: number, timeZone: string, cycle: Cycle): Cycle {
  return cycleFor(billingDay, timeZone, new Date(cycle.start.getTime() - DAY / 2));
}

/**
 * Is this new reading possible next to the others? A meter only counts up: a lower number than an
 * earlier reading (or higher than a later one) is a typing mistake — unless the meter was replaced.
 * Returns a message to show, or null.
 */
export function checkReading(readings: Reading[], next: Reading, ignoreId?: string): string | null {
  if (!(next.kwh >= 0) || next.kwh > 10_000_000) return 'Type the number on the meter (kWh), e.g. 12345.';
  if (next.newMeter) return null;
  const others = readings.filter((r) => r.id !== ignoreId).sort((a, b) => a.readAt.getTime() - b.readAt.getTime());
  // only readings from the same meter count: those since the last "new meter" before or at this date
  const lastNew = [...others].reverse().find((r) => r.newMeter && r.readAt <= next.readAt);
  const sameMeter = others.filter((r) => !lastNew || r.readAt >= lastNew.readAt);
  const before = [...sameMeter].reverse().find((r) => r.readAt <= next.readAt);
  const nextNew = others.find((r) => r.newMeter && r.readAt > next.readAt);
  const after = sameMeter.find((r) => r.readAt > next.readAt && (!nextNew || r.readAt < nextNew.readAt));
  const fmt = (r: Reading) => `${Math.round(r.kwh * 10) / 10} on ${r.readAt.toISOString().slice(0, 10)}`;
  if (before && next.kwh < before.kwh) {
    return `That's less than the earlier reading (${fmt(before)}). A meter only counts up: check the number, or tick "new meter" if the meter was replaced.`;
  }
  if (after && next.kwh > after.kwh) return `That's more than the later reading (${fmt(after)}). Check the number and the date.`;
  return null;
}

/** The meter's count at a moment, from readings around it (straight line between them); null when it can't be known. */
export function meterAt(readings: Reading[], at: Date): { kwh: number; exact: boolean } | null {
  const sorted = [...readings].sort((a, b) => a.readAt.getTime() - b.readAt.getTime());
  const t = at.getTime();
  const exact = sorted.find((r) => Math.abs(r.readAt.getTime() - t) < 60_000);
  if (exact) return { kwh: exact.kwh, exact: true };
  const before = [...sorted].reverse().find((r) => r.readAt.getTime() < t);
  const after = sorted.find((r) => r.readAt.getTime() > t);
  // no straight line across a meter change
  if (before && after && !after.newMeter && after.kwh >= before.kwh) {
    const f = (t - before.readAt.getTime()) / (after.readAt.getTime() - before.readAt.getTime());
    return { kwh: before.kwh + f * (after.kwh - before.kwh), exact: false };
  }
  return null;
}

/** Units used between two readings, counting a replaced meter from its first number. */
export function unitsBetween(readings: Reading[], from: Date, to: Date): number {
  const inside = readings.filter((r) => r.readAt > from && r.readAt <= to).sort((a, b) => a.readAt.getTime() - b.readAt.getTime());
  const startAt = meterAt(readings, from);
  let total = 0;
  let last = startAt?.kwh ?? null;
  for (const r of inside) {
    if (r.newMeter) { last = r.kwh; continue; }
    if (last !== null && r.kwh >= last) total += r.kwh - last;
    last = r.kwh;
  }
  return total;
}

export interface Usage {
  /** units from the start of the cycle to `asOf` */
  units: number;
  /** the time those units go up to (the latest reading, or now when estimated) */
  asOf: Date;
  /** how the number was made */
  source: 'readings' | 'readings+estimate' | 'estimate' | 'none';
  /** units in it that are estimates (from the switches) */
  estimated: number;
  startReading: { kwh: number; at: Date; exact: boolean } | null;
  latest: Reading | null;
}

/**
 * Units used this billing month so far. Best: the reading at (or the straight line to) the start of
 * the cycle up to the latest reading. When the start is missing, the earliest reading this month is
 * the start and the days before it are filled in with the switches' estimates; with no reading at
 * all this month, the switches' estimates are all there is.
 * `estimateBetween(from, to)` gives the switches' estimated units in that time.
 */
export function cycleUsage(readings: Reading[], cycle: Cycle, now: Date, estimateBetween: (from: Date, to: Date) => number): Usage {
  const sorted = [...readings].sort((a, b) => a.readAt.getTime() - b.readAt.getTime());
  const inCycle = sorted.filter((r) => r.readAt >= cycle.start && r.readAt <= now);
  const latest = inCycle[inCycle.length - 1] ?? null;
  // the reader's own visit, on the billing day (or the day before): the bill counts from that reading
  const near = sorted.filter((r) => Math.abs(r.readAt.getTime() - cycle.start.getTime()) <= NEAR_START_MS && r !== latest)
    .sort((a, b) => Math.abs(a.readAt.getTime() - cycle.start.getTime()) - Math.abs(b.readAt.getTime() - cycle.start.getTime()))[0];
  if (near && latest && latest.readAt > near.readAt) {
    return {
      units: round1(unitsBetween(sorted, near.readAt, latest.readAt)), asOf: latest.readAt, source: 'readings', estimated: 0,
      startReading: { kwh: near.kwh, at: near.readAt, exact: true }, latest,
    };
  }
  const atStart = meterAt(sorted, cycle.start);
  if (atStart && latest && latest.readAt > cycle.start) {
    return {
      units: round1(unitsBetween(sorted, cycle.start, latest.readAt)), asOf: latest.readAt, source: 'readings', estimated: 0,
      startReading: { kwh: atStart.kwh, at: cycle.start, exact: atStart.exact }, latest,
    };
  }
  if (inCycle.length >= 2) {
    const first = inCycle[0]!;
    const est = estimateBetween(cycle.start, first.readAt);
    return {
      units: round1(unitsBetween(sorted, first.readAt, latest!.readAt) + est), asOf: latest!.readAt, source: 'readings+estimate', estimated: round1(est),
      startReading: { kwh: first.kwh, at: first.readAt, exact: true }, latest,
    };
  }
  const est = estimateBetween(cycle.start, now);
  return { units: round1(est), asOf: now, source: est > 0 ? 'estimate' : 'none', estimated: round1(est), startReading: null, latest };
}

/** Units at the end of the cycle at the pace so far (needs a day of data; less is too noisy to say). */
export function project(units: number, cycle: Cycle, asOf: Date): number | null {
  const elapsed = asOf.getTime() - cycle.start.getTime();
  if (elapsed < DAY) return null;
  const total = cycle.end.getTime() - cycle.start.getTime();
  return round1((units / elapsed) * total);
}

/** Checks a slab list: ascending limits, the last one open-ended (filled in when missing). */
export function cleanSlabs(input: Slab[]): Slab[] | string {
  if (!input.length) return [];
  if (input.length > 10) return 'At most 10 slabs.';
  const out: Slab[] = [];
  let prev = 0;
  for (const [i, s] of input.entries()) {
    if (!(s.rate > 0 && s.rate < 1000)) return 'Each slab needs a rate in rupees per unit, e.g. 22.5.';
    const last = i === input.length - 1;
    if (s.upTo === null || s.upTo === undefined) {
      if (!last) return 'Only the last slab can be "and above".';
      out.push({ upTo: null, rate: s.rate });
      continue;
    }
    if (!(s.upTo > prev)) return 'Each slab must go higher than the one before (e.g. up to 100, then up to 200).';
    out.push({ upTo: Math.round(s.upTo), rate: s.rate });
    prev = s.upTo;
  }
  if (out[out.length - 1]!.upTo !== null) out.push({ upTo: null, rate: out[out.length - 1]!.rate });
  return out;
}

/** What `units` cost: each unit at its own slab's rate, or all at the flat rate. Rupees, rounded. */
export function billFor(units: number, flat: number, slabs: Slab[]): { cost: number; lines: { units: number; rate: number; cost: number }[] } {
  if (!slabs.length) return { cost: Math.round(units * flat), lines: [{ units: round1(units), rate: flat, cost: Math.round(units * flat) }] };
  const lines: { units: number; rate: number; cost: number }[] = [];
  let left = units;
  let prev = 0;
  for (const s of slabs) {
    if (left <= 0) break;
    const room = s.upTo === null ? left : Math.max(0, s.upTo - prev);
    const here = Math.min(left, room);
    if (here > 0) lines.push({ units: round1(here), rate: s.rate, cost: Math.round(here * s.rate) });
    left -= here;
    if (s.upTo !== null) prev = s.upTo;
  }
  return { cost: lines.reduce((a, l) => a + l.cost, 0), lines };
}

/**
 * Which warnings about the protected limit are due now: "near" once units used pass 80% of the limit,
 * "pace" once the projection goes over it (each at most once a month; `sent` lists those already sent).
 */
export function warningsDue(limit: number | null, units: number, projected: number | null, sent: string[]): ('near' | 'pace' | 'over')[] {
  if (!limit) return [];
  const due: ('near' | 'pace' | 'over')[] = [];
  if (units > limit) {
    if (!sent.includes('over')) due.push('over');
    return due;
  }
  if (projected !== null && projected > limit && !sent.includes('pace')) due.push('pace');
  else if (units >= 0.8 * limit && !sent.includes('near') && !sent.includes('pace')) due.push('near');
  return due;
}

export const round1 = (n: number) => Math.round(n * 10) / 10;
