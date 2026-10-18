/**
 * Replacing a board: its devices and wall buttons move to the new one with the same pin numbers, so the
 * new board must have every one of those pins, usable the same way. Pure functions (unit-tested).
 */
import { BOARDS, checkPin, DEVICE_TYPES, INPUT_TYPES, pinLabel, PinUse } from '@home/contracts';
import { compareVersions } from '../common/version';

export interface SwapDevice { name: string; type: string; pin: number; settings: unknown }
export interface SwapInput { name: string; type: string; pin: number; settings: unknown; targetId: string | null; actions: unknown }

/** One wire on the old board and where it goes on the new one (the same pin number). */
export interface PlanRow {
  what: string;
  /** "Fan · relay 2", "Bedside button" */
  name: string;
  gpio: number;
  use: PinUse;
  /** the label printed on the old board and on the new one ("D1") */
  from: string;
  to: string;
  /** null when the new board can use that pin this way */
  problem: string | null;
}

/** Every pin the board's devices and buttons use: each device's main pin, its extra pins (a fan's relays 2 and 3, a tank's echo), each button. */
export function pinPlan(fromBoard: string, toBoard: string, devices: SwapDevice[], inputs: SwapInput[]): PlanRow[] {
  const rows: PlanRow[] = [];
  const add = (what: string, name: string, gpio: number, use: PinUse) => rows.push({
    what, name, gpio, use, from: pinLabel(fromBoard, gpio), to: pinLabel(toBoard, gpio), problem: checkPin(toBoard, gpio, use),
  });
  for (const d of devices) {
    const def = DEVICE_TYPES[d.type];
    add(def?.label.split(' (')[0] ?? d.type, d.name, d.pin, def?.pinUse ?? 'output');
    const settings = (d.settings ?? {}) as Record<string, unknown>;
    for (const extra of def?.extraPins?.(settings) ?? []) add(def?.label.split(' (')[0] ?? d.type, `${d.name} · ${extra.label}`, extra.gpio, extra.use);
  }
  for (const i of inputs) {
    const def = INPUT_TYPES[i.type];
    add(i.type === 'wall_switch' ? 'Wall switch' : 'Push-button', i.name || (i.type === 'wall_switch' ? 'Wall switch' : 'Push-button'), i.pin, def?.pinUse ?? 'input');
  }
  return rows.sort((a, b) => a.gpio - b.gpio);
}

/** Why the new board can't take over (empty: it can), in plain words. */
export function swapProblems(toBoard: string, plan: PlanRow[]): string[] {
  if (!BOARDS[toBoard]) return [`Unknown board model ${toBoard}.`];
  return plan.filter((r) => r.problem).map((r) => `${r.name}: ${r.problem}.`);
}

/** Firmware the new board needs for what it will run (it can be updated after the swap: these are warnings). */
export function firmwareWarnings(firmware: string | null, devices: SwapDevice[], inputs: SwapInput[]): string[] {
  if (!firmware) return [];
  const out: string[] = [];
  for (const d of devices) {
    const min = DEVICE_TYPES[d.type]?.minFirmware;
    if (min && compareVersions(firmware, min) < 0) out.push(`${d.name} needs firmware ${min} or newer (this board runs ${firmware}): update it after the swap.`);
  }
  const newInputs = inputs.some((i) => i.type === 'wall_switch' || (i.settings as { gestures?: boolean } | null)?.gestures === true || !i.targetId);
  if (newInputs && compareVersions(firmware, '2.4.0') < 0) out.push(`Its wall switches and buttons need firmware 2.4.0 or newer (this board runs ${firmware}): update it after the swap.`);
  return out;
}

/** "Replaced by esp-9f02 on 18 Oct 2026" (the date in the home's time zone). */
export function replacedNote(newId: string, at: Date, timeZone: string, reason?: string | null): string {
  const day = at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone });
  return `Replaced by ${newId} on ${day}${reason?.trim() ? `. ${reason.trim()}` : ''}`;
}
