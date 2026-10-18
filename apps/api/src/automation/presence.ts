/**
 * "Who's home" and "the last one out", as pure functions (PresenceService does the database and the
 * switching). Only people who chose "Share when I'm home" count. Their phone says whether it can reach
 * one of the home's boards on the Wi‑Fi; a report older than 3 hours means nothing any more ("unknown").
 */

/** A report this old is no longer believed. */
export const STALE_MS = 3 * 3600_000;
/** Someone we haven't heard from counts as out only after this long (a phone that's off, a flaky Wi‑Fi). */
export const UNKNOWN_GRACE_MS = 20 * 60_000;
/** An "away" report counts after this long (one missed answer from a board isn't leaving). */
export const AWAY_SETTLE_MS = Number(process.env.PRESENCE_SETTLE_MS ?? 2 * 60_000);

export type PresenceStatus = 'home' | 'away' | 'unknown';

export interface PresenceRow {
  atHome: boolean | null;
  reportedAt: Date | null;
  /** since when the reports have said the same thing */
  since: Date | null;
  /** when they started sharing */
  sharedAt: Date;
}

export interface PersonState {
  status: PresenceStatus;
  /** counted as out (away long enough, or unknown for 20 minutes) */
  out: boolean;
  /** since when they've been away or unknown (null while home) */
  outSince: Date | null;
}

export function personState(p: PresenceRow, now = new Date(), settleMs = AWAY_SETTLE_MS): PersonState {
  const fresh = !!p.reportedAt && now.getTime() - p.reportedAt.getTime() < STALE_MS;
  if (fresh && p.atHome) return { status: 'home', out: false, outSince: null };
  if (fresh && p.atHome === false) {
    const since = p.since ?? p.reportedAt!;
    return { status: 'away', out: now.getTime() - since.getTime() >= settleMs, outSince: since };
  }
  // unknown: since the last "home" went stale, since they went away, or since they started sharing
  const since = !p.reportedAt ? p.sharedAt
    : p.atHome ? new Date(p.reportedAt.getTime() + STALE_MS)
      : p.since ?? p.reportedAt;
  return { status: 'unknown', out: now.getTime() - since.getTime() >= UNKNOWN_GRACE_MS, outSince: since };
}

export type PresenceEvent = 'left' | 'arrived';

/**
 * What the home's rule should do now. `wasOut`: everyone was counted out last time ("left" already ran).
 * "left" when everyone sharing is out; "arrived" when someone is home again after that. Nothing when
 * nobody shares (there's no one to count).
 */
export function decide(wasOut: boolean, people: PersonState[]): PresenceEvent | null {
  if (!people.length) return null;
  if (!wasOut && people.every((p) => p.out)) return 'left';
  if (wasOut && people.some((p) => p.status === 'home')) return 'arrived';
  return null;
}

const LIGHT_WORDS = ['light', 'bulb', 'batti', 'lamp', 'tube', 'led', 'spot', 'chandelier', 'jhoomar', 'lantern'];
const FAN_WORDS = ['fan', 'pankha', 'exhaust'];
/** Things that must keep running whatever their name says ("fridge light" is the fridge). */
const KEEP_WORDS = ['fridge', 'refrigerator', 'freezer', 'router', 'modem', 'wifi', 'camera', 'cctv', 'aquarium', 'pump', 'motor'];

/** "Switch off the lights and fans": fans by type, switches by what they're called. */
export function isLightOrFan(d: { type: string; name: string; aliases?: string[] }): boolean {
  if (d.type === 'fan') return true;
  if (d.type !== 'switch') return false;
  const words = ` ${[d.name, ...(d.aliases ?? [])].join(' ').toLowerCase()} `;
  if (KEEP_WORDS.some((w) => words.includes(w))) return false;
  return [...LIGHT_WORDS, ...FAN_WORDS].some((w) => words.includes(w));
}

/** "Ali and Sara are home", "Nobody is home", "Ali is home; Sara: not known". */
export function homeLine(people: { name: string; status: PresenceStatus }[]): string {
  const home = people.filter((p) => p.status === 'home').map((p) => p.name.split(' ')[0]);
  if (!people.length) return 'Nobody shares when they’re home yet.';
  if (!home.length) return 'Nobody is home.';
  const names = home.length === 1 ? home[0] : `${home.slice(0, -1).join(', ')} and ${home[home.length - 1]}`;
  return `${names} ${home.length === 1 ? 'is' : 'are'} home.`;
}
