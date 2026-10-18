/**
 * End-to-end: firmware 2.6.0 features with the fake board — its own MQTT login (when the broker has the
 * dynamic-security plugin), a fan with speeds, a water tank that fills and stops its motor, and
 * "stay off after a power cut" in the board's configuration.
 *
 * Needs Postgres and Mosquitto (pnpm infra:up) and python + paho-mqtt. Empties the database it points at.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../../..');
const NODE_ID = 'esp-e2edev';
const API_PORT = Number(process.env.E2E_API_PORT || 4555);
const BROKER_LOG = path.join(os.tmpdir(), `home-e2e-dev-broker-${process.pid}.log`);
let app, base, fake, prisma, mqttClient;

class Client {
  constructor() { this.cookies = new Map(); this.home = null; }
  get cookieHeader() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  async req(method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: this.cookieHeader, ...(this.home ? { 'X-Home-Id': this.home } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, v] = pair.split('=');
      if (v) this.cookies.set(k, v); else this.cookies.delete(k);
    }
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
  get(u) { return this.req('GET', u); }
  post(u, b) { return this.req('POST', u, b ?? {}); }
  patch(u, b) { return this.req('PATCH', u, b); }
}

async function until(what, fn, timeoutMs = 10000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

function startFake() {
  fake = spawn('python3', [path.join(ROOT, 'tools/fake-node/fake_node.py'), '--id', NODE_ID, '--keepalive', '2',
    '--password', process.env.MQTT_NODE_PASSWORD ?? ''], { env: { ...process.env }, stdio: ['pipe', 'pipe', 'inherit'] });
  fake.stdout.on('data', () => {});
}

/** The last configuration the server published for the board (retained). */
const configs = [];

before(async () => {
  process.env.COMMAND_TIMEOUT_MS = '2000';
  process.env.ALLOW_SIGNUP = 'true';
  process.env.BROKER_LOG = BROKER_LOG;
  fs.writeFileSync(BROKER_LOG, '');
  process.env.GEOIP = 'off';
  const { createApp } = require('../../dist/main.js');
  const { PrismaClient } = require('@prisma/client');
  prisma = new PrismaClient();
  await prisma.$executeRawUnsafe('TRUNCATE "Organization", "Home", "User", "Node", "AuditLog", "FirmwareImage", "Invite" CASCADE');
  app = await createApp();
  await app.listen(API_PORT, '127.0.0.1');
  base = `${await app.getUrl()}/api`.replace('[::1]', '127.0.0.1');
  const mqtt = require('mqtt');
  mqttClient = await mqtt.connectAsync(process.env.MQTT_URL ?? 'mqtt://localhost:1883', { username: 'api', password: process.env.MQTT_API_PASSWORD });
  mqttClient.on('message', (topic, buf) => { if (buf.length) configs.push(JSON.parse(buf.toString())); });
  await mqttClient.subscribeAsync(`home/v1/nodes/${NODE_ID}/config`);
});

after(async () => {
  fake?.kill('SIGKILL');
  for (const t of ['announce', 'status', 'config', 'devices/ceiling_fan/state', 'devices/motor/state', 'devices/roof_tank/state', 'devices/geyser/state']) {
    await mqttClient.publishAsync(`home/v1/nodes/${NODE_ID}/${t}`, '', { retain: true, qos: 1 });
  }
  await mqttClient.endAsync();
  await app?.close();
  await prisma?.$disconnect();
  fs.rmSync(BROKER_LOG, { force: true });
});

const owner = new Client();
const state = {};
const board = async () => (await owner.get('/nodes')).body.find((n) => n.id === NODE_ID);
const device = async (id) => (await owner.get(`/devices/${id}`)).body;

test('setup, and a 2.6.0 board is adopted', async () => {
  const res = await owner.post('/auth/setup', { homeName: 'Device home', name: 'Fawad', email: 'dev@example.com', password: 'secret123' });
  assert.equal(res.status, 201);
  state.homeId = res.body.home.id;
  state.room = (await owner.get('/rooms')).body[0].id;
  startFake();
  await until('board in stock', async () => (await owner.get('/platform/inventory')).body.boards.find((b) => b.id === NODE_ID));
  assert.equal((await owner.post(`/platform/inventory/${NODE_ID}/assign`, { homeId: state.homeId })).status, 200);
  await until('board online', async () => (await board())?.online);
  assert.equal((await owner.post(`/nodes/${NODE_ID}/adopt`, { name: 'Lounge board', board: 'NODEMCU_V2' })).status, 204);
  await until('adopted', async () => { const n = await board(); return n.status === 'ADOPTED' && n.appliedRev === n.configRev; });
});

test('the board gets its own server login (when the broker supports it), and staff can reset it', async (t) => {
  // brokers without the dynamic-security plugin keep the shared login: nothing to check then
  const own = await until('login settled', async () => { const n = await board(); return n.mqttLogin ? n : null; }, 15000);
  if (own.mqttLogin !== 'own') {
    await new Promise((r) => setTimeout(r, 3000));
    if ((await board()).mqttLogin !== 'own') return t.skip('this broker has no per-board logins');
  }
  const first = await until('own login used', async () => { const n = await board(); return n.mqttLogin === 'own' && n.mqttLoginSince ? n : null; }, 15000);
  assert.equal(first.mqttLoginProblem, false);
  const sealed = (await prisma.node.findUnique({ where: { id: NODE_ID } })).mqttSecret;
  assert.ok(sealed && !sealed.includes(' '));

  // the board comes back without its login (an erased chip, or someone using its id): it is NOT handed
  // the password; staff see the problem
  fake.kill('SIGKILL');
  await until('offline', async () => !(await board()).online, 12000);
  startFake();
  const flagged = await until('flagged', async () => { const n = await board(); return n.online && n.mqttLoginProblem ? n : null; }, 15000);
  assert.equal(flagged.mqttLogin, 'shared');

  // reset: a new login is made and sent; the board uses it
  assert.equal((await owner.post(`/nodes/${NODE_ID}/reset-login`)).status, 204);
  await until('own login again', async () => { const n = await board(); return n.online && n.mqttLogin === 'own' && !n.mqttLoginProblem ? n : null; }, 15000);
  assert.notEqual((await prisma.node.findUnique({ where: { id: NODE_ID } })).mqttSecret, sealed);
  await until('applied', async () => { const n = await board(); return n.appliedRev === n.configRev; });
});

test('a fan with speeds: extra pins are checked, speeds are confirmed by the board', async () => {
  const sw = await owner.post(`/nodes/${NODE_ID}/devices`, { name: 'Motor', type: 'switch', pin: 13, roomId: state.room });
  assert.equal(sw.status, 201, JSON.stringify(sw.body));
  state.motor = sw.body.id;
  // relay 2 on a pin the motor already uses
  const clash = await owner.post(`/nodes/${NODE_ID}/devices`, { name: 'Ceiling fan', type: 'fan', pin: 5, settings: { pins: [4, 13] } });
  assert.equal(clash.status, 400);
  assert.match(clash.body.message, /already used by "Motor"/);
  // relay 3 on an input-only pin
  const bad = await owner.post(`/nodes/${NODE_ID}/devices`, { name: 'Ceiling fan', type: 'fan', pin: 5, settings: { pins: [4, 0] } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.message, /relay 3/i);
  const fan = await owner.post(`/nodes/${NODE_ID}/devices`, { name: 'Ceiling fan', type: 'fan', pin: 5, activeLow: true, roomId: state.room, settings: { pins: [4, 14] } });
  assert.equal(fan.status, 201, JSON.stringify(fan.body));
  assert.equal(fan.body.speeds, 4);
  state.fan = fan.body.id;
  // a switch can't take the fan's relay 3
  assert.equal((await owner.post(`/nodes/${NODE_ID}/devices`, { name: 'Lamp', type: 'switch', pin: 14 })).status, 400);
  await until('applied', async () => { const n = await board(); return n.appliedRev === n.configRev && !n.configError; });

  const s2 = await owner.post(`/devices/${state.fan}/commands`, { speed: 2 });
  assert.equal(s2.status, 200, JSON.stringify(s2.body));
  assert.deepEqual(s2.body.state, { on: true, speed: 2 });
  const off = await owner.post(`/devices/${state.fan}/commands`, { on: false });
  assert.deepEqual(off.body.state, { on: false, speed: 2 });   // remembers its speed
  const on = await owner.post(`/devices/${state.fan}/commands`, { toggle: true });
  assert.deepEqual(on.body.state, { on: true, speed: 2 });
  assert.equal((await owner.post(`/devices/${state.fan}/commands`, { speed: 9 })).status, 400);
  assert.equal((await owner.post(`/devices/${state.motor}/commands`, { speed: 2 })).status, 400);   // a switch has no speeds
});

test('a water tank: the board gets its motor, the server fills it when low, the board stops it when full', async () => {
  const tank = await owner.post(`/nodes/${NODE_ID}/devices`, {
    name: 'Roof tank', type: 'tank', pin: 16, roomId: state.room,
    settings: { echoPin: 12, motorDeviceId: state.motor, fillBelowPct: 30, stopAtPct: 95 },
  });
  assert.equal(tank.status, 201, JSON.stringify(tank.body));
  state.tank = tank.body.id;
  await until('applied', async () => { const n = await board(); return n.appliedRev === n.configRev && !n.configError; });
  const sent = configs.at(-1).devices.find((d) => d.key === 'roof_tank');
  assert.equal(sent.settings.motorKey, 'motor');                // the board knows its motor
  assert.equal(sent.settings.motorDeviceId, undefined);         // not the server's ids
  assert.equal(sent.settings.fillBelowPct, undefined);          // starting is the server's job

  // a tank's motor must be something that switches
  assert.equal((await owner.patch(`/devices/${state.tank}`, { settings: { echoPin: 12, motorDeviceId: state.tank } })).status, 400);

  fake.stdin.write('level roof_tank 25\n');
  await until('motor started', async () => (await device(state.motor)).state?.on === true);
  const started = (await owner.get(`/devices/${state.motor}/history`)).body[0];
  assert.equal(started.via, 'schedule');   // an automation

  fake.stdin.write('level roof_tank 97\n');
  await until('motor stopped by the board', async () => (await device(state.motor)).state?.on === false);
  assert.equal((await device(state.motor)).source, 'automation');
  assert.equal((await device(state.tank)).state.level, 97);
});

test('"stay off after a power cut" goes into the board configuration', async () => {
  const geyser = await owner.post(`/nodes/${NODE_ID}/devices`, { name: 'Geyser', type: 'switch', pin: 15, restoreOff: true });
  assert.equal(geyser.status, 201, JSON.stringify(geyser.body));
  assert.equal(geyser.body.restoreOff, true);
  await until('sent', async () => configs.at(-1)?.devices.find((d) => d.key === 'geyser')?.restore === 'off');
  assert.equal(configs.at(-1).devices.find((d) => d.key === 'motor').restore, 'last');
  assert.ok(configs.at(-1).restoreGapMs > 0);
  const back = await owner.patch(`/devices/${geyser.body.id}`, { restoreOff: false });
  assert.equal(back.status, 200);
  await until('sent again', async () => configs.at(-1)?.devices.find((d) => d.key === 'geyser')?.restore === 'last');
  // sensors don't take it
  assert.equal((await owner.patch(`/devices/${state.tank}`, { restoreOff: true })).status, 400);
});

test('boards on older firmware are told to update before getting a fan or tank', async () => {
  await prisma.node.update({ where: { id: NODE_ID }, data: { firmware: '2.5.0' } });
  const res = await owner.post(`/nodes/${NODE_ID}/devices`, { name: 'Fan 2', type: 'fan', pin: 2, settings: { pins: [3, 0] } });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /firmware 2\.6\.0/);
});

test('a real-size firmware image (560 KB) arrives in chunks over the MQTT link and the board runs it', async () => {
  await prisma.node.update({ where: { id: NODE_ID }, data: { firmware: '2.6.3-fake' } });
  const image = new Uint8Array(560 * 1024);
  for (let i = 0; i < image.length; i++) image[i] = (i * 31) & 0xff;   // not all the same byte: a real file
  image[0] = 0xe9;
  image.set(new TextEncoder().encode('@@HOMENODE-FW:2.11.0-test@@'), 100);
  const form = new FormData();
  form.append('file', new Blob([image]), 'home_node.ino.bin');
  const up = await fetch(`${base}/firmware`, { method: 'POST', body: form, headers: { Cookie: owner.cookieHeader } });
  const upText = await up.text();
  assert.equal(up.status, 201, upText);
  const fw = JSON.parse(upText);
  const t0 = Date.now();
  assert.equal((await owner.post(`/nodes/${NODE_ID}/update`, { firmwareId: fw.id })).status, 201);
  await until('board runs 2.11.0-test', async () => (await board())?.firmware === '2.11.0-test', 60000);
  const seconds = (Date.now() - t0) / 1000;
  const log = JSON.stringify((await owner.get(`/nodes/${NODE_ID}/logs`)).body);
  assert.match(log, /over the server link \(560 KB\)/);
  assert.match(log, /100% sent/);
  assert.ok(seconds < 45, `took ${seconds} s`);
});
