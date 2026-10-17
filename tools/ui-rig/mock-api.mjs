#!/usr/bin/env node
/**
 * UI rig: a dependency-free mock of the Switchboard API (apps/api) for rendering apps/web with
 * realistic sample data. Listens on :4000 (the Next dev server rewrites /api/* here).
 *
 *   node tools/ui-rig/mock-api.mjs [--port 4000]
 *
 * Persona: cookie `rig_persona` = owner (default) | superadmin | installer | member | anon.
 * anon gets 401 from /auth/me (and from everything that needs a sign-in).
 *
 * Rig helpers (not part of the real API):
 *   GET  /__rig/unknown   paths that had no fixture since start (or the last reset)
 *   POST /__rig/reset     back to the initial data, clears the unknown list
 *
 * Also speaks just enough Socket.IO (Engine.IO v4 over WebSocket) for the app to show "Live connection".
 */
import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';

const PORT = Number(argValue('--port') ?? process.env.PORT ?? 4000);
const VERBOSE = process.env.RIG_VERBOSE === '1' || process.argv.includes('--verbose');
const TZ = 'Asia/Karachi';

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/* ================================================================== time helpers */
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const now = () => Date.now();
const ago = (ms) => new Date(now() - ms).toISOString();
const ahead = (ms) => new Date(now() + ms).toISOString();
const minsAgo = (m) => ago(m * MIN);
const hoursAgo = (h) => ago(h * HOUR);
const daysAgo = (d) => ago(d * DAY);
/** YYYY-MM-DD in Pakistan time. */
const pkDay = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: TZ });
/** An instant at a Pakistan clock time (UTC+5, no DST), `daysBack` days ago. */
function pkAt(daysBack, hh, mm = 0) {
  const day = pkDay(now() - daysBack * DAY);
  return new Date(`${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+05:00`).toISOString();
}
/** The next time a Pakistan clock shows hh:mm (today if still ahead, else tomorrow). */
function nextAt(hh, mm = 0) {
  const today = pkAt(0, hh, mm);
  return new Date(today).getTime() > now() ? today : pkAt(-1, hh, mm);
}
function whenLabel(iso) {
  const t = new Date(iso).getTime();
  const clock = new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
  if (pkDay(t) === pkDay(now())) return `Today ${clock}`;
  if (pkDay(t) === pkDay(now() - DAY)) return `Yesterday ${clock}`;
  return `${new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ })} ${clock}`;
}
function agoLabel(iso) {
  if (!iso) return 'never';
  const m = Math.round((now() - new Date(iso).getTime()) / MIN);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
}
/** Small deterministic noise so charts look real but stay the same between runs. */
const noise = (i, salt = 1) => {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/* ================================================================== catalog (packages/contracts) */
const PIN = { D1: 5, D2: 4, D5: 14, D6: 12, D7: 13, D0: 16, D8: 15, D3: 0, D4: 2, RX: 3, A0: 17 };
const PIN_NAME = Object.fromEntries(Object.entries(PIN).map(([k, v]) => [v, k]));
const pinLabel = (gpio) => `${PIN_NAME[gpio] ?? 'GPIO'} (GPIO ${gpio})`;
const BOARD_PINS = [
  { gpio: 5, label: 'D1', uses: ['output', 'input', 'sensor'], note: 'Best choice for a relay' },
  { gpio: 4, label: 'D2', uses: ['output', 'input', 'sensor'] },
  { gpio: 14, label: 'D5', uses: ['output', 'input', 'sensor'] },
  { gpio: 12, label: 'D6', uses: ['output', 'input', 'sensor'] },
  { gpio: 13, label: 'D7', uses: ['output', 'input', 'sensor'] },
  { gpio: 16, label: 'D0', uses: ['output'], note: 'Output only (no pull-up)' },
  { gpio: 15, label: 'D8', uses: ['output'], note: 'Output only. LOW at boot: an active-low relay clicks on briefly at power-up' },
  { gpio: 0, label: 'D3', uses: ['input'], note: 'Boot pin: do not hold the button while powering on' },
  { gpio: 2, label: 'D4', uses: ['output', 'input'], note: 'Boot pin and on-board LED (the LED stops blinking)' },
  { gpio: 3, label: 'RX', uses: ['input', 'sensor'], note: 'Unplug the sensor/button when flashing over USB' },
  { gpio: 17, label: 'A0', uses: ['analog'], note: 'The only analog input (light, gas, soil moisture, water level)' },
];
const BOARDS = {
  NODEMCU_V2: { type: 'NODEMCU_V2', name: 'NodeMCU 1.0 (ESP-12E)', pins: BOARD_PINS },
  NODEMCU_V3: { type: 'NODEMCU_V3', name: 'NodeMCU v3 / LoLin (black, CH340)', pins: BOARD_PINS },
  WEMOS_D1_MINI: { type: 'WEMOS_D1_MINI', name: 'Wemos / LOLIN D1 mini', pins: BOARD_PINS },
};
const DEVICE_TYPES = {
  switch: { type: 'switch', label: 'Switch (relay: bulb, fan, socket)', pinUse: 'output', controllable: true, hasActiveLow: true, stateFields: [{ key: 'on', label: 'On' }] },
  dht: { type: 'dht', label: 'Temperature and humidity sensor (DHT22 / DHT11)', pinUse: 'sensor', controllable: false, hasActiveLow: false,
    stateFields: [{ key: 'temperature', label: 'Temperature', unit: '°C' }, { key: 'humidity', label: 'Humidity', unit: '%' }] },
  contact: { type: 'contact', label: 'On/off sensor (door/window contact, motion PIR, water leak)', pinUse: 'input', controllable: false, hasActiveLow: true, stateFields: [{ key: 'active', label: 'Active' }] },
  analog: { type: 'analog', label: 'Analog sensor on A0 (light, gas, soil moisture, water level)', pinUse: 'analog', controllable: false, hasActiveLow: false, stateFields: [{ key: 'level', label: 'Level', unit: '%' }] },
};
const CATALOG = {
  boards: Object.values(BOARDS),
  deviceTypes: Object.values(DEVICE_TYPES),
  inputTypes: [
    { type: 'toggle_button', label: 'Push-button (bell-type, springs back), wired to GND', pinUse: 'input' },
    { type: 'wall_switch', label: 'Ordinary wall switch (stays up or down), wired to GND: every flip toggles', pinUse: 'input' },
  ],
};
const CURRENT_FIRMWARE = '2.6.1';

/* ================================================================== people */
const ORG = { id: 'org-switchboard', name: 'Switchboard Services', plan: 'BUSINESS', planName: 'Business', status: 'ACTIVE', trialEndsAt: null, logo: null, onboarded: true, selfHosted: true };
const U = {
  fawad: { id: 'u-fawad', name: 'Fawad Iqbal', email: 'fawad.iqbal@gmail.com' },
  ayesha: { id: 'u-ayesha', name: 'Ayesha Fawad', email: 'ayesha.fawad@gmail.com' },
  hamza: { id: 'u-hamza', name: 'Hamza Iqbal', email: 'hamza.iqbal07@gmail.com' },
  zainab: { id: 'u-zainab', name: 'Zainab Iqbal', email: 'zainab.iqbal@outlook.com' },
  usman: { id: 'u-usman-t', name: 'Usman Tariq', email: 'usman.tariq@yahoo.com' },
  // staff
  sana: { id: 's-sana', name: 'Sana Mirza', email: 'sana@switchboard.pk' },
  bilal: { id: 's-bilal', name: 'Bilal Ahmed', email: 'bilal@switchboard.pk' },
  kamran: { id: 's-kamran', name: 'Kamran Javed', email: 'kamran@switchboard.pk' },
  mehwish: { id: 's-mehwish', name: 'Mehwish Raza', email: 'mehwish@switchboard.pk' },
  danish: { id: 's-danish', name: 'Danish Ali', email: 'danish@switchboard.pk' },
};

/* ================================================================== the home: Iqbal House */
const HOME = { id: 'home-iqbal', name: 'Iqbal House', city: 'Abbottabad', timezone: TZ };
const ROOMS = [
  { id: 'r-drawing', name: 'Drawing room', order: 0 },
  { id: 'r-kitchen', name: 'Kitchen', order: 1 },
  { id: 'r-master', name: 'Master bedroom', order: 2 },
  { id: 'r-kids', name: 'Kids room', order: 3 },
  { id: 'r-porch', name: 'Porch', order: 4 },
];
const roomName = (id) => ROOMS.find((r) => r.id === id)?.name ?? null;

const NODES_BASE = [
  { id: 'esp-3a91f2', name: 'Drawing room', board: 'NODEMCU_V3', online: true, firmware: '2.6.1', ip: '192.168.1.41', mac: '5C:CF:7F:3A:91:F2', rssi: -58,
    health: { rssi: -58, heap: 27840, heapFrag: 9, maxBlock: 22144, uptime: 4 * 86400 + 6 * 3600 + 720, vcc: 3290, cpuMhz: 80, flashKb: 4096, sketchKb: 412, freeSketchKb: 1636, reset: 'Power On', ssid: 'IqbalHouse-5G', channel: 6, connects: 1, bssid: 'A4:2B:B0:11:7E:20', gateway: '192.168.1.1', mac: '5C:CF:7F:3A:91:F2' } },
  { id: 'esp-7c04be', name: 'Kitchen', board: 'NODEMCU_V2', online: true, firmware: '2.6.1', ip: '192.168.1.42', mac: '5C:CF:7F:7C:04:BE', rssi: -71,
    health: { rssi: -71, heap: 24112, heapFrag: 14, maxBlock: 17920, uptime: 2 * 86400 + 3 * 3600, vcc: 3215, cpuMhz: 80, flashKb: 4096, sketchKb: 412, freeSketchKb: 1636, reset: 'Power On', ssid: 'IqbalHouse', channel: 6, connects: 2, bssid: 'A4:2B:B0:11:7E:21', gateway: '192.168.1.1', mac: '5C:CF:7F:7C:04:BE' } },
  { id: 'esp-b51e09', name: 'Bedrooms', board: 'WEMOS_D1_MINI', online: false, firmware: '2.5.2', ip: '192.168.1.43', mac: '5C:CF:7F:B5:1E:09', rssi: -79, lastSeenMin: 42,
    health: { rssi: -79, heap: 21500, heapFrag: 18, maxBlock: 15360, uptime: 9 * 3600, vcc: 3080, cpuMhz: 80, flashKb: 4096, sketchKb: 408, freeSketchKb: 1640, reset: 'Power On', ssid: 'IqbalHouse', channel: 6, connects: 4, bssid: 'A4:2B:B0:11:7E:21', gateway: '192.168.1.1', mac: '5C:CF:7F:B5:1E:09' } },
];

// [id, name, type, room, node, pin, on/state, extra]
const DEVICES_BASE = [
  ['d-drawing-lights', 'Ceiling lights', 'switch', 'r-drawing', 'esp-3a91f2', PIN.D1, { on: true }, { watts: 40, aliases: ['drawing room lights', 'baithak ki batti'], source: 'remote', updMin: 25 }],
  ['d-drawing-fan', 'Ceiling fan', 'switch', 'r-drawing', 'esp-3a91f2', PIN.D2, { on: true }, { watts: 75, source: 'button', updMin: 70 }],
  ['d-tv-socket', 'TV socket', 'switch', 'r-drawing', 'esp-3a91f2', PIN.D5, { on: false }, { watts: null, source: 'remote', updMin: 180 }],
  ['d-porch-light', 'Porch light', 'switch', 'r-porch', 'esp-3a91f2', PIN.D6, { on: false }, { watts: 15, source: 'automation', updMin: 400 }],
  ['d-main-gate', 'Main gate', 'contact', 'r-porch', 'esp-3a91f2', PIN.D7, { active: false }, { settings: { kind: 'door', pullup: true, debounceMs: 50 }, source: 'sensor', updMin: 34 }],
  ['d-water-tank', 'Water tank', 'analog', 'r-porch', 'esp-3a91f2', PIN.A0, { level: 68 }, { settings: { kind: 'water', intervalSec: 60, invert: false, reportDelta: 2 }, source: 'sensor', updMin: 1 }],
  ['d-kitchen-light', 'Kitchen light', 'switch', 'r-kitchen', 'esp-7c04be', PIN.D1, { on: true }, { watts: 18, source: 'button', updMin: 12 }],
  ['d-exhaust', 'Exhaust fan', 'switch', 'r-kitchen', 'esp-7c04be', PIN.D2, { on: false }, { watts: 40, source: 'remote', updMin: 95 }],
  ['d-geyser', 'Geyser', 'switch', 'r-kitchen', 'esp-7c04be', PIN.D5, { on: false }, { watts: 2000, childLock: true, autoOffMinutes: 60, source: 'automation', updMin: 300 }],
  ['d-motor', 'Water motor', 'switch', 'r-kitchen', 'esp-7c04be', PIN.D6, { on: false }, { watts: 750, childLock: true, autoOffMinutes: 30, aliases: ['pump', 'motor'], source: 'automation', updMin: 610 }],
  ['d-kitchen-temp', 'Temperature', 'dht', 'r-kitchen', 'esp-7c04be', PIN.D7, { temperature: 24.6, humidity: 58 }, { settings: { model: 'dht22', intervalSec: 30 }, source: 'sensor', updMin: 0.5 }],
  ['d-master-light', 'Bedroom light', 'switch', 'r-master', 'esp-b51e09', PIN.D1, { on: false }, { watts: 15, source: 'remote', updMin: 50 }],
  ['d-master-fan', 'Ceiling fan', 'switch', 'r-master', 'esp-b51e09', PIN.D2, { on: true }, { watts: 75, source: 'button', updMin: 55 }],
  ['d-kids-lamp', 'Night lamp', 'switch', 'r-kids', 'esp-b51e09', PIN.D5, { on: true }, { watts: 5, source: 'automation', updMin: 60 }],
  ['d-kids-fan', 'Fan', 'switch', 'r-kids', 'esp-b51e09', PIN.D6, { on: false }, { watts: 75, source: 'remote', updMin: 48 }],
];

const INPUTS_BASE = [
  { id: 'in-drawing-btn', nodeId: 'esp-3a91f2', type: 'wall_switch', pin: PIN.D3, name: 'Door switch', targetId: 'd-drawing-lights', actions: { flip: { type: 'device', deviceId: 'd-drawing-lights' } }, settings: { debounceMs: 60 }, lastMin: 70 },
  { id: 'in-kitchen-btn', nodeId: 'esp-7c04be', type: 'toggle_button', pin: PIN.D3, name: 'Light button', targetId: 'd-kitchen-light', actions: { single: { type: 'device', deviceId: 'd-kitchen-light' }, long: { type: 'allOff', roomId: 'r-kitchen' } }, settings: { debounceMs: 40, gestures: true }, lastMin: 12 },
];

/* ================================================================== mutable state */
let S;
function freshState() {
  const devices = DEVICES_BASE.map(([id, name, type, roomId, nodeId, pin, state, x]) => ({
    id, key: id.replace(/^d-/, '').replace(/-/g, '_'), name, type, roomId, nodeId, pin, state: { ...state },
    settings: x.settings ?? {}, aliases: x.aliases ?? [], watts: x.watts ?? null, childLock: !!x.childLock,
    autoOffMinutes: x.autoOffMinutes ?? null, source: x.source ?? 'remote', updatedAt: minsAgo(x.updMin ?? 10), enabled: true, activeLow: type === 'switch',
  }));
  return {
    devices,
    nodes: NODES_BASE.map((n) => ({ ...n, lastSeenAt: n.online ? minsAgo(0.3) : minsAgo(n.lastSeenMin ?? 30) })),
    away: { on: false, since: null, by: null, lights: ['d-drawing-lights', 'd-porch-light', 'd-master-light'] },
    tariff: 60,
    unread: new Set(['n1', 'n2', 'n3']),
    prefs: {},
    schedulesEnabled: {},
    rulesEnabled: {},
    visitStatus: {},
  };
}
S = freshState();
const unknown = new Map(); // "GET /x" -> count

/* ================================================================== personas */
const PERSONAS = ['owner', 'superadmin', 'installer', 'member', 'anon'];
function personaOf(req) {
  const m = /(?:^|;\s*)rig_persona=([^;]+)/.exec(req.headers.cookie ?? '');
  const p = m ? decodeURIComponent(m[1]).trim().toLowerCase() : 'owner';
  return PERSONAS.includes(p) ? p : 'owner';
}
const MEMBER_ROOMS = [{ roomId: 'r-kids', access: 'CONTROL' }, { roomId: 'r-drawing', access: 'VIEW' }];

function meFor(p) {
  const homeRow = { id: HOME.id, name: HOME.name, city: HOME.city };
  if (p === 'owner') {
    return { ...U.fawad, twoFactor: false, staff: null, homes: [{ ...homeRow, role: 'OWNER' }],
      home: { ...HOME, role: 'OWNER', viaStaff: false, readOnly: false, canSetup: false, onboarded: true },
      role: 'OWNER', rooms: ROOMS.map((r) => ({ roomId: r.id, access: 'MANAGE' })) };
  }
  if (p === 'member') {
    return { ...U.hamza, twoFactor: false, staff: null, homes: [{ ...homeRow, role: 'MEMBER' }],
      home: { ...HOME, role: 'MEMBER', viaStaff: false, readOnly: false, canSetup: false, onboarded: true },
      role: 'MEMBER', rooms: MEMBER_ROOMS };
  }
  if (p === 'superadmin') {
    return { ...U.sana, twoFactor: true, staff: { role: 'SUPERADMIN', org: ORG }, homes: [], home: null, role: null, rooms: [] };
  }
  if (p === 'installer') {
    return { ...U.bilal, twoFactor: true, staff: { role: 'INSTALLER', org: ORG }, homes: [], home: null, role: null, rooms: [] };
  }
  return null;
}
/** What the persona may do in a room of Iqbal House (staff act as owner). */
function accessFor(p, roomId) {
  if (p === 'member') return MEMBER_ROOMS.find((r) => r.roomId === roomId)?.access ?? null;
  return 'MANAGE';
}

/* ================================================================== views of the home */
function nodeOf(id) { return S.nodes.find((n) => n.id === id); }
function deviceView(d, p) {
  const def = DEVICE_TYPES[d.type];
  const node = nodeOf(d.nodeId);
  const autoOffAt = d.type === 'switch' && d.state.on && d.autoOffMinutes ? new Date(new Date(d.updatedAt).getTime() + d.autoOffMinutes * MIN).toISOString() : null;
  return {
    id: d.id, key: d.key, name: d.name, aliases: d.aliases, type: d.type, typeLabel: def.label, controllable: def.controllable,
    stateFields: def.stateFields, nodeId: d.nodeId, nodeName: node.name, online: node.online, roomId: d.roomId, roomName: roomName(d.roomId),
    pin: d.pin, pinLabel: pinLabel(d.pin), activeLow: d.activeLow, settings: d.settings, enabled: d.enabled, childLock: d.childLock,
    autoOffMinutes: d.autoOffMinutes, autoOffAt, watts: d.watts, state: d.state, source: d.source, updatedAt: d.updatedAt,
    access: accessFor(p, d.roomId) ?? 'VIEW',
  };
}
function devicesFor(p) {
  return S.devices.filter((d) => accessFor(p, d.roomId)).map((d) => deviceView(d, p));
}
function roomsFor(p) {
  return ROOMS.filter((r) => accessFor(p, r.id)).map((r) => ({ ...r, access: accessFor(p, r.id) }));
}
function nodeView(n) {
  const devs = S.devices.filter((d) => d.nodeId === n.id);
  return {
    id: n.id, name: n.name, board: n.board, status: 'ADOPTED', boardName: BOARDS[n.board].name, online: n.online, firmware: n.firmware,
    ip: n.ip, mac: n.mac, localControl: n.firmware >= '2.5.0' ? (n.online ? 'ready' : 'waiting') : 'old-firmware',
    publicIp: '39.40.118.27', publicPlace: 'Abbottabad, Khyber Pakhtunkhwa', publicIsp: 'PTCL',
    rssi: n.rssi, lastSeenAt: n.lastSeenAt, configRev: 7, appliedRev: 7, configError: null,
    health: n.health ? { at: n.online ? minsAgo(0.5) : n.lastSeenAt, ...n.health } : null,
    devices: devs.map((d) => ({ id: d.id, key: d.key, name: d.name, type: d.type, pin: d.pin, activeLow: d.activeLow, roomId: d.roomId, settings: d.settings, enabled: d.enabled, aliases: d.aliases, state: d.state })),
    inputs: INPUTS_BASE.filter((i) => i.nodeId === n.id).map((i) => ({
      id: i.id, type: i.type, pin: i.pin, name: i.name, targetId: i.targetId, targetName: S.devices.find((d) => d.id === i.targetId)?.name ?? null,
      settings: i.settings, actions: i.actions, lastEventAt: minsAgo(i.lastMin),
    })),
  };
}

function history(d) {
  const out = [];
  if (d.type === 'dht') {
    for (let i = 0; i < 96; i++) {
      const t = now() - i * 15 * MIN;
      const hourPk = (new Date(t).getUTCHours() + 5) % 24;
      const temp = 21.5 + 4 * Math.sin(((hourPk - 9) / 24) * 2 * Math.PI) + noise(i, 3) * 0.8;
      const hum = 62 - 8 * Math.sin(((hourPk - 9) / 24) * 2 * Math.PI) + noise(i, 7) * 3;
      out.push({ state: { temperature: Math.round(temp * 10) / 10, humidity: Math.round(hum) }, source: 'sensor', at: new Date(t).toISOString() });
    }
  } else if (d.type === 'analog') {
    for (let i = 0; i < 72; i++) {
      const lvl = 68 - (i % 24) * 1.5 + (i % 24 > 18 ? 35 : 0);
      out.push({ state: { level: Math.max(12, Math.min(100, Math.round(lvl))) }, source: 'sensor', at: new Date(now() - i * 20 * MIN).toISOString() });
    }
  } else if (d.type === 'contact') {
    const times = [34, 36, 190, 193, 610, 612, 1380, 1383, 1500, 1502];
    times.forEach((m, i) => out.push({ state: { active: i % 2 === 1 }, source: 'sensor', at: minsAgo(m) }));
  } else {
    const sources = ['remote', 'button', 'automation', 'remote', 'button', 'boot', 'remote', 'automation'];
    let on = !!d.state.on;
    let m = 0;
    for (let i = 0; i < 24; i++) {
      out.push({ state: { on }, source: i === 0 ? d.source : sources[i % sources.length], at: minsAgo(i === 0 ? Math.max(1, (now() - new Date(d.updatedAt).getTime()) / MIN) : m) });
      m += 40 + Math.round(noise(i, d.pin) * 300);
      on = !on;
    }
  }
  return out;
}

/* ================================================================== energy and outages */
const DAILY_HOURS = {
  'd-drawing-lights': 6, 'd-drawing-fan': 10, 'd-tv-socket': 4, 'd-porch-light': 7, 'd-kitchen-light': 5, 'd-exhaust': 1.5,
  'd-geyser': 1.2, 'd-motor': 0.8, 'd-master-light': 5, 'd-master-fan': 9, 'd-kids-lamp': 8, 'd-kids-fan': 9,
};
const GUESSED = new Set(['d-drawing-fan', 'd-master-fan', 'd-kids-fan', 'd-exhaust']);
function energy(days) {
  const tariff = S.tariff;
  const switches = S.devices.filter((d) => d.type === 'switch');
  const perDay = [];
  for (let i = days - 1; i >= 0; i--) {
    const f = i === 0 ? 0.62 : 0.8 + noise(i, 11) * 0.45;
    let kwh = 0;
    for (const d of switches) kwh += ((d.watts ?? 0) * (DAILY_HOURS[d.id] ?? 0) * f) / 1000;
    kwh = Math.round(kwh * 10) / 10;
    perDay.push({ day: pkDay(now() - i * DAY), kwh, cost: Math.round(kwh * tariff) });
  }
  const span = perDay.reduce((s, d) => s + d.kwh, 0) / Math.max(1, switches.reduce((s, d) => s + ((d.watts ?? 0) * (DAILY_HOURS[d.id] ?? 0)) / 1000, 0));
  const devices = switches.map((d) => {
    const hours = Math.round((DAILY_HOURS[d.id] ?? 0) * span * 10) / 10;
    const kwh = Math.round(((d.watts ?? 0) * hours) / 100) / 10;
    return {
      id: d.id, name: d.name, room: roomName(d.roomId), watts: d.watts ?? 0, wattsSource: d.watts == null ? 'unknown' : GUESSED.has(d.id) ? 'guessed' : 'set',
      hours, kwh, cost: Math.round(kwh * tariff), onNow: !!d.state.on && nodeOf(d.nodeId).online,
    };
  }).sort((a, b) => b.kwh - a.kwh || b.hours - a.hours);
  const total = { kwh: Math.round(perDay.reduce((s, d) => s + d.kwh, 0) * 10) / 10, cost: perDay.reduce((s, d) => s + d.cost, 0), hours: Math.round(devices.reduce((s, d) => s + d.hours, 0) * 10) / 10 };
  const perDayAvg = total.kwh / Math.max(1, days === 1 ? 0.62 : days);
  const monthKwh = Math.round(perDayAvg * 30);
  return {
    days, timezone: TZ, tariff, tariffSet: true, currency: 'PKR', total, month: { kwh: monthKwh, cost: monthKwh * tariff },
    perDay, devices, unknown: devices.filter((d) => d.wattsSource === 'unknown').length,
    powerCuts: homeOutages(days).summary.powerCuts,
  };
}

function homeOutages(days) {
  const outages = [];
  const boards = [['esp-3a91f2', 'Drawing room'], ['esp-7c04be', 'Kitchen'], ['esp-b51e09', 'Bedrooms']];
  for (let i = 0; i < days; i++) {
    if (i % 3 === 1) {
      // load shedding: the same hour, every board loses power
      const start = pkAt(i, i % 2 ? 14 : 18, 0);
      const secs = (i % 2 ? 60 : 120) * 60 + Math.round(noise(i, 5) * 300);
      boards.forEach(([, name], k) => outages.push({
        id: `o-p-${i}-${k}`, kind: 'POWER', label: 'Power cut', board: name, startedAt: start,
        endedAt: new Date(new Date(start).getTime() + secs * 1000 + k * 20_000).toISOString(), seconds: secs + k * 20, reset: 'Power On',
      }));
    }
    if (i === 4 || i === 11) {
      const start = pkAt(i, 21, 10);
      outages.push({ id: `o-n-${i}`, kind: 'NETWORK', label: 'Wi‑Fi or internet down', board: 'Kitchen', startedAt: start, endedAt: new Date(new Date(start).getTime() + 25 * MIN).toISOString(), seconds: 1500, reset: null });
    }
    if (i === 9) {
      const start = pkAt(i, 3, 42);
      outages.push({ id: 'o-c-9', kind: 'CRASH', label: 'Board restarted after a fault', board: 'Bedrooms', startedAt: start, endedAt: new Date(new Date(start).getTime() + 40_000).toISOString(), seconds: 40, reset: 'Hardware Watchdog' });
    }
  }
  const inWindow = outages.filter((o) => new Date(o.startedAt).getTime() < now());
  const power = inWindow.filter((o) => o.kind === 'POWER' && o.board === 'Drawing room');
  const net = inWindow.filter((o) => o.kind === 'NETWORK');
  const last = power.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;
  return {
    days, timezone: TZ,
    summary: {
      powerCuts: power.length, powerSeconds: power.reduce((s, o) => s + o.seconds, 0), networkOuts: net.length, networkSeconds: net.reduce((s, o) => s + o.seconds, 0),
      restarts: 1, crashes: inWindow.filter((o) => o.kind === 'CRASH').length,
      lastPower: last ? { startedAt: last.startedAt, endedAt: last.endedAt, seconds: last.seconds } : null,
    },
    outages: inWindow,
  };
}

/* ================================================================== automations */
const SCENES = [
  { id: 'sc-goodnight', name: 'Good night', icon: 'moon', createdBy: U.fawad.name,
    actions: [['d-drawing-lights', false], ['d-tv-socket', false], ['d-kitchen-light', false], ['d-porch-light', true], ['d-master-light', false], ['d-kids-lamp', true]] },
  { id: 'sc-guests', name: 'Guests arriving', icon: 'sofa', createdBy: U.ayesha.name,
    actions: [['d-drawing-lights', true], ['d-drawing-fan', true], ['d-porch-light', true], ['d-kitchen-light', true]] },
  { id: 'sc-leaving', name: 'Leaving home', icon: 'log-out', createdBy: U.fawad.name,
    actions: [['d-drawing-lights', false], ['d-drawing-fan', false], ['d-tv-socket', false], ['d-kitchen-light', false], ['d-exhaust', false], ['d-geyser', false], ['d-motor', false], ['d-master-light', false], ['d-master-fan', false], ['d-kids-fan', false]] },
];
const devName = (id) => S.devices.find((d) => d.id === id)?.name ?? id;
const act = (id, on) => ({ deviceId: id, on, deviceName: `${devName(id)}${['d-drawing-fan', 'd-master-fan'].includes(id) ? ` (${roomName(S.devices.find((d) => d.id === id).roomId)})` : ''}` });
function scenesFor(p) {
  return SCENES.map((s) => ({
    id: s.id, name: s.name, icon: s.icon, createdBy: s.createdBy,
    canRun: p !== 'member' || s.actions.every(([id]) => accessFor(p, S.devices.find((d) => d.id === id).roomId) === 'CONTROL'),
    actions: s.actions.map(([id, on]) => act(id, on)),
  }));
}
function schedules() {
  const list = [
    { id: 'sch-porch-sunset', name: 'Porch light at sunset', kind: 'SUN', sunEvent: 'SUNSET', offsetMin: 0, runAt: null, time: null, days: [], nextRunAt: nextAt(17, 38),
      lastRunAt: pkAt(1, 17, 39), lastResult: 'Done: Porch light on', actions: [act('d-porch-light', true)], by: U.fawad },
    { id: 'sch-porch-off', name: 'Porch light off at night', kind: 'DAILY', time: '23:30', days: [], nextRunAt: nextAt(23, 30),
      lastRunAt: pkAt(1, 23, 30), lastResult: 'Done: Porch light off', actions: [act('d-porch-light', false)], by: U.fawad },
    { id: 'sch-motor', name: 'Fill the water tank', kind: 'DAILY', time: '06:00', days: [1, 2, 3, 4, 5, 6], nextRunAt: nextAt(6, 0),
      lastRunAt: pkAt(0, 6, 0), lastResult: 'Done: Water motor on (off by itself after 30 min)', actions: [act('d-motor', true)], by: U.fawad },
    { id: 'sch-geyser', name: 'Geyser before Fajr', kind: 'DAILY', time: '04:45', days: [], nextRunAt: nextAt(4, 45),
      lastRunAt: pkAt(0, 4, 45), lastResult: 'Done: Geyser on', actions: [act('d-geyser', true)], by: U.ayesha },
    { id: 'sch-fan-timer', name: 'Kids fan off', kind: 'ONCE', runAt: ahead(24 * MIN), time: null, days: [], nextRunAt: ahead(24 * MIN),
      lastRunAt: null, lastResult: null, actions: [act('d-kids-fan', false)], by: U.ayesha },
    { id: 'sch-exhaust-done', name: 'Exhaust fan off', kind: 'ONCE', runAt: hoursAgo(20), time: null, days: [], nextRunAt: null, enabled: false,
      lastRunAt: hoursAgo(20), lastResult: 'Done: Exhaust fan off', actions: [act('d-exhaust', false)], by: U.ayesha },
    { id: 'sch-weekend-lights', name: 'Weekend drawing room lights', kind: 'DAILY', time: '19:00', days: [0, 6], nextRunAt: null, enabled: false,
      lastRunAt: daysAgo(6), lastResult: 'Done: Ceiling lights on', actions: [act('d-drawing-lights', true)], by: U.hamza },
  ];
  return list.map((s) => ({
    id: s.id, name: s.name, kind: s.kind, sunEvent: s.sunEvent ?? null, offsetMin: s.offsetMin ?? 0, runAt: s.runAt ?? null, time: s.time ?? null, days: s.days,
    enabled: S.schedulesEnabled[s.id] ?? s.enabled ?? true, nextRunAt: s.nextRunAt, lastRunAt: s.lastRunAt, lastResult: s.lastResult,
    sceneId: null, sceneName: null, actions: s.actions, createdBy: s.by.name, createdById: s.by.id,
  }));
}
function rules() {
  const list = [
    { id: 'rule-gate', name: 'Gate opens at night → porch light and tell me', trigger: { deviceId: 'd-main-gate', deviceName: 'Main gate', event: 'opens' },
      conditions: { from: '22:00', to: '06:00' }, actions: [{ type: 'device', deviceId: 'd-porch-light', deviceName: 'Porch light', on: true, forMinutes: 5 }, { type: 'notify', to: 'me', message: 'Someone is at the gate' }],
      lastFiredAt: hoursAgo(19), lastResult: 'Porch light on for 5 min · told Fawad', summary: 'When the Main gate opens between 22:00 and 06:00: turn Porch light on for 5 min, then tell me', by: U.fawad },
    { id: 'rule-kitchen-hot', name: 'When the kitchen gets above 35 °C, turn the exhaust fan on', trigger: { deviceId: 'd-kitchen-temp', deviceName: 'Temperature', event: 'above', value: 35, field: 'temperature' },
      conditions: {}, actions: [{ type: 'device', deviceId: 'd-exhaust', deviceName: 'Exhaust fan', on: true, forMinutes: 20 }],
      lastFiredAt: daysAgo(12), lastResult: 'Exhaust fan on for 20 min', summary: 'When the kitchen gets above 35 °C, turn the exhaust fan on', by: U.ayesha },
    { id: 'rule-tank-low', name: 'Water tank low → tell everyone', trigger: { deviceId: 'd-water-tank', deviceName: 'Water tank', event: 'below', value: 20, field: 'level' },
      conditions: {}, actions: [{ type: 'notify', to: 'everyone', message: 'Water tank is below 20%. Turn the motor on.' }],
      lastFiredAt: daysAgo(3), lastResult: 'Told 4 people', summary: 'When the Water tank goes below 20%: tell everyone', by: U.fawad },
    { id: 'rule-away-motion', name: 'Kids room fan off when away', trigger: { deviceId: 'd-kids-fan', deviceName: 'Fan', event: 'on' },
      conditions: { away: true }, actions: [{ type: 'device', deviceId: 'd-kids-fan', deviceName: 'Fan', on: false }],
      lastFiredAt: null, lastResult: null, summary: 'When the Fan (Kids room) turns on while away: turn it off', by: U.fawad, enabled: false },
  ];
  return list.map((r) => ({
    id: r.id, name: r.name, enabled: S.rulesEnabled[r.id] ?? r.enabled ?? true, trigger: r.trigger, conditions: r.conditions, actions: r.actions,
    cooldownSec: 120, lastFiredAt: r.lastFiredAt, lastResult: r.lastResult, createdBy: r.by.name, createdById: r.by.id, summary: r.summary,
  }));
}
function location() {
  return {
    lat: 34.1688, lon: 73.2215, source: 'city', label: 'Abbottabad', sunrise: pkAt(0, 6, 21), sunset: pkAt(0, 17, 38), timezone: TZ,
    cities: ['Abbottabad', 'Faisalabad', 'Gujranwala', 'Hyderabad', 'Islamabad', 'Karachi', 'Lahore', 'Multan', 'Peshawar', 'Quetta', 'Rawalpindi', 'Sialkot'],
  };
}
function awayView() {
  return {
    ...S.away, eveningFrom: pkAt(0, 17, 38), eveningTo: '23:30',
    switches: S.devices.filter((d) => d.type === 'switch').map((d) => ({ id: d.id, name: d.name, room: roomName(d.roomId) })),
  };
}

/* ================================================================== people, activity, notices */
function familyMembers() {
  return [
    { ...U.fawad, role: 'OWNER', staff: null, disabled: false, joinedAt: daysAgo(214), rooms: [] },
    { ...U.ayesha, role: 'ADMIN', staff: null, disabled: false, joinedAt: daysAgo(213), rooms: [] },
    { ...U.hamza, role: 'MEMBER', staff: null, disabled: false, joinedAt: daysAgo(200), rooms: MEMBER_ROOMS },
    { ...U.zainab, role: 'MEMBER', staff: null, disabled: false, joinedAt: daysAgo(198), rooms: [{ roomId: 'r-kids', access: 'MANAGE' }, { roomId: 'r-master', access: 'VIEW' }] },
    { ...U.usman, role: 'GUEST', staff: null, disabled: false, joinedAt: daysAgo(2), rooms: [{ roomId: 'r-drawing', access: 'CONTROL' }] },
    { ...U.bilal, role: null, staff: 'INSTALLER', disabled: false, joinedAt: daysAgo(220), rooms: [] },
  ];
}
const INVITES = () => [
  { id: 'inv-saima', email: 'saima.khan@gmail.com', name: 'Saima Khala', role: 'GUEST', expiresAt: ahead(5 * DAY), createdAt: daysAgo(2) },
  { id: 'inv-ali', email: 'ali.iqbal@hotmail.com', name: 'Ali Iqbal', role: 'MEMBER', expiresAt: ahead(6 * DAY), createdAt: daysAgo(1) },
];

const AUDIT_HOME = () => [
  ['a1', minsAgo(42), 'System', 'System', true, 'node.offline', 'devices', 'Bedrooms board (esp-b51e09) lost contact'],
  ['a2', minsAgo(25), U.fawad.name, 'Home owner', false, 'device.switch', 'devices', 'Ceiling lights · Drawing room → on'],
  ['a3', hoursAgo(3), U.ayesha.name, 'Home admin', false, 'schedule.create', 'devices', 'Timer “Kids fan off”'],
  ['a4', hoursAgo(19), 'System', 'System', true, 'rule.fired', 'devices', 'Gate opens at night → porch light on for 5 min'],
  ['a5', daysAgo(1), U.fawad.name, 'Home owner', false, 'user.invite', 'access', 'Ali Iqbal (ali.iqbal@hotmail.com) as member'],
  ['a6', daysAgo(2), U.fawad.name, 'Home owner', false, 'user.invite', 'access', 'Usman Tariq as guest · Drawing room'],
  ['a7', daysAgo(2) , U.usman.name, 'Guest', false, 'invite.accept', 'access', 'Joined Iqbal House'],
  ['a8', daysAgo(3), U.fawad.name, 'Home owner', false, 'device.update', 'devices', 'Water motor · child lock on, off after 30 min'],
  ['a9', daysAgo(5), U.bilal.name, 'Installer', false, 'node.firmware', 'system', 'Kitchen board updated to 2.6.1'],
  ['a10', daysAgo(5), U.bilal.name, 'Installer', false, 'node.firmware', 'system', 'Drawing room board updated to 2.6.1'],
  ['a11', daysAgo(8), U.ayesha.name, 'Home admin', false, 'room.access', 'access', 'Zainab Iqbal · Kids room → switch & rename'],
  ['a12', daysAgo(14), U.bilal.name, 'Installer', false, 'device.create', 'setup', 'Water tank level on A0 · Drawing room board'],
  ['a13', daysAgo(14), U.bilal.name, 'Installer', false, 'input.create', 'setup', 'Wall switch on D3 → Ceiling lights'],
  ['a14', daysAgo(30), 'System', 'System', true, 'invoice.issue', 'billing', 'Invoice #2031 · Rs 3,500'],
  ['a15', daysAgo(31), U.fawad.name, 'Home owner', false, 'installation.sign', 'setup', 'Installation signed off'],
].map(([id, at, who, role, system, action, category, target]) => ({ id, at, when: whenLabel(at), who, role, system, action, category, target, homeId: HOME.id, homeName: HOME.name }));

function notices() {
  const items = [
    { id: 'n1', kind: 'boardOffline', severity: 'ALERT', title: 'Bedrooms board is offline', body: 'Master bedroom and Kids room can’t be switched from the app. The wall switches still work.', link: '/diagnostics?board=esp-b51e09', createdAt: minsAgo(41) },
    { id: 'n2', kind: 'ticketReply', severity: 'INFO', title: 'Help request #1042 answered', body: 'Bilal Ahmed: I’ll come by tomorrow at 11 to look at the bedroom board’s adapter.', link: '/support/t-1042', createdAt: hoursAgo(2) },
    { id: 'n3', kind: 'automation', severity: 'WARN', title: 'Someone is at the gate', body: 'Main gate opened at 1:12 AM. Porch light on for 5 min.', link: '/devices/d-main-gate', createdAt: hoursAgo(19) },
    { id: 'n4', kind: 'powerCut', severity: 'INFO', title: 'Power is back', body: 'Power cut 2:00 – 3:03 PM (1 h 3 min). Everything came back on.', link: '/diagnostics#outages', createdAt: daysAgo(1) },
    { id: 'n5', kind: 'weeklySummary', severity: 'INFO', title: 'Iqbal House: your week', body: 'Power: 3 cuts, 4 h 12 min without power · Electricity: about 41 units, Rs 2,460 · Alerts: 2', link: '/summary?period=week', createdAt: daysAgo(4) },
    { id: 'n6', kind: 'automation', severity: 'WARN', title: 'Water tank is low', body: 'Water tank is below 20%. Turn the motor on.', link: '/devices/d-water-tank', createdAt: daysAgo(3) },
    { id: 'n7', kind: 'boardHealth', severity: 'WARN', title: 'Bedrooms board has weak Wi‑Fi', body: '−79 dBm at the bedrooms switchboard. A Wi‑Fi extender nearby usually fixes this.', link: '/diagnostics?board=esp-b51e09', createdAt: daysAgo(6) },
  ];
  return items.map((n) => ({ ...n, readAt: S.unread.has(n.id) ? null : new Date(new Date(n.createdAt).getTime() + 20 * MIN).toISOString() }));
}
const NOTICE_KINDS = [
  ['leak', 'Water leak detected', true], ['doorAtNight', 'Door or window opened at night (10 pm – 6 am)', true], ['motionAtNight', 'Motion at night (10 pm – 6 am)', false],
  ['temperature', 'Very hot or cold room (above 40 °C or below 5 °C)', true], ['scheduleFailed', 'One of my timers or schedules failed', true],
  ['boardOffline', 'A board disconnected or came back', true, 'admin'], ['boardHealth', 'A board has low voltage or weak Wi‑Fi', true, 'admin'],
  ['powerCut', 'A power cut at home (when the power is back)', true], ['awayAlert', 'A door, window or motion sensor while the home is in away mode', true],
  ['automation', 'My rules ("when this happens, tell me")', true], ['weeklySummary', 'A summary of the week, on Sunday evening', true, 'admin'],
  ['dailySummary', 'A summary of the day, every evening at 9 pm', false, 'admin'], ['summaryEmail', 'Also email me the weekly summary', true, 'admin'],
  ['billing', 'A new bill, a payment received, or a bill that is late', true, 'admin'], ['ticketReply', 'An answer to my help request', true],
  ['boardDown', 'A board has been offline for an hour, or an area power cut (staff)', true, 'staff'], ['firmware', 'A firmware rollout finished or stopped (staff)', true, 'staff'],
  ['supportRequest', 'A home owner asked for help (staff)', true, 'staff'], ['backup', 'A backup of the server failed (super admins)', true, 'staff'],
];
function prefsFor(p) {
  const staff = p === 'superadmin' || p === 'installer';
  const admin = p === 'owner' || staff;
  return NOTICE_KINDS.filter(([, , , who]) => !who || (who === 'admin' && admin) || (who === 'staff' && staff))
    .map(([key, label, def]) => ({ key, label, enabled: S.prefs[key] ?? def }));
}

/* ================================================================== tickets */
function msg(id, body, at, by, staff, extra = {}) { return { id, body, at, by, staff, event: false, ...extra }; }
function ev(id, body, at, by = null) { return { id, body, at, by, staff: true, event: true }; }
const TICKETS = () => [
  {
    id: 't-1042', number: 1042, title: 'Bedroom board keeps going offline', category: 'fault', status: 'IN_PROGRESS', priority: 'HIGH',
    home: HOME, nodeId: 'esp-b51e09', openedBy: U.fawad, assignee: U.bilal, createdAt: daysAgo(2), updatedAt: hoursAgo(2), dueAt: ahead(20 * HOUR),
    messages: [
      msg('m1', 'The bedrooms keep showing Offline, two or three times a day. The wall switches work but the app and the assistant can’t switch the fans. It started after the last power cut.', daysAgo(2), U.fawad.name, false, { mine: true }),
      ev('m2', 'Status: Being worked on', daysAgo(2) , U.mehwish.name),
      msg('m3', 'Supply is 3.08 V and Wi‑Fi is −79 dBm on that board. Looks like the 5 V adapter is going weak. Bilal will bring a new one.', daysAgo(1.9), U.mehwish.name, true),
      msg('m4', 'Customer prefers mornings. Take a spare D1 mini too in case the board itself is gone.', daysAgo(1.9), U.mehwish.name, true, { internal: true }),
      msg('m5', 'I’ll come by tomorrow at 11 to look at the bedroom board’s adapter. Please keep the bedroom accessible.', hoursAgo(2), U.bilal.name, true),
    ],
  },
  {
    id: 't-1017', number: 1017, title: 'Add a socket in the kids room', category: 'installation', status: 'RESOLVED', priority: 'NORMAL',
    home: HOME, nodeId: null, openedBy: U.ayesha, assignee: U.bilal, createdAt: daysAgo(21), updatedAt: daysAgo(15), resolvedAt: daysAgo(15), dueAt: null,
    messages: [
      msg('m1', 'Can you wire the socket next to the study table so we can switch it off at night?', daysAgo(21), U.ayesha.name, false),
      msg('m2', 'Yes, it’s one more relay on the bedrooms board. Rs 1,500 for the part and the visit. Shall I book Saturday?', daysAgo(20), U.bilal.name, true),
      msg('m3', 'Saturday is fine.', daysAgo(20), U.ayesha.name, false),
      ev('m4', 'Status: Solved', daysAgo(15), U.bilal.name),
    ],
  },
  {
    id: 't-0988', number: 988, title: 'Why is this month’s bill higher?', category: 'billing', status: 'CLOSED', priority: 'LOW',
    home: HOME, nodeId: null, openedBy: U.fawad, assignee: U.mehwish, createdAt: daysAgo(48), updatedAt: daysAgo(45), resolvedAt: daysAgo(45), dueAt: null,
    messages: [
      msg('m1', 'The invoice is Rs 5,000 instead of Rs 3,500.', daysAgo(48), U.fawad.name, false, { mine: true }),
      msg('m2', 'It includes the extra visit for the kids room socket (Rs 1,500). Next month is back to Rs 3,500.', daysAgo(47), U.mehwish.name, true),
      ev('m3', 'Status: Closed', daysAgo(45), U.mehwish.name),
    ],
  },
];
const STATUS_TEXT = { OPEN: 'Open', IN_PROGRESS: 'Being worked on', WAITING: 'Waiting for you', RESOLVED: 'Solved', CLOSED: 'Closed' };
const STAFF_SHORT = () => [U.sana, U.bilal, U.kamran, U.mehwish].map((u, i) => ({ id: u.id, name: u.name, staffRole: ['SUPERADMIN', 'INSTALLER', 'INSTALLER', 'SUPPORT'][i] }));
function ticketView(t, staffView) {
  const messages = staffView ? t.messages : t.messages.filter((m) => !m.internal);
  const lastMsg = [...messages].reverse().find((m) => !m.event);
  return {
    id: t.id, number: t.number, title: t.title, category: t.category, status: t.status, statusText: STATUS_TEXT[t.status], priority: t.priority,
    homeId: t.home.id, home: t.home.name, city: t.home.city, nodeId: t.nodeId, openedById: t.openedBy.id, openedBy: t.openedBy.name,
    assigneeId: t.assignee?.id ?? null, assignee: t.assignee?.name ?? null, dueAt: t.dueAt, overdue: !!t.dueAt && new Date(t.dueAt).getTime() < now() && ['OPEN', 'IN_PROGRESS', 'WAITING'].includes(t.status),
    createdAt: t.createdAt, updatedAt: t.updatedAt, resolvedAt: t.resolvedAt ?? null, messages,
    last: lastMsg ? { by: lastMsg.by, text: lastMsg.body.slice(0, 120), internal: !!lastMsg.internal, at: lastMsg.at } : null,
    staff: staffView ? STAFF_SHORT() : undefined,
    node: t.nodeId ? { id: t.nodeId, name: nodeOf(t.nodeId)?.name ?? t.nodeId, online: nodeOf(t.nodeId)?.online ?? true } : null,
  };
}

/* ================================================================== help center */
const HELP = [
  ['h-switch', 'switch-devices', 'Switch lights, fans and sockets', 'USAGE', 'EVERYONE', ['switch', 'light', 'fan', 'on', 'off', 'batti', 'pankha'], true, 3,
    `Tap a tile on **Home** to turn it on or off. A tile that is **on** turns amber.\n\n- **Wall switches keep working.** The app and the wall switch control the same light.\n- A grey tile with *Offline* means its board can’t be reached — see [A board is offline](/help/h-offline).\n- Say it instead: *“turn on the drawing room fan”*, or in Urdu: *“baithak ka pankha chala do”*.\n\n> Tip: press **History** on a tile to see who switched it and when.`],
  ['h-scenes', 'scenes', 'Scenes: many devices with one tap', 'USAGE', 'EVERYONE', ['scene', 'good night', 'guests', 'leaving'], true, 9,
    `A scene switches several devices at once — for example **Good night** turns every light off and the porch light on.\n\n1. Open **Automations**.\n2. Under **Scenes**, press **New scene**.\n3. Pick **On** or **Off** for each device, give it a name and save.\n\nScenes appear as chips on **Home**. You can also say *“run good night”*.`],
  ['h-timers', 'timers-and-schedules', 'Timers and schedules', 'USAGE', 'EVERYONE', ['timer', 'schedule', 'sunset', 'every day'], true, 12,
    `| Kind | Example |\n|---|---|\n| Timer | Turn the fan off in 30 minutes |\n| Schedule | Every day at 7 pm turn the porch light on |\n| Sunset | Porch light on at sunset (moves with the seasons) |\n\nThey run on the home server, even when your phone is off.`],
  ['h-family', 'invite-family-and-guests', 'Invite family and guests', 'USAGE', 'EVERYONE', ['invite', 'family', 'guest', 'access'], true, 20,
    `Owners and admins can invite people from **People**.\n\n- **Members** see only the rooms you share with them.\n- **Guests** can switch shared rooms until their link expires.\n\nEach person gets their own sign-in, so the activity log shows who did what.`],
  ['h-offline', 'board-offline', 'A board is offline or a room shows Offline', 'TROUBLESHOOTING', 'EVERYONE', ['offline', 'disconnected', 'wifi nahi'], true, 2,
    `A **board** is the small Wi‑Fi controller behind a switchboard. When it loses power or Wi‑Fi, its devices show **Offline**.\n\n**What to try**\n\n1. Check the breaker (MCB) for that room is up.\n2. Restart your Wi‑Fi router — the board rejoins by itself within a minute.\n3. Still offline after 10 minutes? Open **Diagnostics** and press **Send to support**.\n\nThe wall switches keep working the whole time.`],
  ['h-sensor', 'sensor-no-reading', 'A sensor shows no reading', 'TROUBLESHOOTING', 'EVERYONE', ['sensor', 'temperature', 'no reading', 'dash'], true, 30,
    `A dash (**–**) means the sensor hasn’t reported yet. Temperature sensors report every 30 seconds; a water level every minute.\n\nIf it stays empty for more than 5 minutes while the board is online, ask your installer to check the sensor’s wire.`],
  ['h-powercut', 'power-cut-load-shedding', 'After a power cut or load shedding', 'TROUBLESHOOTING', 'EVERYONE', ['power cut', 'load shedding', 'bijli', 'UPS'], true, 6,
    `When the power comes back, each board starts in about 5 seconds and puts every switch back the way it was.\n\n**Diagnostics → Power cuts and internet** lists each cut, how long it lasted and which boards saw it.`],
  ['h-visit', 'book-a-free-visit', 'Book a free home visit', 'PROCESS', 'EVERYONE', ['visit', 'survey', 'quote'], true, 40,
    `Leave your name and number on our website. We call within one working day and book a visit.\n\nOn the visit we look at your switchboards, count what you’d like to control and give a written quote.`],
  ['h-install-day', 'installation-day', 'What happens on installation day', 'PROCESS', 'EVERYONE', ['installation', 'install day', 'electrician'], true, 45,
    `The installer fits a board behind each switchboard, names every device and checks each one with you.\n\n1. Power is switched off one room at a time.\n2. Each board is tested on your Wi‑Fi.\n3. You sign the **installation report** in the app.`],
  ['h-escalate', 'support-escalation', 'Escalating a support ticket', 'PROCESS', 'STAFF', ['ticket', 'escalate', 'urgent', 'SLA'], true, 15,
    `Urgent tickets (sparks, smoke, water near a board) are answered within **4 hours**, high within a day, normal within three days.\n\nIf an installer can’t visit in time, assign the ticket to a super admin and leave a **team-only note** with what was tried.`],
  ['h-warranty', 'warranty', 'Warranty on boards and installation work', 'POLICY', 'EVERYONE', ['warranty', 'guarantee', 'replacement'], false, 5,
    `*Draft for approval.*\n\n- Boards: replaced free for [[check: 12 months]] from installation.\n- Wiring work: [[check: 6 months]].\n- Not covered: damage from voltage surges without a stabiliser.`],
  ['h-privacy', 'privacy-and-data', 'Your privacy and data', 'POLICY', 'EVERYONE', ['privacy', 'data', 'voice', 'recording'], true, 60,
    `We keep what your devices did (on, off, readings) for **90 days**, to show history and work out electricity estimates.\n\nVoice is turned into text on our server and not stored. Nobody at Switchboard listens to your home.`],
  ['h-charges', 'service-visits-and-charges', 'Service visits and charges', 'POLICY', 'EVERYONE', ['charges', 'visit fee', 'price'], true, 33,
    `Visits for a fault covered by warranty are free. Other visits are **Rs 1,500** in the city, plus parts.`],
  ['h-data', 'data-usage', 'How much internet data does Switchboard use?', 'FAQ', 'EVERYONE', ['data usage', 'internet', 'MB'], true, 70,
    `Very little — about **30 MB a month** for a whole home. The boards send short text messages, never pictures or sound.`],
  ['h-internet-down', 'internet-down', 'What happens if the internet is down?', 'FAQ', 'EVERYONE', ['internet down', 'no internet', 'net nahi'], true, 18,
    `**The wall buttons keep working.** Each board remembers its devices and buttons.\n\nThe phone app can still switch things over your home Wi‑Fi without internet (board firmware 2.5 or newer). Timers wait until the connection is back.`],
  ['h-per-board', 'devices-per-board', 'How many devices can one board control?', 'FAQ', 'EVERYONE', ['how many', 'pins', 'capacity'], true, 52,
    `Usually everything on one switchboard: up to **8 switches** plus a sensor. Each light, fan, socket, sensor or wall button uses one pin.`],
];
function helpArticles() {
  return HELP.map(([id, slug, title, category, audience, tags, published, updDays, body]) => ({
    id, slug, title, category, audience, tags, body, published, updatedAt: daysAgo(updDays),
  }));
}
function helpFull(a) {
  return { ...a, createdAt: daysAgo(120), updatedBy: a.id === 'h-warranty' ? null : U.sana.name, starter: a.id === 'h-warranty' || a.id === 'h-data' };
}

/* ================================================================== the console: homes, boards, inventory */
const HOMES = [
  // id, name, city, owner, ownerPending, installer, status, steps, people, lastActivityMin
  ['home-iqbal', 'Iqbal House', 'Abbottabad', U.fawad.name, false, U.bilal, 'attention', 6, 5, 25],
  ['home-butt', 'Butt Residence', 'Lahore', 'Saad Butt', false, U.kamran, 'live', 6, 6, 8],
  ['home-chaudhry', 'Chaudhry Villa', 'Lahore', 'Nadia Chaudhry', false, U.bilal, 'setup', 3, 2, 190],
  ['home-khan', 'Khan Manzil', 'Islamabad', 'Imran Khan Yousafzai', false, U.bilal, 'live', 6, 7, 3],
  ['home-siddiqui', 'Siddiqui Apartment', 'Karachi', 'Hira Siddiqui', false, U.kamran, 'attention', 6, 3, 61],
  ['home-raza', 'Raza House', 'Islamabad', 'Ahmed Raza', true, U.bilal, 'setup', 5, 0, 1440],
  ['home-malik', 'Malik Farmhouse', 'Lahore', 'Tariq Malik', false, U.kamran, 'live', 6, 4, 33],
  ['home-shah', 'Shah Residence', 'Karachi', 'Faraz Shah', false, U.kamran, 'archived', 6, 0, 60 * 24 * 40],
];
const homeById = (id) => HOMES.find((h) => h[0] === id);

// inventory: id, board, status, homeId, location, online, firmware, devices, cond, condText, addedDays, note, rssi
const INVENTORY = [
  ['esp-3a91f2', 'NODEMCU_V3', 'ADOPTED', 'home-iqbal', 'Drawing room', true, '2.6.1', 6, 'ok', 'Healthy', 230, null, -58],
  ['esp-7c04be', 'NODEMCU_V2', 'ADOPTED', 'home-iqbal', 'Kitchen', true, '2.6.1', 5, 'warn', 'Fair Wi‑Fi', 230, null, -71],
  ['esp-b51e09', 'WEMOS_D1_MINI', 'ADOPTED', 'home-iqbal', 'Bedrooms', false, '2.5.2', 4, 'bad', 'Offline · 42 min', 230, null, -79],
  ['esp-1f62ac', 'NODEMCU_V3', 'ADOPTED', 'home-butt', 'Lounge', true, '2.6.1', 7, 'ok', 'Healthy', 160, null, -54],
  ['esp-1f62b4', 'NODEMCU_V3', 'ADOPTED', 'home-butt', 'Kitchen', true, '2.6.1', 4, 'ok', 'Healthy', 160, null, -61],
  ['esp-1f62d0', 'NODEMCU_V3', 'ADOPTED', 'home-butt', 'Bedrooms', true, '2.6.0', 6, 'ok', 'Healthy', 160, null, -63],
  ['esp-8e2a17', 'NODEMCU_V2', 'ADOPTED', 'home-khan', 'Living room', true, '2.6.1', 8, 'ok', 'Healthy', 120, null, -49],
  ['esp-8e2a3c', 'NODEMCU_V2', 'ADOPTED', 'home-khan', 'Dining', true, '2.6.1', 5, 'ok', 'Healthy', 120, null, -57],
  ['esp-8e2a41', 'NODEMCU_V2', 'ADOPTED', 'home-khan', 'Guest room', true, '2.6.1', 3, 'ok', 'Healthy', 120, null, -66],
  ['esp-8e2a5d', 'WEMOS_D1_MINI', 'ADOPTED', 'home-khan', 'Garage', true, '2.6.1', 2, 'ok', 'Healthy', 118, null, -69],
  ['esp-c40d77', 'NODEMCU_V3', 'ADOPTED', 'home-siddiqui', 'Lounge', true, '2.5.2', 6, 'warn', 'Weak Wi‑Fi', 90, null, -83],
  ['esp-c40d9a', 'NODEMCU_V3', 'ADOPTED', 'home-siddiqui', 'Bedroom', true, '2.6.1', 4, 'ok', 'Healthy', 90, null, -64],
  ['esp-5b7710', 'NODEMCU_V3', 'ADOPTED', 'home-malik', 'Main hall', true, '2.6.1', 8, 'ok', 'Healthy', 75, null, -52],
  ['esp-5b7738', 'NODEMCU_V3', 'ADOPTED', 'home-malik', 'Pump room', true, '2.6.1', 3, 'ok', 'Healthy', 75, null, -70],
  ['esp-d09f41', 'NODEMCU_V3', 'ADOPTED', 'home-raza', 'Lounge', true, '2.6.1', 5, 'ok', 'Healthy', 30, null, -60],
  ['esp-d09f5e', 'WEMOS_D1_MINI', 'ADOPTED', 'home-raza', 'Bedrooms', true, '2.6.1', 4, 'ok', 'Healthy', 30, null, -62],
  ['esp-e7a210', 'NODEMCU_V3', 'ASSIGNED', 'home-chaudhry', null, true, '2.6.1', 0, 'info', 'Ready to install', 14, null, -59],
  ['esp-e7a22c', 'NODEMCU_V3', 'ASSIGNED', 'home-chaudhry', null, false, null, 0, 'mute', 'Waiting for power', 14, null, null],
  ['esp-f1c093', 'NODEMCU_V3', 'STOCK', null, null, false, null, 0, 'mute', 'On the shelf', 6, null, null],
  ['esp-f1c0a8', 'NODEMCU_V3', 'STOCK', null, null, false, null, 0, 'mute', 'On the shelf', 6, null, null],
  ['esp-f1c0b2', 'NODEMCU_V2', 'STOCK', null, null, false, null, 0, 'mute', 'On the shelf', 6, null, null],
  ['esp-f1c0c7', 'WEMOS_D1_MINI', 'STOCK', null, null, false, null, 0, 'mute', 'On the shelf', 3, 'Spare for Abbottabad', null],
  ['esp-27b4e1', 'NODEMCU_V2', 'FAULTY', null, null, false, '2.4.0', 0, 'bad', 'Faulty', 300, 'Relay pin D2 stuck; returned from Shah Residence', null],
  ['esp-0aa3f9', 'NODEMCU_V3', 'ADOPTED', 'home-shah', 'Lounge', false, '2.4.0', 5, 'mute', 'Archived home', 400, null, null],
];
const invByHome = (id) => INVENTORY.filter((b) => b[3] === id);

function homeRows(p) {
  return HOMES
    .filter((h) => p !== 'installer' || h[5].id === U.bilal.id)
    .map(([id, name, city, owner, ownerPending, installer, status, steps, people, lastMin]) => {
      const boards = invByHome(id);
      const installed = boards.filter((b) => b[2] === 'ADOPTED');
      const tone = status === 'live' ? 'ok' : status === 'setup' ? 'info' : status === 'archived' ? 'mute' : (installed.some((b) => b[8] === 'bad') ? 'bad' : 'warn');
      const worst = installed.find((b) => b[8] === 'bad') ?? installed.find((b) => b[8] === 'warn');
      const statusLabel = status === 'live' ? 'Live' : status === 'setup' ? 'Setting up' : status === 'archived' ? 'Archived' : worst?.[9].startsWith('Offline') ? 'Board offline' : worst?.[9] ?? 'Needs attention';
      const last = minsAgo(lastMin);
      return {
        id, name, city, timezone: TZ, owner: ownerPending ? null : owner, ownerPending, installer: installer.name, installerId: installer.id,
        status, tone, statusLabel, steps, stepFlags: [0, 1, 2, 3, 4, 5].map((i) => i < steps), boardsOnline: installed.filter((b) => b[5]).length,
        boardsTotal: boards.length, boardsInstalled: installed.length, people, lastActivity: last, lastActivityLabel: agoLabel(last),
      };
    });
}

function inventoryView() {
  return {
    boards: INVENTORY.map(([id, board, status, homeId, location, online, firmware, devices, cond, condText, addedDays, note]) => {
      const h = homeId ? homeById(homeId) : null;
      const added = daysAgo(addedDays);
      return {
        id, board, model: BOARDS[board].name, status, homeId, homeName: h?.[1] ?? null, location,
        installerId: status === 'ASSIGNED' || status === 'ADOPTED' ? h?.[5].id ?? null : null, installer: status === 'ASSIGNED' || status === 'ADOPTED' ? h?.[5].name ?? null : null,
        firmware, firmwareOld: !!firmware && firmware < CURRENT_FIRMWARE, mac: firmware || online ? `5C:CF:7F:${id.slice(4, 6)}:${id.slice(6, 8)}:${id.slice(8, 10)}`.toUpperCase() : null,
        ip: online ? `192.168.1.${40 + (parseInt(id.slice(-2), 16) % 50)}` : null, online,
        lastSeen: online ? 'just now' : status === 'STOCK' ? 'never' : id === 'esp-b51e09' ? '42 min ago' : '40 d ago',
        cond, condText, note, devices, addedAt: added, added: new Date(added).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      };
    }),
    homes: HOMES.filter((h) => h[6] !== 'archived').map((h) => ({ id: h[0], name: h[1], installerId: h[5].id })),
    installers: [{ id: U.bilal.id, name: U.bilal.name, staffRole: 'INSTALLER' }, { id: U.kamran.id, name: U.kamran.name, staffRole: 'INSTALLER' }, { id: U.sana.id, name: U.sana.name, staffRole: 'SUPERADMIN' }],
    currentFirmware: CURRENT_FIRMWARE,
    models: Object.values(BOARDS).map((b) => ({ type: b.type, name: b.name })),
  };
}

const STEP_TITLES = [
  ['Home created', 'Owner, address and time zone', ''],
  ['Boards assigned', 'Picked from inventory', 'Assign boards'],
  ['Boards installed and online', 'The installer powers them on site', 'Install boards'],
  ['Devices and pins configured', 'Lights, sensors, wall buttons', 'Configure pins'],
  ['Rooms and access', 'Group devices, decide who sees what', 'Set up rooms'],
  ['Handed over to owner', 'The owner accepts the invite', 'Send owner invite'],
];
const OTHER_ROOMS = ['Lounge', 'Kitchen', 'Master bedroom', 'Guest room', 'Garage'];
function workspace(id) {
  const row = homeRows('superadmin').find((h) => h.id === id);
  if (!row) return null;
  const h = homeById(id);
  const boards = invByHome(id).map(([bid, board, status, , location, online, firmware, devices, cond, condText, , , rssi]) => ({
    id: bid, name: location ?? bid, location: status === 'ADOPTED' ? location : null, board, model: BOARDS[board].name, status, online, cond, condText,
    firmware, firmwareOld: !!firmware && firmware < CURRENT_FIRMWARE, devices, pinsUsed: devices + (bid === 'esp-3a91f2' || bid === 'esp-7c04be' ? 1 : 0), pinsTotal: 11,
    rssi, vcc: online ? 3200 + Math.round(noise(bid.length, rssi ?? 1) * 120) : null, lastSeenAt: online ? minsAgo(0.3) : bid === 'esp-b51e09' ? minsAgo(42) : null,
    lastSeen: online ? 'just now' : bid === 'esp-b51e09' ? '42 min ago' : 'never',
  }));
  const isIqbal = id === 'home-iqbal';
  const rooms = isIqbal
    ? ROOMS.map((r) => {
      const ds = S.devices.filter((d) => d.roomId === r.id);
      return { id: r.id, name: r.name, devices: ds.length, on: ds.filter((d) => d.state.on && nodeOf(d.nodeId).online).length, offline: ds.some((d) => !nodeOf(d.nodeId).online), boards: [...new Set(ds.map((d) => d.nodeId))] };
    })
    : row.steps >= 5 ? OTHER_ROOMS.slice(0, 3 + (id.length % 3)).map((name, i) => ({ id: `${id}-r${i}`, name, devices: 2 + i, on: i % 2, offline: false, boards: boards.filter((b) => b.status === 'ADOPTED').slice(0, 1).map((b) => b.id) })) : [];
  const devices = boards.reduce((s, b) => s + b.devices, 0);
  const flags = row.stepFlags;
  const next = flags.indexOf(false);
  const steps = STEP_TITLES.map(([title, detail, action], i) => ({ n: i + 1, title, detail, action, done: flags[i], current: i === next }));
  if (flags[1]) steps[1].detail = `${boards.length} board${boards.length === 1 ? '' : 's'} from inventory`;
  if (flags[2]) steps[2].detail = `${row.boardsOnline} of ${row.boardsInstalled} online`;
  if (flags[3]) steps[3].detail = `${devices} devices`;
  if (flags[4]) steps[4].detail = `${rooms.length} rooms`;
  if (!row.ownerPending && flags[5]) steps[5].detail = `${row.owner} joined`;
  if (row.ownerPending) steps[5].detail = `Invite sent to ${h[3]} ${agoLabel(daysAgo(1))}`;
  return {
    home: {
      id, name: row.name, city: row.city, timezone: TZ, archived: row.status === 'archived', createdAt: daysAgo(isIqbal ? 232 : 120),
      owner: row.ownerPending ? null : { id: isIqbal ? U.fawad.id : `${id}-owner`, name: h[3], email: isIqbal ? U.fawad.email : `${h[3].split(' ')[0].toLowerCase()}@gmail.com` },
      ownerInvite: row.ownerPending ? { email: `${h[3].split(' ')[0].toLowerCase()}.${h[3].split(' ').at(-1).toLowerCase()}@gmail.com`, name: h[3], sentAt: daysAgo(1) } : null,
      installer: { id: h[5].id, name: h[5].name, email: h[5].email }, status: row.status, statusLabel: row.statusLabel, tone: row.tone,
    },
    steps, stepsDone: row.steps,
    stats: { boardsOnline: row.boardsOnline, boardsTotal: row.boardsTotal, devices, people: row.people + 1 },
    boards, rooms, unroomed: 0, currentFirmware: CURRENT_FIRMWARE,
  };
}

function overview() {
  const rows = homeRows('superadmin').filter((h) => h.status !== 'archived');
  const installed = INVENTORY.filter((b) => b[2] === 'ADOPTED' && b[3] !== 'home-shah');
  const bars = Array.from({ length: 24 }, (_, i) => {
    const start = new Date(Math.floor(now() / HOUR) * HOUR - (23 - i) * HOUR);
    const hourPk = (start.getUTCHours() + 5) % 24;
    const base = hourPk >= 6 && hourPk <= 23 ? 40 + 50 * Math.sin(((hourPk - 6) / 17) * Math.PI) : 6;
    const ok = Math.round(base * (0.8 + noise(i, 2) * 0.4));
    return { hour: start.toISOString(), ok, bad: noise(i, 9) > 0.8 ? 1 + Math.round(noise(i, 4) * 3) : 0 };
  });
  const commands = bars.reduce((s, b) => s + b.ok + b.bad, 0);
  const failed = bars.reduce((s, b) => s + b.bad, 0);
  const attention = [
    { tone: 'bad', title: 'Bedrooms board offline', homeId: 'home-iqbal', home: 'Iqbal House', detail: 'esp-b51e09 · last seen 42 min ago', at: minsAgo(42), tab: 'diagnostics', nodeId: 'esp-b51e09' },
    { tone: 'warn', title: 'Weak Wi‑Fi', homeId: 'home-siddiqui', home: 'Siddiqui Apartment', detail: 'esp-c40d77 · −83 dBm at the lounge switchboard', at: minsAgo(1), tab: 'diagnostics', nodeId: 'esp-c40d77' },
    { tone: 'info', title: 'Boards ready to install', homeId: 'home-chaudhry', home: 'Chaudhry Villa', detail: '2 boards assigned to Bilal Ahmed', at: null, tab: 'boards' },
    { tone: 'info', title: 'Owner hasn’t joined', homeId: 'home-raza', home: 'Raza House', detail: 'The owner invite is waiting to be accepted', at: null, tab: 'people' },
    { tone: 'info', title: '3 visit requests waiting for a call', homeId: '', home: 'Website', detail: 'People who booked a free home visit on the website', at: hoursAgo(26), tab: '', href: '/console/requests' },
  ];
  return {
    generatedAt: new Date().toISOString(),
    kpis: {
      homes: rows.length, settingUp: rows.filter((h) => h.status === 'setup').length, people: rows.reduce((s, h) => s + h.people, 0), staff: 5,
      boardsInstalled: installed.length, boardsOnline: installed.filter((b) => b[5]).length,
      inStock: INVENTORY.filter((b) => b[2] === 'STOCK').length, assigned: INVENTORY.filter((b) => b[2] === 'ASSIGNED').length,
      commands, confirmed: commands ? (commands - failed) / commands : 1, failed, byChannel: { web: Math.round(commands * 0.41), app: Math.round(commands * 0.27), voice: Math.round(commands * 0.12), automation: Math.round(commands * 0.2) },
    },
    attention, visitsWaiting: 3, attentionCount: attention.length,
    services: [
      { key: 'api', name: 'API server', ok: true, line: 'Up 12 d 4 h · 182 MB memory', metric: '' },
      { key: 'database', name: 'Database', ok: true, line: '64 MB', metric: '3 ms' },
      { key: 'broker', name: 'MQTT broker', ok: true, line: `${installed.filter((b) => b[5]).length} boards connected`, metric: '' },
      { key: 'assistant', name: 'Voice assistant', ok: true, line: 'qwen2.5-7b-instruct · whisper-small', metric: '412 ms' },
      { key: 'scheduler', name: 'Scheduler', ok: true, line: '23 active · next “Porch light at sunset” in 1 h 12 min', metric: '' },
    ],
    allOk: true, bars, currentFirmware: CURRENT_FIRMWARE,
  };
}

function visitRequests() {
  const list = [
    ['v1', 'Rabia Nawaz', '+92 300 4512 887', 'Lahore', '10 Marla house', 'NEW', 'Wants the motor and geyser on a timer.', 26 * 60],
    ['v2', 'Asad Mehmood', '+92 321 9087 112', 'Islamabad', '1 Kanal house', 'NEW', '', 5 * 60],
    ['v3', 'Sobia Akhtar', '+92 333 2201 554', 'Karachi', '3-bed apartment', 'NEW', 'Asked about load shedding and UPS.', 50],
    ['v4', 'Haris Qureshi', '+92 345 6610 090', 'Abbottabad', '5 Marla house', 'CONTACTED', 'Called, will confirm after Friday.', 3 * 1440],
    ['v5', 'Mariam Sheikh', '+92 301 7788 231', 'Lahore', '1 Kanal house', 'SCHEDULED', 'Visit Sat 11 am · DHA Phase 5', 4 * 1440],
    ['v6', 'Nadia Chaudhry', '+92 300 1122 334', 'Lahore', '2 Kanal villa', 'CUSTOMER', 'Became Chaudhry Villa.', 20 * 1440],
    ['v7', 'Ahmed Raza', '+92 312 5566 778', 'Islamabad', '10 Marla house', 'CUSTOMER', 'Became Raza House.', 35 * 1440],
    ['v8', 'Junaid Iftikhar', '+92 336 4455 667', 'Karachi', 'Shop', 'CLOSED', 'Wanted a shop alarm only — not a fit.', 15 * 1440],
  ];
  const LABEL = { NEW: 'New', CONTACTED: 'Called', SCHEDULED: 'Visit booked', CUSTOMER: 'Customer', CLOSED: 'Not now' };
  const requests = list.map(([id, name, phone, city, homeSize, status0, note, m]) => {
    const status = S.visitStatus[id] ?? status0;
    return {
      id, name, phone, city, homeSize, status, statusLabel: LABEL[status], note, createdAt: minsAgo(m), updatedAt: minsAgo(Math.max(1, m - 30)),
      home: id === 'v6' ? { id: 'home-chaudhry', name: 'Chaudhry Villa' } : id === 'v7' ? { id: 'home-raza', name: 'Raza House' } : null,
      handledBy: status === 'NEW' ? null : U.mehwish.name,
    };
  });
  const counts = { NEW: 0, CONTACTED: 0, SCHEDULED: 0, CUSTOMER: 0, CLOSED: 0 };
  for (const r of requests) counts[r.status]++;
  return { counts, requests };
}

function consoleTickets() {
  const mk = (id, number, title, category, status, priority, homeId, opener, assignee, createdH, updatedH, dueH, body) => {
    const h = homeById(homeId);
    return {
      id, number, title, category, status, priority, home: { id: h[0], name: h[1], city: h[2] }, nodeId: null, openedBy: opener, assignee,
      createdAt: hoursAgo(createdH), updatedAt: hoursAgo(updatedH), dueAt: dueH === null ? null : dueH >= 0 ? ahead(dueH * HOUR) : hoursAgo(-dueH),
      resolvedAt: ['RESOLVED', 'CLOSED'].includes(status) ? hoursAgo(updatedH) : null,
      messages: [msg(`${id}-m1`, body, hoursAgo(createdH), opener.name, false)],
    };
  };
  return [
    ...TICKETS(),
    mk('t-1051', 1051, 'Sparks from the lounge switchboard', 'fault', 'OPEN', 'URGENT', 'home-siddiqui', { id: 'o-hira', name: 'Hira Siddiqui' }, null, 3, 3, -1, 'There was a small spark and a burning smell when I pressed the lounge fan switch. I have switched off the breaker.'),
    mk('t-1049', 1049, 'Motor doesn’t switch on from the app', 'fault', 'WAITING', 'HIGH', 'home-malik', { id: 'o-tariq', name: 'Tariq Malik' }, U.kamran, 30, 6, 18, 'The pump room motor shows On in the app but the motor does not start.'),
    mk('t-1047', 1047, 'Add the guest room AC to the app', 'installation', 'OPEN', 'NORMAL', 'home-khan', { id: 'o-imran', name: 'Imran Khan Yousafzai' }, U.bilal, 50, 50, 22, 'We had a new AC installed in the guest room. Can it be added?'),
    mk('t-1044', 1044, 'Invoice shows the wrong address', 'billing', 'IN_PROGRESS', 'LOW', 'home-butt', { id: 'o-saad', name: 'Saad Butt' }, U.mehwish, 70, 20, 50, 'Our address is Phase 6, not Phase 5.'),
    mk('t-1039', 1039, 'How do I give my driver gate access?', 'question', 'RESOLVED', 'NORMAL', 'home-khan', { id: 'o-imran', name: 'Imran Khan Yousafzai' }, U.mehwish, 120, 100, null, 'Can the driver open only the gate and nothing else?'),
  ];
}

function staffList(p) {
  const me = p === 'installer' ? U.bilal.id : U.sana.id;
  const people = [
    [U.sana, 'SUPERADMIN', 0, 400, true], [U.danish, 'SUPERADMIN', 0, 380, false], [U.bilal, 'INSTALLER', 4, 260, true],
    [U.kamran, 'INSTALLER', 4, 190, false], [U.mehwish, 'SUPPORT', 0, 150, true],
  ].map(([u, role, homes, sinceDays, twoFactor]) => ({
    id: u.id, name: u.name, email: u.email, staffRole: role, roleLabel: { SUPERADMIN: 'Super admin', INSTALLER: 'Installer', SUPPORT: 'Support' }[role],
    disabled: false, homes, since: daysAgo(sinceDays), me: u.id === me, twoFactor,
  }));
  return {
    people,
    invites: [{ id: 'si-1', email: 'waqas.installer@gmail.com', name: 'Waqas Anjum', staffRole: 'INSTALLER', sentAt: daysAgo(1), expiresAt: ahead(6 * DAY) }],
  };
}

function platformAudit(homeId, category) {
  const rows = [
    ...AUDIT_HOME(),
    ...[
      ['p1', minsAgo(18), U.sana.name, 'Super admin', false, 'inventory.add', 'system', '4 boards added to stock', null],
      ['p2', hoursAgo(5), U.bilal.name, 'Installer', false, 'node.assign', 'setup', 'esp-e7a210, esp-e7a22c → Chaudhry Villa', 'home-chaudhry'],
      ['p3', daysAgo(1), U.sana.name, 'Super admin', false, 'home.create', 'setup', 'Raza House · Islamabad', 'home-raza'],
      ['p4', daysAgo(1), U.sana.name, 'Super admin', false, 'user.invite', 'access', 'Ahmed Raza as owner', 'home-raza'],
      ['p5', daysAgo(2), U.kamran.name, 'Installer', false, 'node.adopt', 'setup', 'esp-5b7738 · Pump room', 'home-malik'],
      ['p6', daysAgo(3), 'System', 'System', true, 'invoice.paid', 'billing', 'Invoice #2044 · Rs 4,500 · JazzCash', 'home-butt'],
      ['p7', daysAgo(4), U.sana.name, 'Super admin', false, 'staff.invite', 'access', 'Waqas Anjum as installer', null],
      ['p8', daysAgo(6), U.sana.name, 'Super admin', false, 'firmware.rollout', 'system', 'Rollout 2.6.1 started · waves of 3', null],
    ].map(([id, at, who, role, system, action, category, target, hid]) => ({ id, at, when: whenLabel(at), who, role, system, action, category, target, homeId: hid, homeName: hid ? homeById(hid)[1] : '—' })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return rows.filter((r) => (!homeId || r.homeId === homeId) && (!category || category === 'all' || r.category === category));
}

function rollouts() {
  const targets = INVENTORY.filter((b) => b[2] === 'ADOPTED' && b[3] !== 'home-shah').map(([id, , , homeId, location, online, firmware, , , , , , rssi], i) => {
    const done = firmware === CURRENT_FIRMWARE;
    const status = done ? 'DONE' : !online ? 'SKIPPED' : i % 2 ? 'SENT' : 'PENDING';
    return {
      id: `rt-${id}`, nodeId: id, name: location, home: homeById(homeId)[1], homeId, online, rssi, firmware, wave: Math.floor(i / 3) + 1, status,
      fromVersion: done ? '2.5.2' : firmware, sentAt: status === 'DONE' || status === 'SENT' ? hoursAgo(20 - i) : null, doneAt: done ? hoursAgo(19.5 - i) : null,
      note: status === 'SKIPPED' ? 'Offline when its wave started' : null,
    };
  });
  const counts = { total: targets.length, pending: 0, sent: 0, done: 0, failed: 0, skipped: 0 };
  for (const t of targets) counts[t.status.toLowerCase()]++;
  return {
    images: [
      { id: 'fw-261', version: '2.6.1', notes: 'Fixes a rare reboot when a wall switch bounces; faster reconnect after a power cut.', createdAt: daysAgo(6) },
      { id: 'fw-260', version: '2.6.0', notes: 'Local control from the phone app without internet. Gestures on push-buttons.', createdAt: daysAgo(34) },
      { id: 'fw-252', version: '2.5.2', notes: 'Supply voltage on boards without an analog sensor.', createdAt: daysAgo(70) },
    ],
    canEdit: true,
    rollouts: [
      { id: 'ro-261', version: '2.6.1', status: 'RUNNING', wave: 4, waves: 6, waveSize: 3, waveGapMin: 30, maxFailures: 2, daytimeOnly: true, skipWeak: true,
        nextWaveAt: ahead(14 * MIN), haltReason: null, createdAt: daysAgo(1), finishedAt: null, counts, targets },
      { id: 'ro-260', version: '2.6.0', status: 'DONE', wave: 5, waves: 5, waveSize: 3, waveGapMin: 30, maxFailures: 2, daytimeOnly: true, skipWeak: true,
        nextWaveAt: null, haltReason: null, createdAt: daysAgo(33), finishedAt: daysAgo(32), counts: { total: 14, pending: 0, sent: 0, done: 14, failed: 0, skipped: 0 }, targets: [] },
    ],
  };
}

function staffOutages(days) {
  const home = homeOutages(days);
  const outages = home.outages.map((o) => ({ ...o, home: HOME.name, homeId: HOME.id }));
  const extra = [];
  for (let i = 0; i < days; i += 2) {
    const start = pkAt(i, 12, 0);
    extra.push({ id: `so-l-${i}`, kind: 'POWER', label: 'Power cut', board: 'Lounge', startedAt: start, endedAt: new Date(new Date(start).getTime() + 2 * HOUR).toISOString(), seconds: 7200, reset: 'Power On', home: 'Siddiqui Apartment', homeId: 'home-siddiqui' });
  }
  if (days >= 7) extra.push({ id: 'so-n-1', kind: 'NETWORK', label: 'Wi‑Fi or internet down', board: 'Main hall', startedAt: pkAt(3, 9, 30), endedAt: pkAt(3, 10, 15), seconds: 2700, reset: null, home: 'Malik Farmhouse', homeId: 'home-malik' });
  const all = [...outages, ...extra].filter((o) => new Date(o.startedAt).getTime() < now());
  const by = (hid) => all.filter((o) => o.homeId === hid);
  const homes = ['home-iqbal', 'home-siddiqui', 'home-malik'].map((hid) => {
    const l = by(hid);
    const pw = l.filter((o) => o.kind === 'POWER');
    const uniq = new Map(pw.map((o) => [o.startedAt, o]));
    return { homeId: hid, home: homeById(hid)[1], power: uniq.size, powerSeconds: [...uniq.values()].reduce((s, o) => s + o.seconds, 0), network: l.filter((o) => o.kind === 'NETWORK').length, networkSeconds: l.filter((o) => o.kind === 'NETWORK').reduce((s, o) => s + o.seconds, 0), crashes: l.filter((o) => o.kind === 'CRASH').length };
  });
  return {
    days, homes,
    areas: [{ place: 'Abbottabad, Khyber Pakhtunkhwa', startedAt: pkAt(1, 14, 0), endedAt: pkAt(1, 15, 3), seconds: 3780, homes: ['Iqbal House'] }],
    down: [{ boardId: 'esp-b51e09', board: 'Bedrooms', homeId: 'home-iqbal', home: 'Iqbal House', place: 'Abbottabad, Khyber Pakhtunkhwa', since: minsAgo(42) }],
    outages: all,
  };
}

function orgDetails() {
  const rows = homeRows('superadmin').filter((h) => h.status !== 'archived');
  return {
    id: ORG.id, name: ORG.name, plan: 'BUSINESS', status: 'ACTIVE', trialEndsAt: null, billingEmail: 'accounts@switchboard.pk', billingName: 'Switchboard Services (Pvt) Ltd',
    taxId: 'NTN 4471023-6', country: 'Pakistan', createdAt: daysAgo(420), logo: null, cities: ['Lahore', 'Islamabad', 'Abbottabad', 'Karachi'], teamSize: '2-5', onboarded: true,
    usage: { homes: rows.length, boards: INVENTORY.filter((b) => b[2] !== 'FAULTY').length, staff: 5 },
    limits: { homes: null, boards: null, staff: null }, selfHosted: true,
    plans: [
      { id: 'STARTER', name: 'Starter', priceUsd: 0, homes: 5, boards: 25, staff: 3, blurb: 'For a single installer getting started' },
      { id: 'PRO', name: 'Pro', priceUsd: 49, homes: 50, boards: 300, staff: 15, blurb: 'For a growing installation business' },
      { id: 'BUSINESS', name: 'Business', priceUsd: 199, homes: null, boards: null, staff: null, blurb: 'Unlimited homes, boards and staff' },
    ],
    paymentsConnected: false,
  };
}

const CONTRACTS = () => [
  ['c-iqbal', 'home-iqbal', 'Care plan', 3500, 'MONTHLY', 2, 232],
  ['c-butt', 'home-butt', 'Care plan plus', 4500, 'MONTHLY', 4, 160],
  ['c-khan', 'home-khan', 'Care plan plus', 12000, 'QUARTERLY', 3, 120],
  ['c-malik', 'home-malik', 'Farmhouse yearly', 42000, 'YEARLY', 6, 75],
  ['c-siddiqui', 'home-siddiqui', 'Care plan', 3500, 'MONTHLY', 2, 90],
].map(([id, homeId, plan, amount, period, visits, startDays]) => {
  const h = homeById(homeId);
  const months = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 }[period];
  return {
    id, homeId, home: h[1], city: h[2], plan, amount, period, periodText: { MONTHLY: 'every month', QUARTERLY: 'every 3 months', YEARLY: 'every year' }[period],
    perMonth: Math.round(amount / months), visitsIncluded: visits, startsOn: pkDay(now() - startDays * DAY), endsOn: null,
    nextInvoiceOn: pkDay(now() + (8 + startDays % 20) * DAY), status: 'ACTIVE', notes: homeId === 'home-malik' ? 'Includes the pump room board.' : '',
  };
});
const INVOICES = () => [
  ['i-2052', 2052, 'home-iqbal', 'c-iqbal', 'Care plan · October', 3500, 2, 'DUE', null],
  ['i-2051', 2051, 'home-butt', 'c-butt', 'Care plan plus · October', 4500, 3, 'PAID', 'JAZZCASH'],
  ['i-2049', 2049, 'home-siddiqui', 'c-siddiqui', 'Care plan · October', 3500, 16, 'DUE', null],
  ['i-2046', 2046, 'home-khan', 'c-khan', 'Care plan plus · Oct – Dec', 12000, 17, 'PAID', 'BANK'],
  ['i-2044', 2044, 'home-butt', null, 'Extra visit · new socket', 1500, 25, 'PAID', 'CASH'],
  ['i-2040', 2040, 'home-iqbal', 'c-iqbal', 'Care plan · September', 3500, 32, 'PAID', 'EASYPAISA'],
  ['i-2031', 2031, 'home-iqbal', null, 'Extra visit · kids room socket', 1500, 46, 'PAID', 'CASH'],
  ['i-2029', 2029, 'home-chaudhry', null, 'Installation deposit', 25000, 14, 'VOID', null],
].map(([id, number, homeId, contractId, description, amount, issuedDays, status, method]) => {
  const h = homeById(homeId);
  const due = now() - issuedDays * DAY + 10 * DAY;
  return {
    id, number, homeId, home: h[1], city: h[2], contractId, description, amount, issuedOn: pkDay(now() - issuedDays * DAY), dueOn: pkDay(due), status,
    late: status === 'DUE' && due < now(), paidOn: status === 'PAID' ? pkDay(now() - (issuedDays - 3) * DAY) : null, method, reference: method && method !== 'CASH' ? `TX${number}88${issuedDays}` : null,
  };
});
function billingOverview() {
  const contracts = CONTRACTS();
  const invoices = INVOICES();
  const due = invoices.filter((i) => i.status === 'DUE');
  const late = due.filter((i) => i.late);
  return {
    kpis: {
      perMonth: contracts.reduce((s, c) => s + c.perMonth, 0), active: contracts.length, due: due.reduce((s, i) => s + i.amount, 0), dueCount: due.length,
      late: late.reduce((s, i) => s + i.amount, 0), lateCount: late.length, paidThisMonth: invoices.filter((i) => i.status === 'PAID' && i.paidOn >= pkDay(now() - 30 * DAY)).reduce((s, i) => s + i.amount, 0),
    },
    contracts, invoices, canEdit: true,
  };
}

function installReport(p) {
  const items = [
    ['boards', 'Every board fitted and online', true, { ok: true, text: '3 of 3 boards installed' }],
    ['devices', 'Every light, fan and socket named and tested', true, { ok: true, text: '15 devices' }],
    ['buttons', 'Wall switches still work', true, null],
    ['rooms', 'Rooms set up and family invited', true, { ok: true, text: '5 rooms · 5 people' }],
    ['safety', 'Geyser and motor have child lock and auto-off', true, null],
    ['app', 'Owner shown the app and the assistant', true, null],
    ['tidy', 'Switchboards closed and the site cleaned', true, null],
  ].map(([key, label, done, check]) => ({ key, label, done, check }));
  return {
    id: 'ir-iqbal', homeId: HOME.id, home: HOME.name, installer: U.bilal.name, items,
    notes: 'Router moved to the hallway for the bedrooms board. Motor on a separate 20 A breaker.', done: items.length, total: items.length,
    signed: true, signedName: U.fawad.name, signedAt: daysAgo(31), signature: null, photos: [], updatedAt: daysAgo(31),
    canEdit: p === 'installer' || p === 'superadmin', canReopen: p === 'superadmin', canSign: false,
  };
}

/* ================================================================== router */
const routes = [];
function on(method, pattern, handler, opts = {}) {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/\//g, '\\/').replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
  routes.push({ method, re, keys, handler, public: !!opts.public });
}
const ok = { ok: true };
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

// ---- auth
on('GET', '/auth/status', () => ({ setupNeeded: false, signupOpen: true }), { public: true });
on('GET', '/auth/me', ({ p }) => meFor(p));
on('POST', '/auth/refresh', ({ p }) => { if (p === 'anon') throw new HttpError(401, 'Not signed in'); return ok; }, { public: true });
on('POST', '/auth/login', () => meFor('owner'), { public: true });
on('POST', '/auth/login/code', () => meFor('owner'), { public: true });
on('POST', '/auth/logout', () => ok, { public: true });
on('POST', '/auth/forgot', () => ({ mail: true }), { public: true });
on('POST', '/auth/home', ({ p }) => meFor(p));
on('GET', '/auth/2fa', ({ p }) => (p === 'superadmin' || p === 'installer' ? { enabled: true, since: daysAgo(90), recoveryLeft: 8 } : { enabled: false, since: null, recoveryLeft: 0 }));
on('GET', '/auth/sessions', () => [
  { id: 'ss1', device: 'Chrome on Windows', ip: '39.40.118.27', createdAt: daysAgo(12), lastUsedAt: minsAgo(0.2), current: true },
  { id: 'ss2', device: 'Switchboard app on Android', ip: '39.40.118.27', createdAt: daysAgo(60), lastUsedAt: minsAgo(35), current: false },
  { id: 'ss3', device: 'Safari on iPhone', ip: '182.185.44.9', createdAt: daysAgo(20), lastUsedAt: daysAgo(2), current: false },
]);
on('GET', '/auth/reset/:token', () => ({ name: U.hamza.name, email: U.hamza.email, expiresAt: ahead(2 * DAY), madeByOther: true }), { public: true });
on('GET', '/invites/:token', () => ({
  email: 'ali.iqbal@hotmail.com', name: 'Ali Iqbal', role: 'MEMBER', staffRole: null, homeName: HOME.name, orgName: ORG.name, orgLogo: null, inviter: U.fawad.name, expiresAt: ahead(6 * DAY),
  home: { name: HOME.name, city: HOME.city, devices: 15, installer: U.bilal.name, rooms: ROOMS.map((r) => ({ name: r.name, devices: S.devices.filter((d) => d.roomId === r.id).length })) },
  existingAccount: false, accountName: null,
}), { public: true });
on('GET', '/assistant/memory', () => [
  { id: 'mem1', text: 'The store light is the one by the stairs, on the drawing room board.', createdAt: daysAgo(9) },
  { id: 'mem2', text: 'Zainab’s room is the kids room.', createdAt: daysAgo(30) },
]);

// ---- devices, rooms, boards
on('GET', '/devices', ({ p }) => devicesFor(p));
on('GET', '/devices/:id', ({ p, params }) => {
  const d = S.devices.find((x) => x.id === params.id);
  if (!d || !accessFor(p, d.roomId)) throw new HttpError(404, 'No such device.');
  return deviceView(d, p);
});
on('GET', '/devices/:id/history', ({ params, query }) => {
  const d = S.devices.find((x) => x.id === params.id);
  if (!d) throw new HttpError(404, 'No such device.');
  return history(d).slice(0, Number(query.get('limit') ?? 200));
});
on('POST', '/devices/:id/commands', ({ p, params, body }) => {
  const d = S.devices.find((x) => x.id === params.id);
  if (!d) throw new HttpError(404, 'No such device.');
  if (!nodeOf(d.nodeId).online) throw new HttpError(409, 'The board is offline. The wall switch still works.');
  if (accessFor(p, d.roomId) === 'VIEW') throw new HttpError(403, 'You can see this device but not switch it.');
  const next = typeof body?.on === 'boolean' ? body.on : !d.state.on;
  d.state = { ...d.state, on: next };
  d.source = 'remote';
  d.updatedAt = new Date().toISOString();
  return deviceView(d, p);
});
on('PATCH', '/devices/:id', ({ p, params, body }) => {
  const d = S.devices.find((x) => x.id === params.id);
  if (!d) throw new HttpError(404, 'No such device.');
  for (const k of ['name', 'roomId', 'watts', 'childLock', 'autoOffMinutes', 'aliases', 'enabled']) if (body && k in body) d[k] = body[k];
  return deviceView(d, p);
});
on('GET', '/rooms', ({ p }) => roomsFor(p));
on('GET', '/catalog', () => CATALOG);
on('GET', '/nodes', () => S.nodes.map(nodeView));
on('GET', '/nodes/setup-info', () => ({ server: 'mqtt.switchboard.pk', port: 8883, login: 'boards', password: 'k7Qe-29fz-Lm4x', encrypted: true }));
on('GET', '/nodes/:id/health-history', ({ params, query }) => {
  const n = nodeOf(params.id) ?? S.nodes[0];
  const hours = Number(query.get('hours') ?? 24);
  const pts = [];
  const step = hours <= 6 ? 5 : hours <= 24 ? 15 : 60;
  for (let m = hours * 60; m >= 0; m -= step) {
    const i = m / step;
    const gone = !n.online && m < 42;
    pts.push({ at: minsAgo(m), rssi: gone ? null : Math.round((n.health?.rssi ?? -60) + (noise(i, 1) - 0.5) * 8), vcc: gone ? null : Math.round((n.health?.vcc ?? 3250) + (noise(i, 2) - 0.5) * 60), heap: gone ? null : Math.round((n.health?.heap ?? 26000) + (noise(i, 3) - 0.5) * 3000) });
  }
  return pts;
});
on('GET', '/nodes/:id/logs', ({ params }) => {
  const n = nodeOf(params.id) ?? S.nodes[0];
  return [
    { at: minsAgo(30), level: 'info', msg: `[web] ${U.fawad.name} → ${n.name}: Ceiling lights on`, source: 'server' },
    { at: minsAgo(29.98), level: 'info', msg: 'Switch d1 -> ON (remote)', source: 'board', uptime: 3600 },
    { at: minsAgo(12), level: 'info', msg: 'Button D3 single -> toggle kitchen_light', source: 'board', uptime: 4700 },
    { at: minsAgo(5), level: 'debug', msg: 'Heartbeat rssi=-58 heap=27840', source: 'board', uptime: 5100 },
  ];
});
on('GET', '/nodes/:id/network', () => ({ scan: [{ ssid: 'IqbalHouse-5G', rssi: -58, channel: 6, secure: true }, { ssid: 'IqbalHouse', rssi: -61, channel: 6, secure: true }, { ssid: 'PTCL-BB', rssi: -84, channel: 11, secure: true }], scanAt: minsAgo(60) }));
on('GET', '/nodes/:id/connections', ({ params }) => {
  const n = nodeOf(params.id) ?? S.nodes[0];
  return {
    tracking: true,
    current: n.online ? { ip: '39.40.118.27', place: 'Abbottabad, Khyber Pakhtunkhwa', isp: 'PTCL', ipSince: daysAgo(3), connectedSince: hoursAgo(26) } : null,
    stats: { connects24h: n.online ? 1 : 4, connects7d: n.online ? 4 : 17, ends7d: { timeout: 2, closed: 1, clean: 1, replaced: 0, error: 0 }, addresses7d: 2 },
    history: [
      { id: 'c1', ip: '39.40.118.27', place: 'Abbottabad, Khyber Pakhtunkhwa', isp: 'PTCL', connectedAt: hoursAgo(26), endedAt: n.online ? null : minsAgo(42), endReason: n.online ? null : 'timeout', endNote: null, seconds: 26 * 3600, newAddress: false },
      { id: 'c2', ip: '39.40.118.27', place: 'Abbottabad, Khyber Pakhtunkhwa', isp: 'PTCL', connectedAt: daysAgo(2.2), endedAt: hoursAgo(27), endReason: 'timeout', endNote: 'Power cut', seconds: 28 * 3600, newAddress: true },
    ],
  };
});
on('GET', '/firmware', () => rollouts().images.map((i) => ({ ...i, size: 412_000, md5: '9e107d9d372bb6826bd81d3542a419d6' })));

// ---- automations
on('GET', '/scenes', ({ p }) => scenesFor(p));
on('POST', '/scenes/:id/run', ({ params }) => {
  const s = SCENES.find((x) => x.id === params.id);
  if (!s) throw new HttpError(404, 'No such scene.');
  let n = 0;
  for (const [id, onv] of s.actions) {
    const d = S.devices.find((x) => x.id === id);
    if (d && nodeOf(d.nodeId).online) { d.state = { ...d.state, on: onv }; d.updatedAt = new Date().toISOString(); d.source = 'automation'; n++; }
  }
  const skipped = s.actions.length - n;
  return { ok: skipped === 0, summary: `${n} switched${skipped ? `, ${skipped} skipped (board offline)` : ''}` };
});
on('GET', '/schedules', () => schedules());
on('PATCH', '/schedules/:id', ({ params, body }) => { if (typeof body?.enabled === 'boolean') S.schedulesEnabled[params.id] = body.enabled; return ok; });
on('GET', '/rules', () => rules());
on('PATCH', '/rules/:id', ({ params, body }) => { if (typeof body?.enabled === 'boolean') S.rulesEnabled[params.id] = body.enabled; return ok; });

// ---- the home
on('GET', '/home/location', () => location());
on('GET', '/home/away', () => awayView());
on('PUT', '/home/away', ({ p, body }) => {
  if (typeof body?.on === 'boolean') S.away = { ...S.away, on: body.on, since: body.on ? new Date().toISOString() : null, by: body.on ? meFor(p)?.name ?? null : null };
  if (Array.isArray(body?.lights)) S.away.lights = body.lights;
  return awayView();
});
on('PUT', '/home/tariff', ({ body }) => { S.tariff = typeof body?.tariff === 'number' ? body.tariff : 60; return ok; });
on('GET', '/home/installation', ({ p }) => installReport(p));
on('GET', '/home/activity', ({ query }) => {
  const cat = query.get('category');
  return AUDIT_HOME().filter((r) => !cat || cat === 'all' || r.category === cat);
});
on('GET', '/home/summary', ({ query }) => {
  const period = query.get('period') === 'day' ? 'day' : 'week';
  const days = period === 'day' ? 1 : 7;
  const e = energy(days);
  const o = homeOutages(days).summary;
  const fmt = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: TZ });
  const range = period === 'day' ? fmt(now()) : `${fmt(now() - 6 * DAY)} – ${fmt(now())}`;
  const hm = (s) => `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
  const lines = [
    o.powerCuts ? `Power: ${o.powerCuts} cut${o.powerCuts === 1 ? '' : 's'}, ${hm(o.powerSeconds)} without power` : 'Power: no power cuts',
    ...(o.networkOuts ? [`Internet: down ${o.networkOuts} time${o.networkOuts === 1 ? '' : 's'}, ${Math.round(o.networkSeconds / 60)} min in all`] : []),
    `Electricity: about ${Math.round(e.total.kwh)} units, Rs ${e.total.cost.toLocaleString('en-PK')} (most from ${e.devices[0].name})`,
    `Automations: ${period === 'day' ? 6 : 41} switches by timers, rules and away mode`,
    period === 'day' ? 'Alerts: Bedrooms board offline' : 'Alerts: gate opened at night (1), water tank low (1), Bedrooms board offline (1)',
    'Boards: Bedrooms offline now',
  ];
  const text = `*${HOME.name} — ${period === 'day' ? 'today' : 'this week'}* (${range})\n${lines.map((l) => `• ${l}`).join('\n')}`;
  return { home: HOME.name, period, range, lines, text, mail: true };
});
on('POST', '/home/summary/email', ({ p }) => ({ to: meFor(p)?.email ?? U.fawad.email }));
on('GET', '/home/welcome', () => ({
  home: { name: HOME.name, city: HOME.city }, org: { name: ORG.name, logo: null }, installer: U.bilal.name,
  rooms: ROOMS.map((r) => ({ id: r.id, name: r.name, devices: S.devices.filter((d) => d.roomId === r.id).length })), devices: S.devices.length,
  tryDevice: { id: 'd-drawing-lights', name: 'Ceiling lights', room: 'Drawing room', online: true, on: !!S.devices[0].state.on },
}));
on('POST', '/home/support', () => ({ ticket: { id: 't-1042', number: 1042 } }));
on('GET', '/energy', ({ query }) => energy(Math.max(1, Math.min(90, Number(query.get('days') ?? 7)))));
on('GET', '/outages', ({ query }) => homeOutages(Math.max(1, Math.min(90, Number(query.get('days') ?? 30)))));
on('GET', '/users', () => familyMembers());
on('GET', '/invites', () => INVITES());
on('GET', '/notifications', () => { const items = notices(); return { unread: items.filter((n) => !n.readAt).length, items }; });
on('POST', '/notifications/read', () => { S.unread.clear(); return ok; });
on('POST', '/notifications/:id/read', ({ params }) => { S.unread.delete(params.id); return ok; });
on('GET', '/notifications/prefs', ({ p }) => prefsFor(p));
on('PUT', '/notifications/prefs', ({ p, body }) => { Object.assign(S.prefs, body ?? {}); return prefsFor(p); });
on('GET', '/push/devices', () => ({ devices: 1 }));
on('GET', '/push/key', () => ({ publicKey: null }));
on('GET', '/help/feed', ({ query }) => {
  const customer = query.get('view') === 'customer';
  const list = helpArticles().filter((a) => a.published && (!customer || a.audience === 'EVERYONE'));
  return { version: 'rig-1', articles: query.get('articles') === '1' ? list.map(({ id, title, category, tags, body, updatedAt }) => ({ id, title, category, tags, body, updatedAt })) : undefined };
});
on('GET', '/support/tickets', () => TICKETS().map((t) => ticketView(t, false)));
on('GET', '/support/tickets/:id', ({ params }) => {
  const t = TICKETS().find((x) => x.id === params.id);
  if (!t) throw new HttpError(404, 'No such request.');
  return ticketView(t, false);
});
on('GET', '/billing', () => {
  const contract = CONTRACTS().find((c) => c.homeId === HOME.id);
  const invoices = INVOICES().filter((i) => i.homeId === HOME.id);
  return { company: ORG.name, contract, invoices, due: invoices.filter((i) => i.status === 'DUE').reduce((s, i) => s + i.amount, 0) };
});
on('GET', '/billing/invoices/:id', ({ params }) => {
  const inv = INVOICES().find((i) => i.id === params.id) ?? INVOICES()[0];
  const c = CONTRACTS().find((x) => x.id === inv.contractId);
  return {
    ...inv, company: { name: ORG.name, billingEmail: 'accounts@switchboard.pk', taxId: 'NTN 4471023-6', logo: null },
    billTo: { home: inv.home, city: inv.city, owner: inv.homeId === HOME.id ? { name: U.fawad.name, email: U.fawad.email } : null },
    contract: c ? { plan: c.plan, period: c.period } : null,
  };
});

// ---- platform console
const staffOnly = (p) => { if (p !== 'superadmin' && p !== 'installer') throw new HttpError(403, 'Staff only.'); };
on('GET', '/platform/overview', ({ p }) => { staffOnly(p); return overview(); });
on('GET', '/platform/homes', ({ p }) => { staffOnly(p); return homeRows(p); });
on('GET', '/platform/homes/:id', ({ p, params }) => {
  staffOnly(p);
  const ws = workspace(params.id);
  if (!ws || (p === 'installer' && homeById(params.id)[5].id !== U.bilal.id)) throw new HttpError(404, 'No such home.');
  return ws;
});
on('GET', '/platform/homes/:id/installation', ({ p }) => installReport(p));
on('GET', '/platform/inventory', ({ p }) => { staffOnly(p); return inventoryView(); });
on('GET', '/platform/visit-requests', () => visitRequests());
on('PATCH', '/platform/visit-requests/:id', ({ params, body }) => { if (body?.status) S.visitStatus[params.id] = body.status; return ok; });
on('GET', '/platform/tickets', ({ p, query }) => {
  staffOnly(p);
  const status = query.get('status');
  const mine = query.get('mine') === 'true';
  const meId = p === 'installer' ? U.bilal.id : U.sana.id;
  let list = consoleTickets();
  if (p === 'installer') list = list.filter((t) => homeById(t.home.id)[5].id === U.bilal.id);
  const all = list.map((t) => ticketView(t, true));
  const openSet = ['OPEN', 'IN_PROGRESS', 'WAITING'];
  const shown = all.filter((t) => (status === 'open' ? openSet.includes(t.status) : status === 'done' ? !openSet.includes(t.status) : true) && (!mine || t.assigneeId === meId));
  return { tickets: shown, open: all.filter((t) => openSet.includes(t.status)).length, overdue: all.filter((t) => t.overdue).length };
});
on('GET', '/platform/tickets/:id', ({ params }) => {
  const t = consoleTickets().find((x) => x.id === params.id);
  if (!t) throw new HttpError(404, 'No such ticket.');
  return ticketView(t, true);
});
on('GET', '/platform/staff', ({ p }) => staffList(p));
on('GET', '/platform/help', () => helpArticles());
on('GET', '/platform/help/:id', ({ params }) => {
  const a = helpArticles().find((x) => x.id === params.id);
  if (!a) throw new HttpError(404, 'No such article.');
  return helpFull(a);
});
on('POST', '/platform/help/try', () => ({
  hits: helpArticles().filter((a) => a.published).slice(4, 8).map((a, i) => ({
    articleId: a.id, title: a.title, category: a.category, audience: a.audience, text: a.body.slice(0, 220), score: Math.round((0.86 - i * 0.11) * 100) / 100, keywordRank: i + 1, meaningRank: i === 0 ? 1 : i + 2,
  })),
}));
on('GET', '/platform/audit', ({ query }) => platformAudit(query.get('home'), query.get('category')));
on('GET', '/platform/rollouts', () => rollouts());
on('GET', '/platform/outages', ({ query }) => staffOutages(Math.max(1, Math.min(90, Number(query.get('days') ?? 7)))));
on('GET', '/platform/org', () => orgDetails());
on('GET', '/platform/billing', () => billingOverview());
on('GET', '/platform/roles', () => ({ SUPERADMIN: 2, INSTALLER: 2, SUPPORT: 1, OWNER: 6, ADMIN: 4, MEMBER: 11, GUEST: 3 }));
on('GET', '/platform/backups', () => ({
  backups: Array.from({ length: 7 }, (_, i) => ({ name: `switchboard-${pkDay(now() - i * DAY)}-0300.tar.gz`, size: 48_200_000 + i * 310_000, createdAt: pkAt(i, 3, 0), manual: i === 2 })),
  running: false, lastError: null, keepDays: 14,
}));
on('GET', '/platform/search', ({ query }) => {
  const q = (query.get('q') ?? '').toLowerCase();
  const rows = homeRows('superadmin');
  return {
    homes: rows.filter((h) => `${h.name} ${h.city}`.toLowerCase().includes(q)).map((h) => ({ id: h.id, name: h.name, city: h.city })),
    boards: inventoryView().boards.filter((b) => `${b.id} ${b.location ?? ''}`.toLowerCase().includes(q)).map((b) => ({ id: b.id, name: b.location ?? b.id, status: b.status, homeId: b.homeId, homeName: b.homeName })),
    people: familyMembers().filter((u) => u.role && u.name.toLowerCase().includes(q)).map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, homeId: HOME.id, homeName: HOME.name })),
  };
});

/* ================================================================== http server */
function send(res, status, data, headers = {}) {
  const body = data === undefined ? '' : JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(undefined);
      try { resolve(JSON.parse(raw)); } catch { resolve(undefined); }
    });
  });
}
function noteUnknown(method, path) {
  const key = `${method} ${path}`;
  unknown.set(key, (unknown.get(key) ?? 0) + 1);
  if (unknown.get(key) === 1) process.stderr.write(`[mock-api] UNKNOWN ${key}\n`);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // CORS (socket.io from :3000 and anything calling :4000 straight)
  const origin = req.headers.origin;
  const cors = origin ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'Content-Type, X-Home-Id', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' } : {};
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }

  if (url.pathname === '/__rig/unknown') return send(res, 200, Object.fromEntries(unknown), cors);
  if (url.pathname === '/__rig/reset' && req.method === 'POST') { S = freshState(); unknown.clear(); return send(res, 200, ok, cors); }
  if (url.pathname.startsWith('/socket.io')) return send(res, 404, { message: 'Use the WebSocket transport' }, cors);
  if (!url.pathname.startsWith('/api/')) return send(res, 404, { message: 'Not found', statusCode: 404 }, cors);

  const path = url.pathname.slice(4).replace(/\/+$/, '') || '/';
  const method = req.method ?? 'GET';
  const p = personaOf(req);
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req);
  if (VERBOSE) process.stdout.write(`[mock-api] ${p} ${method} ${path}${url.search}\n`);

  const route = routes.find((r) => r.method === method && r.re.test(path));
  if (route) {
    if (p === 'anon' && !route.public) return send(res, 401, { message: 'Not signed in', statusCode: 401 }, cors);
    const m = route.re.exec(path);
    const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    try {
      const data = await route.handler({ p, params, query: url.searchParams, body, req });
      return send(res, 200, data ?? null, cors);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { message: err.message, statusCode: err.status }, cors);
      process.stderr.write(`[mock-api] ERROR ${method} ${path}: ${err?.stack ?? err}\n`);
      return send(res, 500, { message: 'Mock API error', statusCode: 500 }, cors);
    }
  }
  if (p === 'anon') return send(res, 401, { message: 'Not signed in', statusCode: 401 }, cors);
  if (method !== 'GET') {
    // writes the rig does not model: accept them, so buttons don't show errors
    if (VERBOSE) process.stdout.write(`[mock-api] (accepted) ${method} ${path}\n`);
    return send(res, 200, ok, cors);
  }
  noteUnknown(method, path);
  const last = path.split('/').filter(Boolean).at(-1) ?? '';
  return send(res, 200, /s$/.test(last) ? [] : {}, cors);
});

/* ================================================================== socket.io (Engine.IO v4, WebSocket only) */
server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/socket.io') || url.searchParams.get('transport') !== 'websocket') { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`, '', ''].join('\r\n'));
  socket.setNoDelay(true);
  const sid = randomBytes(10).toString('base64url');
  const frame = (text, opcode = 0x1) => {
    const payload = Buffer.from(text);
    const len = payload.length;
    const head = len < 126 ? Buffer.from([0x80 | opcode, len]) : len < 65536 ? Buffer.from([0x80 | opcode, 126, len >> 8, len & 255]) : null;
    if (!head) return;
    if (!socket.destroyed) socket.write(Buffer.concat([head, payload]));
  };
  frame(`0${JSON.stringify({ sid, upgrades: [], pingInterval: 25000, pingTimeout: 20000, maxPayload: 1000000 })}`);
  const ping = setInterval(() => frame('2'), 25000);
  let buf = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const maskOff = off;
      if (masked) off += 4;
      if (buf.length < off + len) return;
      const data = Buffer.from(buf.subarray(off, off + len));
      if (masked) for (let i = 0; i < data.length; i++) data[i] ^= buf[maskOff + (i % 4)];
      buf = buf.subarray(off + len);
      if (opcode === 0x8) { clearInterval(ping); socket.end(); return; }
      if (opcode === 0x9) { frame(data.toString(), 0xa); continue; }
      if (opcode !== 0x1) continue;
      const text = data.toString('utf8');
      if (text.startsWith('40')) { frame(`40${JSON.stringify({ sid: randomBytes(8).toString('base64url') })}`); frame('42["ready"]'); }
      else if (text === '2') frame('3');
    }
  });
  socket.on('close', () => clearInterval(ping));
  socket.on('error', () => clearInterval(ping));
});

server.listen(PORT, () => {
  process.stdout.write(`[mock-api] listening on http://localhost:${PORT}  (personas: ${PERSONAS.join(', ')}; cookie rig_persona)\n`);
});
