/** JSON payloads on each topic (see topics.ts). Validated on the server side when received. */
import { z } from 'zod';

export const nodeStatusPayload = z.object({
  online: z.boolean(),
  fw: z.string().optional(),
  ip: z.string().optional(),
});

export const announcePayload = z.object({
  board: z.string(),
  fw: z.string(),
  mac: z.string().optional(),
  ip: z.string().optional(),
});

export const configDevice = z.object({
  key: z.string(),
  type: z.string(),
  pin: z.number().int(),
  activeLow: z.boolean().default(false),
  settings: z.record(z.unknown()).default({}),
});

export const configInput = z.object({
  type: z.string(),
  pin: z.number().int(),
  target: z.string(),
  settings: z.record(z.unknown()).default({}),
});

export const nodeConfigPayload = z.object({
  rev: z.number().int(),
  adopted: z.boolean(),
  devices: z.array(configDevice),
  inputs: z.array(configInput),
  telemetrySec: z.number().int().default(60),
});
export type NodeConfigPayload = z.infer<typeof nodeConfigPayload>;

export const configAppliedPayload = z.object({
  rev: z.number().int(),
  ok: z.boolean(),
  error: z.string().optional(),
});

/** Sources a state change can come from. */
export const STATE_SOURCES = ['remote', 'button', 'boot', 'sensor', 'automation'] as const;

export const deviceStatePayload = z
  .object({
    cid: z.string().optional(), // echoes the command that caused it
    src: z.enum(STATE_SOURCES).default('remote'),
    error: z.string().optional(), // command rejected by the board
  })
  .passthrough(); // plus the type's own fields: {"on": true} or {"temperature": 25.1, "humidity": 51}

export const telemetryPayload = z.object({
  rssi: z.number().optional(),
  heap: z.number().optional(), // free bytes
  heapFrag: z.number().optional(), // %
  maxBlock: z.number().optional(), // largest free block, bytes
  uptime: z.number().optional(), // seconds
  vcc: z.number().optional(), // supply, millivolts (firmware 2.1+, when measured)
  cpuMhz: z.number().optional(),
  flashKb: z.number().optional(),
  sketchKb: z.number().optional(),
  freeSketchKb: z.number().optional(),
  reset: z.string().max(80).optional(), // why it last restarted
  ssid: z.string().max(64).optional(),
  channel: z.number().optional(),
  connects: z.number().optional(), // server connections since boot
  bssid: z.string().max(20).optional(), // the router / access point it is joined to
  gateway: z.string().max(40).optional(),
  mac: z.string().max(20).optional(),
});
export type TelemetryPayload = z.infer<typeof telemetryPayload>;

/** One log line from a board: {"level":"info","msg":"bulb -> ON","uptime":1234} (uptime in seconds). */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export const logPayload = z.object({
  level: z.enum(LOG_LEVELS).catch('info'),
  msg: z.string().max(500),
  uptime: z.number().optional(),
});
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Splits a state message into the device's own fields and the envelope (cid, src, error). */
export function stateFields(payload: Record<string, unknown>): Record<string, unknown> {
  const { cid: _cid, src: _src, error: _error, ...fields } = payload;
  return fields;
}

/** Board -> server on .../network: the answer to a Wi-Fi scan, or the outcome of a Wi-Fi change. */
export const networkPayload = z.object({
  scan: z
    .array(z.object({ ssid: z.string().max(64), rssi: z.number(), channel: z.number(), secure: z.boolean() }))
    .max(40)
    .optional(),
  result: z
    .object({ ok: z.boolean(), ssid: z.string().max(64), message: z.string().max(160) })
    .optional(),
  /** outcome of a firmware update over Wi-Fi */
  ota: z.object({ ok: z.boolean(), version: z.string().max(40), message: z.string().max(160) }).optional(),
});
export type NetworkPayload = z.infer<typeof networkPayload>;
