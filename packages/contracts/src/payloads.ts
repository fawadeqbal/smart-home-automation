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
  /** which MQTT login it connected with (firmware 2.6.0+): its own, or the shared "node" one */
  login: z.enum(['own', 'shared']).optional(),
});

export const configDevice = z.object({
  key: z.string(),
  type: z.string(),
  pin: z.number().int(),
  activeLow: z.boolean().default(false),
  settings: z.record(z.unknown()).default({}),
  /** after a power cut: "last" comes back the way it was, "off" stays off (firmware 2.6.0+) */
  restore: z.enum(['last', 'off']).default('last'),
});

export const configInput = z.object({
  type: z.string(),
  pin: z.number().int(),
  /** the switch on this board it toggles by itself (works without Wi-Fi); '' for a button that only runs actions */
  target: z.string(),
  settings: z.record(z.unknown()).default({}),
});

/**
 * Local control (firmware 2.5.0+): the phone app switches things straight over the home's Wi-Fi when
 * the internet is down. The server gives each board a secret key (over the cmd topic, never retained),
 * and each person a "pass" for that board saying what they may see and switch, plus a key derived
 * from it. The board checks every request against both. See apps/api/src/hardware/local-pass.ts.
 */
export const LOCAL_MIN_FIRMWARE = '2.5.0';
export const localKeyCommand = z.object({
  action: z.literal('local'),
  key: z.string().regex(/^[0-9a-f]{64}$/),
  epoch: z.number().int().min(1),
});

/**
 * Per-board MQTT logins (firmware 2.6.0+). A new board first connects with the shared "node" login; the
 * server gives it its own (user = its node id) over the cmd topic, never retained. The board keeps it
 * and connects with it from then on, falling back to the shared login only when its own is refused.
 */
export const BOARD_LOGIN_MIN_FIRMWARE = '2.6.0';
export const loginCommand = z.object({
  action: z.literal('login'),
  user: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/),
  password: z.string().regex(/^[A-Za-z0-9_-]{24,64}$/),
});

/**
 * Firmware update over the server link (firmware 2.6.3+). The ota command carries the file's size and MD5 (and
 * the chunk size); the board asks for chunks on ota/req and the server answers on ota/data with
 * 4 bytes of offset (little-endian) followed by the bytes. The MD5 comes over the authenticated MQTT link,
 * so the board can trust it. Older boards get a download URL instead and fetch it over HTTP(S).
 */
export const OTA_OVER_MQTT_MIN_FIRMWARE = '2.6.3';
export const OTA_CHUNK_BYTES = 1024;
export const otaRequestPayload = z.object({
  from: z.number().int().min(0),
  count: z.number().int().min(1).max(32).default(6),
});

/** A button press or a wall switch flip, from the board (the switch was already toggled on the board, if it has one). */
export const inputEventPayload = z.object({
  gesture: z.enum(['single', 'double', 'long', 'flip']),
});
export type InputEvent = z.infer<typeof inputEventPayload>;

export const nodeConfigPayload = z.object({
  rev: z.number().int(),
  adopted: z.boolean(),
  devices: z.array(configDevice),
  inputs: z.array(configInput),
  telemetrySec: z.number().int().default(60),
  /** after a power cut, switches come back one by one this many ms apart (not all at once on a UPS
   *  or generator); 0 = all together (firmware 2.6.0+) */
  restoreGapMs: z.number().int().min(0).max(10000).default(1500),
});
export type NodeConfigPayload = z.infer<typeof nodeConfigPayload>;

export const configAppliedPayload = z.object({
  rev: z.number().int(),
  ok: z.boolean(),
  error: z.string().optional(),
});

/** Sources a state change can come from. */
// 'local': switched by the phone app straight over the home's Wi-Fi (firmware 2.5.0+, e.g. while the internet is down)
export const STATE_SOURCES = ['remote', 'button', 'boot', 'sensor', 'automation', 'local'] as const;

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
  // local control (firmware 2.5.0+): "<key id>:<epoch>" of the key it holds, "" when it has none
  local: z.string().max(40).optional(),
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
