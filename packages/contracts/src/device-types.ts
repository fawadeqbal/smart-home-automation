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
      kind: z.enum(['door', 'window', 'motion', 'leak', 'generic']).default('door'),
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

export const DEVICE_TYPES: Record<string, DeviceTypeDefinition> = {
  [switchType.type]: switchType,
  [dhtType.type]: dhtType,
  [contactType.type]: contactType,
  [analogType.type]: analogType,
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
