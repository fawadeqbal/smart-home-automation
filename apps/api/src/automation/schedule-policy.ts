/**
 * What the scheduler does when a run is late (the server was down) or a board didn't answer. Pure
 * functions, so the rules can be tested without a database.
 */
import { localDate, zoneOffsetMinutes } from './time';

export type IfMissed = 'auto' | 'run' | 'skip';
export const IF_MISSED: IfMissed[] = ['auto', 'run', 'skip'];

/** How the last run went, for the apps: a green, amber or red line under the schedule. */
export type RunStatus = 'ok' | 'retrying' | 'failed' | 'skipped';

/** A run this many minutes late is still "on time" (the scheduler ticks every few seconds). */
const LATE_NOTE_MIN = 2;

/**
 * Should a run that is `lateMs` late still happen? On time (up to the cut-off): yes. Later than that,
 * after the server was down:
 * - "run": always, however late.
 * - "skip": never.
 * - "auto" (the default): only a one-off timer whose every action switches something OFF. A missed
 *   "geyser off" is still worth doing at 11:00; a missed "lights on at 7:00" is not, and neither is a
 *   daily or sunset schedule (it runs again at its next time anyway).
 */
export function missedDecision(
  s: { kind: 'ONCE' | 'DAILY' | 'SUN'; ifMissed: string },
  actions: { on: boolean }[],
  lateMs: number,
  cutoffMin: number,
): 'run' | 'skip' {
  if (lateMs <= cutoffMin * 60_000) return 'run';
  if (s.ifMissed === 'run') return 'run';
  if (s.ifMissed === 'skip') return 'skip';
  const allOff = actions.length > 0 && actions.every((a) => a.on === false);
  return s.kind === 'ONCE' && allOff ? 'run' : 'skip';
}

/** Minutes until the next try after `attempt` failed tries (1 = the first run failed), or null: no more tries. */
export function retryDelayMin(attempt: number, delays: number[]): number | null {
  return attempt >= 1 && attempt <= delays.length ? delays[attempt - 1]! : null;
}

/** "07:00", or "Sat 18 Oct, 07:00" when it isn't today (both in the home's time zone). */
export function clockText(at: Date, timeZone: string, now = new Date()): string {
  const local = new Date(at.getTime() + zoneOffsetMinutes(timeZone, at) * 60000);
  const hhmm = `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
  const a = localDate(timeZone, at);
  const b = localDate(timeZone, now);
  if (a.y === b.y && a.m === b.m && a.d === b.d) return hhmm;
  const day = local.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${day}, ${hhmm}`;
}

/** "Skipped: the server was down at 07:00." */
export function skippedText(dueAt: Date, timeZone: string, now = new Date()): string {
  return `Skipped: the server was down at ${clockText(dueAt, timeZone, now)}.`;
}

/** "Ran 12 min late (the server was down at 07:00). " — empty when it was (nearly) on time. */
export function lateNote(dueAt: Date, timeZone: string, now = new Date()): string {
  const min = Math.round((now.getTime() - dueAt.getTime()) / 60000);
  if (min < LATE_NOTE_MIN) return '';
  const late = min < 120 ? `${min} min` : min < 2880 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} days`;
  return `Ran ${late} late (the server was down at ${clockText(dueAt, timeZone, now)}). `;
}

/** One line for a run: "Done: Lamp on. Failed: Fan: its board is offline." */
export function runSummary(done: string[], failed: string[]): string {
  return [done.length ? `Done: ${done.join(', ')}.` : '', failed.length ? `Failed: ${failed.join('; ')}` : ''].filter(Boolean).join(' ') || 'Nothing to do.';
}

/** "Lamp: Lamp is offline: …" reads badly: drop the name when the message already starts with it. */
export function failureLine(label: string, message: string): string {
  return message.toLowerCase().startsWith(label.toLowerCase()) ? message : `${label}: ${message}`;
}
