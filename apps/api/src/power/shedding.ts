/**
 * Load-shedding: the cuts that come at about the same time every day, found from a home's power cuts
 * (or, for a new home, its area's), and the next one to expect. Pure functions, no database.
 *
 * The method, simple enough to explain to a customer:
 *   1. Split each of the last 14 days (in the home's time zone) into 30-minute slots.
 *   2. A slot "had a cut" on a day when a power cut covered at least 10 minutes of it.
 *   3. A slot is part of the pattern when it had a cut on at least 5 of those 14 days.
 *   4. Neighbouring slots join into one window ("about 14:00–15:00"), across midnight too.
 */
import { localDate, parseHhMm, zonedToUtc } from '../automation/time';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

export interface Cut { start: number; end: number }
/** A daily window, "HH:MM" to "HH:MM" in the home's time zone (`to` before `from`: past midnight). */
export interface CutWindow { from: string; to: string; days?: number[]; seen?: number; of?: number }

export interface PatternOptions {
  /** how many days back to look */
  days?: number;
  /** slot length in minutes (divides 60) */
  slotMin?: number;
  /** a slot counts on a day when a cut covered at least this many minutes of it */
  overlapMin?: number;
  /** days out of `days` a slot needs to be part of the pattern */
  minDays?: number;
  /** how many of those days we actually know about (a home installed 5 days ago: 5) */
  observedDays?: number;
}

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Days with a cut needed for a slot to count, scaled down when we've seen fewer days (never below 2). */
export function daysNeeded(observed: number, days = 14, minDays = 5) {
  return Math.max(2, Math.ceil((observed * minDays) / days));
}

/** The recurring cut windows in these cuts (ms since epoch), in the home's time zone. */
export function findPattern(cuts: Cut[], timeZone: string, now: Date, opts: PatternOptions = {}): { windows: CutWindow[]; observedDays: number; needed: number } {
  const days = opts.days ?? 14;
  const slotMin = opts.slotMin ?? 30;
  const overlap = (opts.overlapMin ?? 10) * MIN;
  const observed = Math.max(1, Math.min(days, opts.observedDays ?? days));
  const needed = daysNeeded(observed, days, opts.minDays ?? 5);
  const slots = (24 * 60) / slotMin;

  // local midnight of each of the last `days` days, today last (slots are counted from midnight; a
  // daylight-saving change inside a day would shift that day's slots by an hour, which "about" covers)
  const today = localDate(timeZone, now);
  const starts: number[] = [];
  for (let i = days - 1; i >= 0; i--) starts.push(zonedToUtc(timeZone, today.y, today.m, today.d - i, 0, 0).getTime());

  // hit[slot] = the days (index into `starts`) on which a cut covered that slot
  const hit: Set<number>[] = Array.from({ length: slots }, () => new Set<number>());
  for (const c of cuts) {
    for (let d = 0; d < starts.length; d++) {
      const dayStart = starts[d]!;
      if (c.end <= dayStart || c.start >= dayStart + DAY) continue;
      for (let s = 0; s < slots; s++) {
        const a = dayStart + s * slotMin * MIN;
        const b = a + slotMin * MIN;
        if (Math.min(b, c.end) - Math.max(a, c.start) >= overlap) hit[s]!.add(d);
      }
    }
  }
  const recurring = hit.map((set) => set.size >= needed);
  if (!recurring.some(Boolean)) return { windows: [], observedDays: observed, needed };
  if (recurring.every(Boolean)) {
    return { windows: [{ from: '00:00', to: '00:00', seen: new Set(hit.flatMap((s) => [...s])).size, of: observed }], observedDays: observed, needed };
  }

  // runs of recurring slots; start from a slot that isn't recurring so a run over midnight stays whole
  const first = recurring.findIndex((r) => !r);
  const windows: CutWindow[] = [];
  let run: number[] = [];
  const close = () => {
    if (!run.length) return;
    const startSlot = run[0]!;
    // a slot after midnight belongs to the evening before (one cut, one day)
    const seen = new Set<number>();
    for (const s of run) for (const d of hit[s]!) seen.add(s < startSlot ? d - 1 : d);
    windows.push({ from: hhmm(startSlot * slotMin), to: hhmm(((run[run.length - 1]! + 1) * slotMin) % (24 * 60)), seen: seen.size, of: observed });
    run = [];
  };
  for (let k = 1; k <= slots; k++) {
    const s = (first + k) % slots;
    if (recurring[s]) run.push(s);
    else close();
  }
  close();
  windows.sort((a, b) => a.from.localeCompare(b.from));
  return { windows, observedDays: observed, needed };
}

/** Minutes from midnight, and the window's length (a window ending at or before its start runs past midnight). */
function span(w: CutWindow) {
  const f = parseHhMm(w.from)!;
  const t = parseHhMm(w.to)!;
  const from = f.hh * 60 + f.mm;
  let len = t.hh * 60 + t.mm - from;
  if (len <= 0) len += 24 * 60;
  return { from: f, len };
}

export interface NextCut { at: Date; until: Date; now: boolean }

/** The next expected cut (or the one going on now) from daily windows, some only on certain weekdays. */
export function nextCut(windows: CutWindow[], timeZone: string, now: Date): NextCut | null {
  let best: NextCut | null = null;
  for (let i = -1; i <= 8; i++) {
    const day = localDate(timeZone, new Date(now.getTime() + i * DAY));
    for (const w of windows) {
      if (!parseHhMm(w.from) || !parseHhMm(w.to)) continue;
      if (w.days?.length && !w.days.includes(day.weekday)) continue;
      const { from, len } = span(w);
      const at = zonedToUtc(timeZone, day.y, day.m, day.d, from.hh, from.mm);
      const until = new Date(at.getTime() + len * MIN);
      if (until.getTime() <= now.getTime()) continue;
      const cand = { at, until, now: at.getTime() <= now.getTime() };
      if (!best || (cand.now && !best.now) || (cand.now === best.now && cand.at < best.at)) best = cand;
    }
  }
  return best;
}

/** "2:00 pm" in the home's time zone. */
export function clockText(at: Date, timeZone: string) {
  return at.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone }).replace(/\s/g, ' ').toLowerCase();
}

/** "today around 2:00 pm", "tomorrow around 8:00 am", "Mon around 2:00 pm", "now, until about 3:00 pm". */
export function cutText(next: NextCut, timeZone: string, now: Date) {
  if (next.now) return `now, until about ${clockText(next.until, timeZone)}`;
  const d = localDate(timeZone, next.at);
  const t = localDate(timeZone, now);
  const tm = localDate(timeZone, new Date(now.getTime() + DAY));
  const same = (a: typeof d, b: typeof d) => a.y === b.y && a.m === b.m && a.d === b.d;
  const day = same(d, t) ? 'today' : same(d, tm) ? 'tomorrow'
    : next.at.toLocaleDateString('en-GB', { weekday: 'short', timeZone });
  return `${day} around ${clockText(next.at, timeZone)}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "14:00–15:00 every day", "20:00–21:00 on Mon, Wed". */
export function windowText(w: CutWindow) {
  const days = w.days?.length ? `on ${[...w.days].sort().map((d) => WEEKDAYS[d]).join(', ')}` : 'every day';
  return `${w.from}–${w.to} ${days}${w.seen !== undefined ? ` (seen on ${w.seen} of the last ${w.of} days)` : ''}`;
}

/** Checks a typed schedule: a few windows, HH:MM, weekdays 0–6. Returns the cleaned list or a message. */
export function cleanSchedule(input: { from: string; to: string; days?: number[] }[]): CutWindow[] | string {
  if (input.length > 8) return 'At most 8 cut times.';
  const out: CutWindow[] = [];
  for (const w of input) {
    const f = parseHhMm(w.from ?? '');
    const t = parseHhMm(w.to ?? '');
    if (!f || !t) return 'Give each cut time as a start and an end, like 14:00 to 15:00.';
    const from = hhmm(f.hh * 60 + f.mm);
    const to = hhmm(t.hh * 60 + t.mm);
    if (from === to) return `${from} to ${to}: the start and the end are the same.`;
    const days = [...new Set((w.days ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    out.push({ from, to, ...(days.length && days.length < 7 ? { days } : {}) });
  }
  return out.sort((a, b) => a.from.localeCompare(b.from));
}
