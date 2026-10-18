/**
 * UPS mode: a mains-sense module (a contact sensor of kind "mains", active while the grid supply is on)
 * tells the home when it is running on UPS or solar. Pure decisions here; PowerService acts on them.
 */
import { guessWatts } from '../energy/energy.service';

/** A heavy load: worth switching off on UPS (an AC, an iron, a geyser, a motor, a kettle). */
export const HEAVY_WATTS = 700;

/** Shorter grid cuts (a flicker) are not kept as power cuts or announced. */
export const GRID_MIN_SECONDS = 20;

export type GridStep =
  | { type: 'none' }
  /** the grid just went: on UPS or solar from `since` */
  | { type: 'off'; since: Date }
  /** the grid is back after `seconds` (`blip`: too short to keep or announce) */
  | { type: 'back'; since: Date; seconds: number; blip: boolean };

/**
 * What a new reading of the mains sensor means. `before` is the sensor's previous state (null: its
 * first report ever, which only sets the baseline: we don't know when the grid went), `offSince`
 * when the home went on UPS (null: on the grid).
 */
export function gridStep(before: { active?: unknown } | null, now: { active?: unknown }, offSince: Date | null, at: Date): GridStep {
  if (typeof now.active !== 'boolean') return { type: 'none' };
  if (now.active === false) {
    if (offSince || !before || before.active !== true) return { type: 'none' };
    return { type: 'off', since: at };
  }
  // back: also when the sensor's board restarted on the way (its first report after the cut)
  if (!offSince) return { type: 'none' };
  const seconds = Math.max(0, Math.round((at.getTime() - offSince.getTime()) / 1000));
  return { type: 'back', since: offSince, seconds, blip: seconds < GRID_MIN_SECONDS };
}

/** Which heavy loads to switch off now: the chosen ones that are on and reachable. */
export function loadsToCut(chosen: string[], devices: { id: string; on: boolean; online: boolean }[]) {
  return devices.filter((d) => chosen.includes(d.id) && d.on && d.online).map((d) => d.id);
}

/** Which to switch back on when the grid returns: only those we switched off, and only if asked to. */
export function loadsToRestore(restore: boolean, switchedOff: string[], devices: { id: string; on: boolean; online: boolean }[]) {
  if (!restore) return [];
  return devices.filter((d) => switchedOff.includes(d.id) && !d.on && d.online).map((d) => d.id);
}

/** Is this switch probably a heavy load (from its set watts, or its name)? */
export function isHeavy(d: { name: string; aliases?: string[]; watts?: number | null }) {
  const w = d.watts ?? guessWatts(d.name, d.aliases ?? []);
  return (w ?? 0) >= HEAVY_WATTS;
}

/** A mains-sense sensor: a contact sensor whose kind is "mains". */
export const isMainsSensor = (d: { type: string; settings: unknown }) =>
  d.type === 'contact' && (d.settings as { kind?: string } | null)?.kind === 'mains';
