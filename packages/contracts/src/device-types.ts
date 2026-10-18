/**
 * Device and input types. Each type says which pin use it needs, which settings it takes and
 * whether it can be controlled. Adding a type here + a class in the firmware's DeviceFactory
 * is all it takes for the API, the UI and the assistant to support it.
 */
import { z } from 'zod';
import type { PinUse } from './boards';

export interface DeviceTypeDefinition<S extends z.ZodTypeAny = z.ZodTypeAny> {
  type: string;
  label: string;
  pinUse: PinUse;
  controllable: boolean; // can people / the assistant switch it?
  hasActiveLow: boolean;
  settings: S;
  /** Fields of its state, for display and the assistant. */
  stateFields: { key: string; label: string; unit?: string }[];
  /** Pins it uses besides its main one (taken from its settings), checked like the main pin. */
  extraPins?: (settings: Record<string, unknown>) => { gpio: number; use: PinUse; label: string }[];
  /** The firmware version that first understands this type (older boards reject the configuration). */
  minFirmware?: string;
}

export const switchType: DeviceTypeDefinition = {
  type: 'switch',
  label: 'Switch (relay: bulb, fan, socket)',
  pinUse: 'output',
  controllable: true,
  hasActiveLow: true,
  settings: z.object({}).strict(),
  stateFields: [{ key: 'on', label: 'On' }],
};

export const dhtType: DeviceTypeDefinition = {
  type: 'dht',
  label: 'Temperature and humidity sensor (DHT22 / DHT11)',
  pinUse: 'sensor',
  controllable: false,
  hasActiveLow: false,
  settings: z
    .object({
      model: z.enum(['dht22', 'dht11']).default('dht22'),
      intervalSec: z.number().int().min(5).max(3600).default(30),
    })
    .strict(),
  stateFields: [
    { key: 'temperature', label: 'Temperature', unit: '°C' },
    { key: 'humidity', label: 'Humidity', unit: '%' },
  ],
};

export const contactType: DeviceTypeDefinition = {
  type: 'contact',
  label: 'On/off sensor (door/window contact, motion PIR, water leak)',
  pinUse: 'input',
  controllable: false,
  hasActiveLow: true,
  settings: z
    .object({
      // mains: a module that senses the grid supply (WAPDA): active while the grid is on, so the home
      // knows it is running on UPS or solar when it goes
      kind: z.enum(['door', 'window', 'motion', 'leak', 'mains', 'generic']).default('door'),
      pullup: z.boolean().default(true),
      debounceMs: z.number().int().min(5).max(2000).default(50),
    })
    .strict(),
  stateFields: [{ key: 'active', label: 'Active' }],
};

export const analogType: DeviceTypeDefinition = {
  type: 'analog',
  label: 'Analog sensor on A0 (light, gas, soil moisture, water level)',
  pinUse: 'analog',
  controllable: false,
  hasActiveLow: false,
  settings: z
    .object({
      kind: z.enum(['light', 'gas', 'moisture', 'water', 'generic']).default('light'),
      intervalSec: z.number().int().min(1).max(3600).default(10),
      invert: z.boolean().default(false),
      reportDelta: z.number().int().min(0).max(50).default(2),
    })
    .strict(),
  stateFields: [{ key: 'level', label: 'Level', unit: '%' }],
};

/** Speeds of a 3-relay capacitor fan regulator: which relays close for each speed (0 = the main pin,
 *  1 and 2 = the two extra pins). The usual wiring: relay 1 a small capacitor, relay 2 a bigger one,
 *  relay 3 bypasses the capacitors (full speed). */
export const FAN_DEFAULT_SPEEDS: number[][] = [[0], [1], [0, 1], [2]];

export const fanType: DeviceTypeDefinition = {
  type: 'fan',
  label: 'Ceiling fan with speeds (3-relay capacitor regulator)',
  pinUse: 'output',
  controllable: true,
  hasActiveLow: true,
  settings: z
    .object({
      /** relay 2 and relay 3 (relay 1 is the device's own pin) */
      pins: z.array(z.number().int()).length(2),
      speeds: z.array(z.array(z.number().int().min(0).max(2)).min(1).max(3)).min(2).max(6).default(FAN_DEFAULT_SPEEDS),
    })
    .strict(),
  stateFields: [{ key: 'on', label: 'On' }, { key: 'speed', label: 'Speed' }],
  extraPins: (s) =>
    (Array.isArray(s.pins) ? (s.pins as number[]) : []).map((gpio, i) => ({ gpio, use: 'output' as PinUse, label: `relay ${i + 2}` })),
  minFirmware: '2.6.0',
};

export const tankType: DeviceTypeDefinition = {
  type: 'tank',
  label: 'Water tank level (JSN-SR04T ultrasonic sensor)',
  pinUse: 'output', // the sensor's TRIG pin; ECHO goes on echoPin (through a divider: the sensor's echo is 5 V)
  controllable: false,
  hasActiveLow: false,
  settings: z
    .object({
      echoPin: z.number().int(),
      /** distance from the sensor to the water when the tank is empty, and when it is full (cm) */
      emptyCm: z.number().int().min(20).max(600).default(150),
      fullCm: z.number().int().min(20).max(400).default(25),
      intervalSec: z.number().int().min(5).max(600).default(30),
      /** the motor that fills it: switched on below fillBelowPct (0: never by itself), off at stopAtPct */
      motorDeviceId: z.string().max(40).default(''),
      fillBelowPct: z.number().int().min(0).max(90).default(0),
      stopAtPct: z.number().int().min(50).max(100).default(95),
      /** the motor is stopped (and people told) when the level hasn't risen after this many minutes: a dry well
       *  or a closed valve, and in any case after maxRunMin */
      dryRunMin: z.number().int().min(2).max(60).default(10),
      maxRunMin: z.number().int().min(5).max(240).default(60),
      /** set by the server when the motor is on the same board: the board stops it by itself when full,
       *  even without internet */
      motorKey: z.string().max(48).optional(),
    })
    .strict()
    .refine((s) => s.emptyCm > s.fullCm + 10, { message: 'The empty distance must be at least 10 cm more than the full distance' }),
  stateFields: [{ key: 'level', label: 'Level', unit: '%' }, { key: 'cm', label: 'Distance', unit: 'cm' }],
  extraPins: (s) => (typeof s.echoPin === 'number' ? [{ gpio: s.echoPin, use: 'input' as PinUse, label: 'echo' }] : []),
  minFirmware: '2.6.0',
};

export const DEVICE_TYPES: Record<string, DeviceTypeDefinition> = {
  [switchType.type]: switchType,
  [fanType.type]: fanType,
  [dhtType.type]: dhtType,
  [contactType.type]: contactType,
  [analogType.type]: analogType,
  [tankType.type]: tankType,
};

export interface InputTypeDefinition {
  type: string;
  label: string;
  pinUse: PinUse;
  settings: z.ZodTypeAny;
}

export const INPUT_TYPES: Record<string, InputTypeDefinition> = {
  toggle_button: {
    type: 'toggle_button',
    label: 'Push-button (bell-type, springs back), wired to GND',
    pinUse: 'input',
    settings: z.object({
      debounceMs: z.number().int().min(5).max(500).default(40),
      /** tell a double-press and a long press apart (a single press then waits ~0.35 s) */
      gestures: z.boolean().default(false),
    }).strict(),
  },
  wall_switch: {
    type: 'wall_switch',
    label: 'Ordinary wall switch (stays up or down), wired to GND: every flip toggles',
    pinUse: 'input',
    settings: z.object({ debounceMs: z.number().int().min(5).max(500).default(60) }).strict(),
  },
};

/** What a button gesture (or a wall switch flip) can do beyond its own switch, through the server. */
export type InputAction =
  | { type: 'device'; deviceId: string; on?: boolean }
  | { type: 'scene'; sceneId: string }
  | { type: 'allOff'; roomId?: string | null };
export const GESTURES = ['single', 'double', 'long', 'flip'] as const;

/** Commands a switch accepts. */
export const switchCommand = z.union([
  z.object({ on: z.boolean() }).strict(),
  z.object({ toggle: z.literal(true) }).strict(),
]);
export type SwitchCommand = z.infer<typeof switchCommand>;

/** Commands a fan accepts: a switch's, or a speed (1..number of speeds; 0 = off). Its state: {"on", "speed"}. */
export const fanCommand = z.union([
  z.object({ on: z.boolean() }).strict(),
  z.object({ toggle: z.literal(true) }).strict(),
  z.object({ speed: z.number().int().min(0).max(6) }).strict(),
]);
export type FanCommand = z.infer<typeof fanCommand>;

/** The command a device accepts (null: it takes none), and how many speeds a fan has. */
export function commandSchemaFor(type: string): z.ZodTypeAny | null {
  if (type === 'switch') return switchCommand;
  if (type === 'fan') return fanCommand;
  return null;
}
export function fanSpeeds(settings: unknown): number {
  const speeds = (settings as { speeds?: unknown } | null)?.speeds;
  return Array.isArray(speeds) && speeds.length ? speeds.length : FAN_DEFAULT_SPEEDS.length;
}

/** Compares firmware versions like "2.5.0" (missing parts count as 0). */
export function firmwareAtLeast(version: string | null | undefined, min: string): boolean {
  if (!version) return false;
  const a = version.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const b = min.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}
