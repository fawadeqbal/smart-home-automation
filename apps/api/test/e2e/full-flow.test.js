/**
 * End-to-end: the real API (built: `pnpm build`), the real database and broker, a fake board
 * (tools/fake-node) and a Socket.IO client, through the whole workflow:
 *   setup -> board lands in stock -> assigned to the home -> adopted -> devices + pins + button ->
 *   command with ack -> sensor readings -> live updates -> family member rights -> wall button ->
 *   board offline, then the SaaS side: a second organization, staff roles and tenant isolation.
 *
 * Needs Postgres and Mosquitto running (pnpm infra:up) and python + paho-mqtt.
 * Stop `pnpm dev` first: a second API on the same database and broker would record every message twice.
 * WARNING: empties the database it points at. Run:  pnpm --filter @home/api test:e2e
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { io } = require('socket.io-client');

const ROOT = path.resolve(__dirname, '../../../..');
const NODE_ID = 'esp-e2e01';
// ports can be moved (E2E_API_PORT, E2E_LOCAL_PORT) to run two copies of the tests side by side
const API_PORT = Number(process.env.E2E_API_PORT || 4555);
const LOCAL_PORT = Number(process.env.E2E_LOCAL_PORT || 4588);   // the fake board answers the phone app here (a real board: port 80)
const BROKER_LOG = path.join(os.tmpdir(), `home-e2e-broker-${process.pid}.log`);
let app, base, fake, prisma;

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
  put(u, b) { return this.req('PUT', u, b); }
  del(u) { return this.req('DELETE', u); }
}

async function until(what, fn, timeoutMs = 8000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

before(async () => {
  process.env.COMMAND_TIMEOUT_MS = '2000';
  process.env.RULES_TICK_MS = '1000'; // auto-off checks every second in tests
  process.env.ROLLOUT_TICK_MS = '700'; // staged firmware rollouts step quickly in tests
  process.env.ALLOW_SIGNUP = 'true'; // the SaaS test signs up a second organization
  process.env.PUBLIC_API_URL = `http://127.0.0.1:${API_PORT}`; // where the fake board downloads firmware
  process.env.HELP_DIR = path.join(__dirname, 'help-fixture'); // three small starter articles
  // the broker's connection log (on the server Mosquitto writes it); no IP-location downloads in tests
  process.env.BROKER_LOG = BROKER_LOG;
  fs.writeFileSync(BROKER_LOG, '');
  process.env.GEOIP = 'off';
  const { createApp } = require('../../dist/main.js');
  const { PrismaClient } = require('@prisma/client');
  prisma = new PrismaClient();
  await prisma.$executeRawUnsafe('TRUNCATE "Organization", "Home", "User", "Node", "AuditLog", "FirmwareImage", "Invite", "LoginAttempt" CASCADE');
  app = await createApp();
  await app.listen(API_PORT, '127.0.0.1');
  base = `${await app.getUrl()}/api`.replace('[::1]', '127.0.0.1');
});

after(async () => {
  fake?.kill('SIGKILL');
  // Leave no retained messages from the test board on the broker.
  const mqtt = require('mqtt');
  const client = await mqtt.connectAsync(process.env.MQTT_URL ?? 'mqtt://localhost:1883',
    { username: 'api', password: process.env.MQTT_API_PASSWORD });
  for (const t of ['announce', 'status', 'config', 'devices/bulb/state', 'devices/room_climate/state', 'devices/front_door/state', 'devices/kitchen_leak/state']) {
    await client.publishAsync(`home/v1/nodes/${NODE_ID}/${t}`, '', { retain: true, qos: 1 });
  }
  await client.endAsync();
  await app?.close();
  await prisma?.$disconnect();
});

const owner = new Client();
const member = new Client();
const state = {};

test('first run: setup creates the organization, the home and signs the owner in', async () => {
  assert.deepEqual((await owner.get('/auth/status')).body, { setupNeeded: true, signupOpen: true, mail: false });
  const res = await owner.post('/auth/setup', { homeName: 'Test home', name: 'Fawad', email: 'Owner@Example.com', password: 'secret123' });
  assert.equal(res.status, 201);
  assert.equal(res.body.role, 'OWNER');
  assert.equal(res.body.email, 'owner@example.com');
  assert.equal(res.body.staff.role, 'SUPERADMIN');
  assert.equal(res.body.home.name, 'Test home');
  assert.equal(res.body.home.canSetup, true);
  state.homeId = res.body.home.id;
  assert.equal((await owner.post('/auth/setup', { homeName: 'x', name: 'x', email: 'x@x.com', password: 'secret123' })).status, 409);
  assert.equal((await new Client().get('/devices')).status, 401);
  const rooms = (await owner.get('/rooms')).body;
  state.livingRoom = rooms.find((r) => r.name === 'Living room').id;
});

test('a new board lands in stock, is assigned to the home and adopted', async () => {
  const env = { ...process.env };
  fake = spawn('python3', [path.join(ROOT, 'tools/fake-node/fake_node.py'), '--id', NODE_ID, '--keepalive', '2',
    '--local-port', String(LOCAL_PORT), '--password', process.env.MQTT_NODE_PASSWORD ?? ''], { env, stdio: ['pipe', 'pipe', 'inherit'] });
  fake.stdout.on('data', (d) => { state.fakeLog = (state.fakeLog ?? '') + d; });

  // one organization on this server: the board goes straight into its stock
  const stocked = await until('board in stock', async () => (await owner.get('/platform/inventory')).body.boards.find((b) => b.id === NODE_ID));
  assert.equal(stocked.status, 'STOCK');
  assert.equal((await owner.get('/nodes')).body.length, 0);
  // a 2.6.0 board reconnects once with its own login right after it first connects (when the broker has
  // per-board logins): let that happen first, so it doesn't look like the board dropping out mid-test
  for (const end = Date.now() + 8000; Date.now() < end; await new Promise((r) => setTimeout(r, 200))) {
    if ((await prisma.node.findUnique({ where: { id: NODE_ID } }))?.mqttLoginUsedAt) break;
  }
  assert.equal((await owner.post(`/platform/inventory/${NODE_ID}/assign`, { homeId: state.homeId })).status, 200);
  const pending = await until('board listed', async () => (await owner.get('/nodes')).body.find((n) => n.id === NODE_ID));
  assert.equal(pending.status, 'ASSIGNED');
  await until('board online', async () => (await owner.get('/nodes')).body.find((n) => n.id === NODE_ID)?.online);
  const ws = (await owner.get(`/platform/homes/${state.homeId}`)).body;
  assert.equal(ws.steps[1].done, true);
  assert.equal(ws.steps[2].done, false);

  assert.equal((await owner.post(`/nodes/${NODE_ID}/adopt`, { name: 'Living room board', board: 'WEMOS_D1_MINI' })).status, 204);
  const node = await until('config applied', async () => {
    const n = (await owner.get('/nodes')).body.find((x) => x.id === NODE_ID);
    return n.status === 'ADOPTED' && n.appliedRev === n.configRev ? n : null;
  });
  assert.equal(node.name, 'Living room board');
});

test('devices and buttons are validated against the board pin rules', async () => {
  const bad = await owner.post(`/nodes/${NODE_ID}/devices`, { name: 'Bad', type: 'switch', pin: 7 });
  assert.equal(bad.status, 400);
  assert.match(bad.body.message, /GPIO 7 cannot be used/);
  assert.equal((await owner.post(`/nodes/${NODE_ID}/devices`, { name: 'Lamp', type: 'switch', pin: 16, settings: { x: 1 } })).status, 400);

  const bulb = await owner.post(`/nodes/${NODE_ID}/devices`, {
    name: 'Bulb', type: 'switch', pin: 5, activeLow: true, roomId: state.livingRoom, aliases: ['batti'],
  });
  assert.equal(bulb.status, 201, JSON.stringify(bulb.body));
  assert.equal(bulb.body.key, 'bulb');
  assert.equal(bulb.body.pinLabel, 'D1 (GPIO 5)');
  state.bulb = bulb.body.id;

  const dup = await owner.post(`/nodes/${NODE_ID}/devices`, { name: 'Fan', type: 'switch', pin: 5 });
  assert.match(dup.body.message, /already used by "Bulb"/);

  const sensor = await owner.post(`/nodes/${NODE_ID}/devices`, {
    name: 'Room climate', type: 'dht', pin: 4, roomId: state.livingRoom, settings: { model: 'dht22', intervalSec: 5 },
  });
  assert.equal(sensor.status, 201, JSON.stringify(sensor.body));
  state.sensor = sensor.body.id;

  assert.equal((await owner.post(`/nodes/${NODE_ID}/inputs`, { type: 'toggle_button', pin: 14, targetId: state.sensor })).status, 400);
  const button = await owner.post(`/nodes/${NODE_ID}/inputs`, { type: 'toggle_button', pin: 14, targetId: state.bulb });
  assert.equal(button.status, 201, JSON.stringify(button.body));

  await until('board applied the new config', async () => {
    const n = (await owner.get('/nodes')).body.find((x) => x.id === NODE_ID);
    return n.appliedRev === n.configRev && !n.configError;
  });
});

test('a command is confirmed by the board and pushed live', async () => {
  const socket = io(base.replace('/api', ''), { extraHeaders: { Cookie: owner.cookieHeader }, transports: ['websocket'] });
  const events = [];
  socket.on('device.state', (e) => events.push(e));
  await new Promise((resolve, reject) => { socket.on('ready', resolve); socket.on('auth.error', reject); });

  const res = await owner.post(`/devices/${state.bulb}/commands`, { on: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.state, { on: true });
  assert.equal(res.body.source, 'remote');
  await until('live update', () => events.find((e) => e.id === state.bulb && e.state.on === true));
  assert.equal((await owner.post(`/devices/${state.sensor}/commands`, { on: true })).status, 400);
  assert.equal((await owner.post(`/devices/${state.bulb}/commands`, { on: 'yes' })).status, 400);

  const climate = await until('sensor reading', async () => {
    const d = (await owner.get(`/devices/${state.sensor}`)).body;
    return typeof d.state?.temperature === 'number' ? d : null;
  });
  assert.equal(climate.source, 'sensor');
  const cmd = await prisma.command.findFirst({ where: { deviceId: state.bulb } });
  assert.equal(cmd.status, 'ACKED');
  socket.close();
});

test('live logs show what the board printed and what the server did', async () => {
  const socket = io(base.replace('/api', ''), { extraHeaders: { Cookie: owner.cookieHeader }, transports: ['websocket'] });
  const live = [];
  socket.on('node.log', (e) => live.push(e));
  await new Promise((resolve) => socket.on('ready', resolve));
  await owner.post(`/devices/${state.bulb}/commands`, { toggle: true });
  await until('live log lines', () => live.some((e) => e.nodeId === NODE_ID && e.entry.source === 'board'));
  const lines = (await owner.get(`/nodes/${NODE_ID}/logs`)).body;
  assert.ok(lines.some((l) => l.source === 'board' && /Command for bulb/.test(l.msg)), 'board line');
  assert.ok(lines.some((l) => l.source === 'server' && /Bulb confirmed/.test(l.msg)), 'server line');
  assert.ok(lines.some((l) => l.source === 'server' && /Sent configuration rev/.test(l.msg)), 'config line');
  assert.equal((await member.get(`/nodes/${NODE_ID}/logs`)).status, 401);
  socket.close();
});

test('family members only see and do what their room rights allow', async () => {
  const invite = await owner.post('/invites', { email: 'kid@example.com', role: 'MEMBER' });
  assert.equal(invite.status, 201);
  assert.deepEqual((await member.get(`/invites/${invite.body.token}`)).body.email, 'kid@example.com');
  const accepted = await member.post(`/invites/${invite.body.token}/accept`, { name: 'Ali', password: 'kidpass123' });
  assert.equal(accepted.status, 201);
  assert.equal((await member.post(`/invites/${invite.body.token}/accept`, { name: 'Ali', password: 'kidpass123' })).status, 410);

  assert.deepEqual((await member.get('/devices')).body, []);
  assert.equal((await member.post(`/devices/${state.bulb}/commands`, { on: false })).status, 404);
  assert.equal((await member.get('/nodes')).status, 403);

  await owner.put(`/users/${accepted.body.id}/rooms`, { rooms: [{ roomId: state.livingRoom, access: 'VIEW' }] });
  assert.equal((await member.get('/devices')).body.length, 2);
  assert.equal((await member.post(`/devices/${state.bulb}/commands`, { on: false })).status, 403);

  await owner.put(`/users/${accepted.body.id}/rooms`, { rooms: [{ roomId: state.livingRoom, access: 'CONTROL' }] });
  const off = await member.post(`/devices/${state.bulb}/commands`, { on: false });
  assert.equal(off.status, 200);
  assert.equal(off.body.state.on, false);
  assert.equal((await member.patch(`/devices/${state.bulb}`, { name: 'Lamp' })).status, 403);
  assert.equal((await member.del(`/devices/${state.bulb}`)).status, 403);

  const cmd = await prisma.command.findFirst({ where: { deviceId: state.bulb, userId: accepted.body.id } });
  assert.equal(cmd.channel, 'web');
});

test('the wall button on the board is recorded as a button press', async () => {
  fake.stdin.write('press D5\n');
  const bulb = await until('button press seen', async () => {
    const d = (await owner.get(`/devices/${state.bulb}`)).body;
    return d.state?.on === true && d.source === 'button' ? d : null;
  });
  assert.equal(bulb.state.on, true);
  const history = (await owner.get(`/devices/${state.bulb}/history`)).body;
  assert.deepEqual(history.slice(0, 2).map((h) => h.source), ['button', 'remote']);
  assert.deepEqual(history.slice(0, 2).map((h) => [h.via, h.by]), [['wall', null], ['app', 'Fawad']]);

  // the activity feed: who switched what, and how — only for devices you can see
  const feed = (await owner.get('/events?limit=5')).body;
  assert.deepEqual(feed.slice(0, 2).map((e) => [e.deviceName, e.via, e.by, e.state.on]), [['Bulb', 'wall', null, true], ['Bulb', 'app', 'Fawad', false]]);
  assert.equal(feed[0].roomName, 'Living room');
  assert.ok(feed.every((e) => e.deviceType !== 'dht')); // temperature readings stay out of it
  const older = (await owner.get(`/events?limit=5&before=${encodeURIComponent(feed[0].at)}`)).body;
  assert.equal(older[0].id, feed[1].id);
  assert.deepEqual((await new Client().get('/events')).status, 401);
});

test('board connections: public IP, why each ended, history; re-reading changes nothing', async () => {
  const now = Math.floor(Date.now() / 1000);
  const lines = [
    `${now - 100}: New connection from 39.45.10.20:51000 on port 8883.`,
    `${now - 100}: New client connected from 39.45.10.20:51000 as ${NODE_ID} (p4, c1, k15, u'node').`,
    `${now - 99}: New client connected from 172.24.0.5:40000 as api-1234 (p4, c1, k60, u'api').`,
    `${now - 40}: Client ${NODE_ID} [39.45.10.20:51000] disconnected: exceeded timeout.`,
    `${now - 30}: New client connected from 203.0.113.9:52000 as ${NODE_ID} (p4, c1, k15, u'node').`,
    `${now - 30}: Client ${NODE_ID} negotiated TLSv1.3 cipher TLS_AES_256_GCM_SHA384`,
  ];
  fs.appendFileSync(BROKER_LOG, lines.join('\n') + '\n');
  const info = await until('connections recorded', async () => {
    const r = (await owner.get(`/nodes/${NODE_ID}/connections`)).body;
    // the new connection is saved first, the board's address right after: wait for both
    return r.history?.length === 2 && r.current?.ip === '203.0.113.9' ? r : null;
  });
  assert.equal(info.tracking, true);
  assert.equal(info.current.ip, '203.0.113.9');
  const [latest, before] = info.history;
  assert.equal(latest.endedAt, null);
  assert.equal(latest.newAddress, true);
  assert.equal(before.ip, '39.45.10.20');
  assert.equal(before.endReason, 'timeout');
  assert.equal(before.seconds, 60);
  assert.equal(info.stats.ends7d.timeout, 1);
  assert.equal(info.stats.addresses7d, 2);
  const listed = (await owner.get('/nodes')).body.find((n) => n.id === NODE_ID);
  assert.equal(listed.publicIp, '203.0.113.9');
  const logs = (await owner.get(`/nodes/${NODE_ID}/logs`)).body;
  assert.ok(logs.some((l) => l.source === 'server' && /^Connected from 203\.0\.113\.9/.test(l.msg)), 'live log: connected');
  assert.ok(logs.some((l) => l.source === 'server' && /^Connection ended: lost contact/.test(l.msg)), 'live log: why it ended');

  // the same lines again (a restart reads the file from the top): nothing new
  fs.appendFileSync(BROKER_LOG, lines.join('\n') + '\n');
  await new Promise((r) => setTimeout(r, 2600));
  assert.equal((await prisma.nodeConnection.count({ where: { nodeId: NODE_ID } })), 2);
  // only owners and admins
  assert.equal((await member.get(`/nodes/${NODE_ID}/connections`)).status, 403);

  // the console (super admin): every board of the company, and one board's story
  const fleet = (await owner.get('/platform/connectivity')).body;
  const mine = fleet.boards.find((b) => b.id === NODE_ID);
  assert.equal(mine.publicIp, '203.0.113.9');
  assert.equal(mine.home.name, 'Test home');
  assert.equal(mine.ends7d.timeout, 1);
  assert.equal(mine.lastEnd.reason, 'timeout');
  assert.equal((await owner.get(`/platform/boards/${NODE_ID}/connections`)).body.current.ip, '203.0.113.9');
  // not staff: no console, and no console assistant (refused before anything reaches the AI)
  assert.equal((await member.get('/platform/connectivity')).status, 403);
  assert.equal((await member.post('/assistant/console/chat', { text: 'which boards are offline?' })).status, 403);
});

test('scenes run at once; timers run later with their creator\'s rights', async () => {
  // scene: bulb off
  const scene = await owner.post('/scenes', { name: 'Good night', actions: [{ deviceId: state.bulb, on: false }] });
  assert.equal(scene.status, 201);
  const ran = await owner.post(`/scenes/${scene.body.id}/run`);
  assert.equal(ran.status, 201);
  assert.equal(ran.body.ok, true);
  assert.equal((await owner.get(`/devices/${state.bulb}`)).body.state.on, false);

  // a member may not automate a device they can only view
  const kid = new Client();
  await kid.post('/auth/login', { email: 'kid@example.com', password: 'kidpass123' });
  const kidId = (await kid.get('/auth/me')).body.id;
  await owner.put(`/users/${kidId}/rooms`, { rooms: [{ roomId: state.livingRoom, access: 'VIEW' }] });
  const denied = await kid.post('/schedules', { kind: 'ONCE', inMinutes: 5, actions: [{ deviceId: state.bulb, on: true }] });
  assert.equal(denied.status, 403);

  // a timer two seconds from now turns the bulb on, through the normal acknowledged command path
  const runAt = new Date(Date.now() + 2000).toISOString();
  const timer = await owner.post('/schedules', { kind: 'ONCE', runAt, actions: [{ deviceId: state.bulb, on: true }] });
  assert.equal(timer.status, 201);
  assert.equal(timer.body.name, 'Bulb on');
  const done = await until('timer ran', async () => {
    const s = (await owner.get('/schedules')).body.find((x) => x.id === timer.body.id);
    return s?.lastRunAt ? s : null;
  }, 15000);
  assert.equal(done.enabled, false);
  assert.match(done.lastResult, /Done: Bulb on/);
  assert.equal((await owner.get(`/devices/${state.bulb}`)).body.state.on, true);
  const cmd = await prisma.command.findFirst({ where: { deviceId: state.bulb }, orderBy: { createdAt: 'desc' } });
  assert.equal(cmd.channel, 'automation');

  // daily schedules get a next run time and can be paused
  const daily = await owner.post('/schedules', { kind: 'DAILY', time: '19:00', days: [1, 2, 3, 4, 5], actions: [{ deviceId: state.bulb, on: true }] });
  assert.equal(daily.status, 201);
  assert.ok(new Date(daily.body.nextRunAt).getTime() > Date.now());
  assert.equal((await owner.patch(`/schedules/${daily.body.id}`, { enabled: false })).status, 204);
  assert.equal((await owner.del(`/schedules/${daily.body.id}`)).status, 204);
});

test('a water leak notifies the people of that room; health reports are kept for charts', async () => {
  const leak = await owner.post(`/nodes/${NODE_ID}/devices`, { name: 'Kitchen leak', type: 'contact', pin: 12, activeLow: true, roomId: state.livingRoom, settings: { kind: 'leak' } });
  assert.equal(leak.status, 201);
  await until('sensor reported', async () => (await owner.get(`/devices/${leak.body.id}`)).body.state?.active === false);
  fake.stdin.write(`trip ${leak.body.key}\n`);
  const notice = await until('leak notice', async () => (await owner.get('/notifications')).body.items.find((n) => n.kind === 'leak'));
  assert.equal(notice.severity, 'ALERT');
  assert.match(notice.title, /Water leak/);
  // the member can see the living room, so they are told too
  const kid = new Client();
  await kid.post('/auth/login', { email: 'kid@example.com', password: 'kidpass123' });
  const theirs = (await kid.get('/notifications')).body;
  assert.ok(theirs.unread >= 1 && theirs.items.some((n) => n.kind === 'leak'));
  assert.equal((await kid.post('/notifications/read')).status, 204);
  assert.equal((await kid.get('/notifications')).body.unread, 0);
  // people can switch a kind off
  const prefs = (await kid.put('/notifications/prefs', { leak: false })).body;
  assert.equal(prefs.find((p) => p.key === 'leak').enabled, false);
  assert.ok(!prefs.some((p) => p.key === 'boardOffline')); // admin-only kinds are not offered to members

  // the fake board sends a health report at start; it is stored
  const hist = await owner.get(`/nodes/${NODE_ID}/health-history?hours=1`);
  assert.equal(hist.status, 200);
  assert.ok(hist.body.length >= 1 && hist.body[0].vcc > 3000);
});

test('rules, safety auto-off, child lock, away mode and sunset timers', async () => {
  const door = await owner.post(`/nodes/${NODE_ID}/devices`, { name: 'Front door', type: 'contact', pin: 13, activeLow: true, roomId: state.livingRoom, settings: { kind: 'door' } });
  assert.equal(door.status, 201, JSON.stringify(door.body));
  await until('door reported', async () => (await owner.get(`/devices/${door.body.id}`)).body.state?.active === false, 10000);
  await owner.post(`/devices/${state.bulb}/commands`, { on: false });

  // what a device can start a rule with is checked; a member can't make a rule switch what they only see
  const wrong = await owner.post('/rules', { trigger: { deviceId: door.body.id, event: 'above', value: 3 }, actions: [{ type: 'notify', to: 'me' }] });
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.message, /opens, closes/);
  const kid = new Client();
  await kid.post('/auth/login', { email: 'kid@example.com', password: 'kidpass123' });
  assert.equal((await kid.post('/rules', { trigger: { deviceId: door.body.id, event: 'opens' }, actions: [{ type: 'device', deviceId: state.bulb, on: true }] })).status, 403);
  assert.equal((await kid.post('/rules', { trigger: { deviceId: door.body.id, event: 'opens' }, actions: [{ type: 'notify', to: 'everyone' }] })).status, 403);

  // when the door opens: the bulb on for a minute, and tell me
  const rule = await owner.post('/rules', {
    trigger: { deviceId: door.body.id, event: 'opens' },
    actions: [{ type: 'device', deviceId: state.bulb, on: true, forMinutes: 1 }, { type: 'notify', to: 'me' }],
  });
  assert.equal(rule.status, 201, JSON.stringify(rule.body));
  assert.equal(rule.body.name, 'When Front door opens: Bulb on for 1 min, tell me');
  fake.stdin.write('trip front_door\n');
  const fired = await until('rule ran', async () => (await owner.get('/rules')).body.find((r) => r.id === rule.body.id && r.lastResult), 10000);
  assert.match(fired.lastResult, /Done: Bulb on for 1 min, told its creator/);
  const bulb = (await owner.get(`/devices/${state.bulb}`)).body;
  assert.equal(bulb.state.on, true);
  assert.ok(new Date(bulb.autoOffAt).getTime() > Date.now() + 30000);
  assert.ok((await owner.get('/notifications')).body.items.some((n) => n.kind === 'automation' && n.title === rule.body.name));
  assert.equal((await prisma.command.findFirst({ where: { deviceId: state.bulb }, orderBy: { createdAt: 'desc' } })).channel, 'automation');

  // safety auto-off: when its time comes, it switches itself off
  assert.equal((await kid.patch(`/devices/${state.bulb}`, { autoOffMinutes: 5 })).status, 403);
  await prisma.device.update({ where: { id: state.bulb }, data: { autoOffAt: new Date(Date.now() - 1000) } });
  await until('bulb switched itself off', async () => (await owner.get(`/devices/${state.bulb}`)).body.state.on === false, 10000);
  const safety = await owner.patch(`/devices/${state.bulb}`, { autoOffMinutes: 90 });
  assert.equal(safety.status, 200, JSON.stringify(safety.body));
  assert.equal(safety.body.autoOffMinutes, 90);

  // child lock: a member with control can't switch it; the owner can
  await owner.put(`/users/${(await kid.get('/auth/me')).body.id}/rooms`, { rooms: [{ roomId: state.livingRoom, access: 'CONTROL' }] });
  assert.equal((await kid.post(`/devices/${state.bulb}/commands`, { on: true })).status, 200);
  assert.equal((await owner.patch(`/devices/${state.bulb}`, { childLock: true })).body.childLock, true);
  const locked = await kid.post(`/devices/${state.bulb}/commands`, { on: false });
  assert.equal(locked.status, 403);
  assert.match(locked.body.message, /child lock/);
  assert.equal((await owner.post(`/devices/${state.bulb}/commands`, { on: false })).status, 200);
  await owner.patch(`/devices/${state.bulb}`, { childLock: false, autoOffMinutes: null });
  await owner.put(`/users/${(await kid.get('/auth/me')).body.id}/rooms`, { rooms: [{ roomId: state.livingRoom, access: 'VIEW' }] });

  // away mode: the door opening is an alert at any hour; everyone else is told it was turned on
  const away = await owner.put('/home/away', { on: true, lights: [state.bulb, door.body.id] });
  assert.equal(away.status, 200, JSON.stringify(away.body));
  assert.equal(away.body.on, true);
  assert.deepEqual(away.body.lights, [state.bulb]); // only switches
  assert.ok((await kid.get('/notifications')).body.items.some((n) => n.title === 'Away mode is on'));
  assert.equal((await kid.put('/home/away', { lights: [] })).status, 403);
  fake.stdin.write('trip front_door\n'); // closes
  fake.stdin.write('trip front_door\n'); // opens again
  const alert = await until('away alert', async () => (await owner.get('/notifications')).body.items.find((n) => n.kind === 'awayAlert' && n.severity === 'ALERT'), 10000);
  assert.match(alert.title, /Front door opened while you're away/);
  assert.equal((await kid.put('/home/away', { on: false })).body.on, false);

  // where the home is decides sunrise and sunset; sunset timers follow
  const where = (await owner.get('/home/location')).body;
  assert.ok(where.cities.includes('Lahore') && new Date(where.sunrise) < new Date(where.sunset));
  assert.equal((await owner.put('/home/location', { city: 'Atlantis' })).status, 400);
  assert.equal((await kid.put('/home/location', { city: 'Lahore' })).status, 403);
  const set = await owner.put('/home/location', { city: 'lahore' });
  assert.equal(set.status, 200);
  assert.equal(set.body.source, 'set');
  assert.equal(set.body.label, 'Lahore');
  const sun = await owner.post('/schedules', { kind: 'SUN', sunEvent: 'SUNSET', offsetMin: -10, actions: [{ deviceId: state.bulb, on: true }] });
  assert.equal(sun.status, 201, JSON.stringify(sun.body));
  const next = new Date(sun.body.nextRunAt).getTime();
  assert.ok(next > Date.now() && next < Date.now() + 25 * 3600_000);
  assert.equal((await owner.del(`/schedules/${sun.body.id}`)).status, 204);

  // rules can be paused and removed
  assert.equal((await owner.patch(`/rules/${rule.body.id}`, { enabled: false })).body.enabled, false);
  assert.equal((await owner.del(`/rules/${rule.body.id}`)).status, 204);
  assert.equal((await owner.get('/rules')).body.length, 0);
});

test('electricity estimates: on-time from the history, the power each draws, the price of a unit', async () => {
  const kid = new Client();
  await kid.post('/auth/login', { email: 'kid@example.com', password: 'kidpass123' });
  await owner.post(`/devices/${state.bulb}/commands`, { on: true });
  await new Promise((r) => setTimeout(r, 1200));
  await owner.post(`/devices/${state.bulb}/commands`, { on: false });

  const first = await owner.get('/energy?days=7');
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.perDay.length, 7);
  assert.equal(first.body.tariff, 60);
  const bulb = first.body.devices.find((d) => d.id === state.bulb);
  assert.equal(bulb.wattsSource, 'guessed');
  assert.equal(bulb.watts, 15);
  assert.ok(bulb.hours >= 0);
  assert.ok(!first.body.devices.some((d) => d.id === state.sensor)); // only switches

  assert.equal((await kid.put('/home/tariff', { tariff: 45 })).status, 403);
  assert.equal((await owner.put('/home/tariff', { tariff: 45 })).status, 204);
  assert.equal((await owner.patch(`/devices/${state.bulb}`, { watts: 2000 })).body.watts, 2000);
  const after = (await owner.get('/energy?days=30')).body;
  assert.equal(after.tariff, 45);
  assert.equal(after.perDay.length, 30);
  const b2 = after.devices.find((d) => d.id === state.bulb);
  assert.equal(b2.wattsSource, 'set');
  assert.equal(b2.cost, Math.round(b2.kwh * 45));
  // a member sees the switches in their rooms
  assert.ok((await kid.get('/energy')).body.devices.some((d) => d.id === state.bulb));
  await owner.patch(`/devices/${state.bulb}`, { watts: null });
});

test('summaries: the week in lines to share; sent on Sunday evening as a notice; the assistant remembers things per person', async () => {
  const week = await owner.get('/home/summary?period=week');
  assert.equal(week.status, 200, JSON.stringify(week.body));
  assert.ok(week.body.lines.some((l) => l.startsWith('Power:')));
  assert.ok(week.body.lines.some((l) => /^Alerts: .*water leak/.test(l)), week.body.lines.join(' | '));
  assert.ok(week.body.lines.some((l) => /^Automations: \d+ switch/.test(l)));
  assert.match(week.body.text, /^\*Test home — this week\* \(/);
  assert.equal(week.body.mail, false);
  assert.equal((await owner.post('/home/summary/email?period=week')).status, 503); // no email set up in tests
  assert.match((await owner.get('/home/summary?period=day')).body.text, /— today\*/);

  // the weekly one goes out as a notice to owners and admins who want it
  const { SummaryService } = require('../../dist/monitoring/summary.service.js');
  await app.get(SummaryService).send(state.homeId, 'week');
  const notice = (await owner.get('/notifications')).body.items.find((n) => n.kind === 'weeklySummary');
  assert.ok(notice, 'weekly summary notice');
  assert.match(notice.body, /Power:/);
  // the daily one is off unless switched on
  await app.get(SummaryService).send(state.homeId, 'day');
  assert.ok(!(await owner.get('/notifications')).body.items.some((n) => n.kind === 'dailySummary'));

  // memory: each person's own, no duplicates
  const kid = new Client();
  await kid.post('/auth/login', { email: 'kid@example.com', password: 'kidpass123' });
  const m = await owner.post('/assistant/memory', { text: 'The store room light is the one by the stairs' });
  assert.equal(m.status, 201);
  assert.equal((await owner.post('/assistant/memory', { text: 'the store room light is the one by the stairs' })).body.id, m.body.id);
  assert.equal((await owner.get('/assistant/memory')).body.length, 1);
  assert.equal((await kid.get('/assistant/memory')).body.length, 0);
  assert.equal((await kid.del(`/assistant/memory/${m.body.id}`)).status, 404);
  assert.equal((await owner.del(`/assistant/memory/${m.body.id}`)).status, 204);
});

test('service tickets: the home asks, the team answers (staff notes stay private), solved by the home', async () => {
  const kid = new Client();
  await kid.post('/auth/login', { email: 'kid@example.com', password: 'kidpass123' });
  const t = await kid.post('/support/tickets', { body: 'Water is leaking near the kitchen board. Please send someone.' });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  assert.equal(t.body.priority, 'URGENT');
  assert.equal(t.body.title, 'Water is leaking near the kitchen board');
  assert.equal(t.body.statusText, 'Open');
  const t2 = await kid.post('/support/tickets', { title: 'Add a socket', body: 'Can you add one more socket in the lounge?', category: 'installation' });
  assert.equal(t2.body.number, t.body.number + 1);
  assert.equal(t2.body.priority, 'NORMAL');

  // the team sees both in the queue; the owner (an admin of the home) sees the home's tickets
  const queue = (await owner.get('/platform/tickets?status=open')).body;
  assert.ok(queue.open >= 2 && queue.tickets.some((x) => x.id === t.body.id));
  assert.equal((await owner.get('/support/tickets')).body.filter((x) => x.homeId === state.homeId).length >= 2, true);
  assert.ok((await owner.get('/notifications')).body.items.some((n) => n.kind === 'supportRequest' && n.title.includes(`#${t.body.number}`)));

  // a staff-only note, then an answer: the home sees only the answer
  await owner.post(`/platform/tickets/${t.body.id}/reply`, { body: 'Check the board enclosure for moisture', internal: true });
  const answered = await owner.post(`/platform/tickets/${t.body.id}/reply`, { body: 'Switch off the kitchen board at the DB. Our installer comes at 4 pm.' });
  assert.equal(answered.status, 201, JSON.stringify(answered.body));
  assert.equal(answered.body.status, 'IN_PROGRESS');
  assert.equal(answered.body.messages.filter((m) => m.internal).length, 1);
  const seen = (await kid.get(`/support/tickets/${t.body.id}`)).body;
  const said = seen.messages.filter((m) => !m.event);
  assert.equal(said.length, 2);
  assert.ok(!seen.messages.some((m) => /moisture/.test(m.body)));
  assert.equal(said[1].staff, true);
  assert.ok(seen.messages.some((m) => m.event && m.body === 'Status: Being worked on'));
  assert.ok((await kid.get('/notifications')).body.items.some((n) => n.kind === 'ticketReply'));

  // priority and assignment are the team's; the home marks it solved
  const upd = await owner.patch(`/platform/tickets/${t.body.id}`, { priority: 'HIGH', assigneeId: (await owner.get('/auth/me')).body.id });
  assert.equal(upd.body.priority, 'HIGH');
  assert.equal(upd.body.assignee, 'Fawad');
  const solved = await kid.post(`/support/tickets/${t.body.id}/reply`, { body: 'Fixed, thank you', solved: true });
  assert.equal(solved.body.status, 'RESOLVED');
  assert.equal((await kid.get(`/support/tickets/${t2.body.id}`)).status, 200);
  assert.equal((await kid.get('/platform/tickets')).status, 403);

  // "Send to support" in Diagnostics opens a ticket too
  const help = await owner.post('/home/support', { message: 'Board keeps restarting', nodeId: NODE_ID });
  assert.equal(help.status, 200);
  assert.equal(help.body.ticket.number, t2.body.number + 1);
});

test('installation report: checklist (some items check themselves), photos behind signed links, the customer signs', async () => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const url = `/platform/homes/${state.homeId}/installation`;
  const r = (await owner.get(url)).body;
  assert.equal(r.total, 11);
  assert.equal(r.signed, false);
  assert.equal(r.canEdit, true);
  const wifi = r.items.find((i) => i.key === 'wifi');
  assert.match(wifi.check.text, /boards online/);
  assert.match(r.items.find((i) => i.key === 'owner').check.text, /has joined/);

  // can't sign with items open
  const sig = `data:image/png;base64,${PNG.toString('base64')}`;
  const early = await owner.post(`${url}/sign`, { name: 'Fawad', signature: sig });
  assert.equal(early.status, 400);
  assert.match(early.body.message, /Tick every item first \(11 left/);

  const ticked = await owner.put(url, { items: r.items.map((i) => ({ key: i.key, done: true })), notes: 'Router moved to the hallway.' });
  assert.equal(ticked.body.done, 11);

  // photos: images only; served by a signed link that an <img> can use
  const form = (blob, name) => { const f = new FormData(); f.append('photo', blob, name); f.append('caption', 'Kitchen board'); return f; };
  const notImage = await fetch(`${base}${url}/photos`, { method: 'POST', body: form(new Blob([new Uint8Array([1, 2])], { type: 'application/pdf' }), 'x.pdf'), headers: { Cookie: owner.cookieHeader } });
  assert.equal(notImage.status, 400);
  const up = await fetch(`${base}${url}/photos`, { method: 'POST', body: form(new Blob([PNG], { type: 'image/png' }), 'board.png'), headers: { Cookie: owner.cookieHeader } });
  assert.equal(up.status, 201);
  const withPhoto = await up.json();
  assert.equal(withPhoto.photos.length, 1);
  assert.equal(withPhoto.photos[0].caption, 'Kitchen board');
  const img = await fetch(base.replace('/api', '') + withPhoto.photos[0].url);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  // a changed signature (its first character changed, whatever it was) is refused
  const forged = withPhoto.photos[0].url.replace(/sig=(\w)/, (_, c) => `sig=${c === '0' ? '1' : '0'}`);
  assert.equal((await fetch(base.replace('/api', '') + forged)).status, 403);

  // a member can't see it; the customer signs on the installer's phone; then it's a record
  const kid = new Client();
  await kid.post('/auth/login', { email: 'kid@example.com', password: 'kidpass123' });
  assert.equal((await kid.get('/home/installation')).status, 403);
  assert.equal((await owner.post(`${url}/sign`, { name: 'Fawad', signature: 'data:image/png;base64,<script>' })).status, 400);
  const signed = await owner.post(`${url}/sign`, { name: 'Fawad Iqbal', signature: sig });
  assert.equal(signed.status, 201, JSON.stringify(signed.body));
  assert.equal(signed.body.signed, true);
  assert.equal(signed.body.signedName, 'Fawad Iqbal');
  assert.equal((await owner.put(url, { notes: 'late change' })).status, 400);

  // a super admin can open it again; the owner can sign from their own phone too
  assert.equal((await owner.post(`${url}/reopen`)).body.signed, false);
  const mine = await owner.post('/home/installation/sign', { name: 'Fawad', signature: sig });
  assert.equal(mine.status, 201, JSON.stringify(mine.body));
  assert.equal(mine.body.signed, true);
  assert.equal((await owner.get('/home/installation')).body.photos.length, 1);
});

test('billing: a contract bills itself each month, one-off invoices, payments recorded, reminders when late', async () => {
  const kid = new Client();
  await kid.post('/auth/login', { email: 'kid@example.com', password: 'kidpass123' });
  const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10); // Pakistan's date
  const made = await owner.post('/platform/billing/contracts', { homeId: state.homeId, plan: 'Care plan', amount: 2500, period: 'MONTHLY', visitsIncluded: 1, startsOn: today });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.kpis.perMonth, 2500);
  assert.equal(made.body.kpis.active, 1);
  // its first bill is made at once
  const first = made.body.invoices.find((i) => i.homeId === state.homeId);
  assert.equal(first.amount, 2500);
  assert.match(first.description, /^Care plan, /);
  assert.equal(first.status, 'DUE');
  assert.equal((await owner.post('/platform/billing/contracts', { homeId: state.homeId, plan: 'Again', amount: 100, period: 'MONTHLY', startsOn: today })).status, 400);

  // the home sees its plan and bills; members don't
  const mine = (await owner.get('/billing')).body;
  assert.equal(mine.contract.plan, 'Care plan');
  assert.equal(mine.due, 2500);
  assert.ok((await owner.get('/notifications')).body.items.some((n) => n.kind === 'billing' && n.title === 'New bill: Rs 2,500'));
  assert.equal((await kid.get('/billing')).status, 403);
  assert.equal((await kid.get(`/billing/invoices/${first.id}`)).status, 404);
  const printable = (await owner.get(`/billing/invoices/${first.id}`)).body;
  assert.equal(printable.billTo.home, 'Test home');
  assert.equal(printable.contract.plan, 'Care plan');

  // a one-off bill for a visit; payments need a method
  const visit = await owner.post('/platform/billing/invoices', { homeId: state.homeId, description: 'Service visit: replace relay', amount: 1500 });
  const v = visit.body.invoices.find((i) => i.description.startsWith('Service visit'));
  assert.equal(v.number, first.number + 1);
  assert.equal((await owner.patch(`/platform/billing/invoices/${v.id}`, { status: 'PAID' })).status, 400);
  const paid = await owner.patch(`/platform/billing/invoices/${v.id}`, { status: 'PAID', method: 'jazzcash', reference: 'TX123' });
  assert.equal(paid.body.invoices.find((i) => i.id === v.id).status, 'PAID');
  assert.equal(paid.body.kpis.paidThisMonth, 1500);
  assert.ok((await owner.get('/notifications')).body.items.some((n) => n.title === `Payment received: invoice ${v.number}`));

  // next month's bill comes by itself; a late bill gets a reminder
  const { BillingService } = require('../../dist/billing/billing.service.js');
  const later = new Date(Date.now() + 33 * 86400_000);
  await app.get(BillingService).tick(later);
  const after = (await owner.get('/platform/billing')).body;
  assert.equal(after.invoices.filter((i) => i.description.startsWith('Care plan')).length, 2);
  assert.ok((await owner.get('/notifications')).body.items.some((n) => n.kind === 'billing' && /^Bill overdue: Rs 2,500/.test(n.title)));

  // pausing stops the bills; ending closes it
  const c = after.contracts.find((x) => x.homeId === state.homeId);
  assert.equal((await owner.patch(`/platform/billing/contracts/${c.id}`, { status: 'PAUSED' })).body.kpis.active, 0);
  await app.get(BillingService).tick(new Date(Date.now() + 70 * 86400_000));
  assert.equal((await owner.get('/platform/billing')).body.invoices.filter((i) => i.description.startsWith('Care plan')).length, 2);
  assert.equal((await owner.patch(`/platform/billing/contracts/${c.id}`, { status: 'ENDED' })).body.contracts.find((x) => x.id === c.id).status, 'ENDED');
});

test('two-step sign-in, sessions, and backups', async () => {
  const { codeAt } = require('../../dist/auth/totp.js');
  const now = () => codeAt(secret, Math.floor(Date.now() / 30000));
  const next = () => codeAt(secret, Math.floor(Date.now() / 30000) + 1); // a code works once; the next step's is accepted too
  let secret;
  const kid = new Client();
  await kid.post('/auth/login', { email: 'kid@example.com', password: 'kidpass123' });

  // turn it on: scan, confirm a code, keep the recovery codes
  const setup = await kid.post('/auth/2fa/setup');
  assert.equal(setup.status, 200);
  assert.match(setup.body.uri, /^otpauth:\/\/totp\/Switchboard/);
  assert.match(setup.body.qr, /^data:image\/png;base64,/);
  secret = setup.body.secret.replace(/\s/g, '');
  assert.equal((await kid.post('/auth/2fa/enable', { code: '000000' })).status, 400);
  const on = await kid.post('/auth/2fa/enable', { code: now() });
  assert.equal(on.status, 200, JSON.stringify(on.body));
  assert.equal(on.body.codes.length, 10);
  assert.equal((await kid.get('/auth/me')).body.twoFactor, true);

  // signing in now takes the password, then a code (each code once)
  const phone = new Client();
  const first = await phone.post('/auth/login', { email: 'kid@example.com', password: 'kidpass123' });
  assert.equal(first.body.twoFactor, true);
  assert.equal((await phone.get('/auth/me')).status, 401);
  assert.equal((await phone.post('/auth/login/code', { ticket: first.body.ticket, code: '123456' })).status, 401);
  assert.equal((await phone.post('/auth/login/code', { ticket: 'not-a-ticket-at-all', code: next() })).status, 401);
  const ok = await phone.post('/auth/login/code', { ticket: first.body.ticket, code: next() });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await phone.get('/auth/me')).body.email, 'kid@example.com');
  const again = await new Client().post('/auth/login', { email: 'kid@example.com', password: 'kidpass123' });
  assert.equal((await new Client().post('/auth/login/code', { ticket: again.body.ticket, code: next() })).status, 401); // same code twice
  // a recovery code works once
  const laptop = new Client();
  const t3 = (await laptop.post('/auth/login', { email: 'kid@example.com', password: 'kidpass123' })).body.ticket;
  const rec = await laptop.post('/auth/login/code', { ticket: t3, code: on.body.codes[0].toUpperCase() });
  assert.equal(rec.status, 200);
  assert.equal(rec.body.recoveryLeft, 9);
  const t4 = (await laptop.post('/auth/login', { email: 'kid@example.com', password: 'kidpass123' })).body.ticket;
  assert.equal((await laptop.post('/auth/login/code', { ticket: t4, code: on.body.codes[0] })).status, 401);

  // where you're signed in; sign the others out
  const list = (await kid.get('/auth/sessions')).body;
  assert.ok(list.length >= 3);
  assert.equal(list.filter((x) => x.current).length, 1);
  assert.equal((await kid.post('/auth/sessions/others')).body.ended >= 2, true);
  assert.equal((await phone.post('/auth/refresh')).status, 401);
  assert.equal((await kid.get('/auth/sessions')).body.length, 1);

  // off needs the password; a super admin can turn it off for someone who lost their phone
  assert.equal((await kid.post('/auth/2fa/disable', { password: 'wrong' })).status, 401);
  assert.equal((await kid.post('/auth/2fa/reset/x')).status, 403);
  const kidId = (await kid.get('/auth/me')).body.id;
  assert.equal((await owner.post(`/auth/2fa/reset/${kidId}`)).status, 204);
  assert.equal((await kid.get('/auth/me')).body.twoFactor, false);
  const plain = (await kid.post('/auth/login', { email: 'kid@example.com', password: 'kidpass123' })).body;
  assert.equal(plain.ticket, undefined);
  assert.equal(plain.email, 'kid@example.com');

  // backups: the whole database, firmware and photos in one file; super admins of a self-hosted install only
  assert.equal((await kid.get('/platform/backups')).status, 403);
  const made = await owner.post('/platform/backups');
  if (made.status === 400 && /pg_dump isn’t installed/.test(made.body.message)) {
    console.log('# pg_dump is not installed here: backup file checks skipped');
    return;
  }
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.equal(made.body.backups.length, 1);
  const b = made.body.backups[0];
  assert.match(b.name, /^switchboard-\d{8}-\d{4}-manual\.tar\.gz$/);
  assert.ok(b.size > 1000);
  const file = await fetch(`${base}/platform/backups/${b.name}`, { headers: { Cookie: owner.cookieHeader } });
  assert.equal(file.status, 200);
  const bytes = new Uint8Array(await file.arrayBuffer());
  assert.equal(bytes[0], 0x1f); // gzip
  assert.equal(bytes[1], 0x8b);
  assert.equal((await fetch(`${base}/platform/backups/..%2F..%2Fetc%2Fpasswd`, { headers: { Cookie: owner.cookieHeader } })).status, 404);
  assert.equal((await owner.del(`/platform/backups/${b.name}`)).body.backups.length, 0);
});

test('wall switches and buttons: a flip toggles at once; double-press and long press run scenes and switch rooms off', async () => {
  const applied = () => until('board applied the new config', async () => {
    const n = (await owner.get('/nodes')).body.find((x) => x.id === NODE_ID);
    return n.appliedRev === n.configRev && !n.configError;
  });
  const bulbOn = async () => (await owner.get(`/devices/${state.bulb}`)).body.state.on;

  // boards on firmware before 2.4 don't know wall switches: refused, with what to do
  await prisma.node.update({ where: { id: NODE_ID }, data: { firmware: '2.3.0' } });
  const old = await owner.post(`/nodes/${NODE_ID}/inputs`, { type: 'wall_switch', pin: 0, targetId: state.bulb });
  assert.equal(old.status, 400);
  assert.match(old.body.message, /need 2\.4\.0 or newer/);
  await prisma.node.update({ where: { id: NODE_ID }, data: { firmware: '2.5.0-fake' } });

  // an ordinary wall switch (stays up or down): every flip toggles the bulb, whatever the app did last
  const wall = await owner.post(`/nodes/${NODE_ID}/inputs`, { type: 'wall_switch', pin: 0, targetId: state.bulb, name: 'Hall wall switch' });
  assert.equal(wall.status, 201, JSON.stringify(wall.body));
  await applied();
  const before = await bulbOn();
  fake.stdin.write('flip D3\n');
  await until('flip toggled the bulb', async () => (await bulbOn()) === !before);
  fake.stdin.write('flip D3\n');
  await until('flipped back', async () => (await bulbOn()) === before);
  await until('flip seen by the server', async () => (await owner.get('/nodes')).body.find((n) => n.id === NODE_ID).inputs.find((i) => i.pin === 0)?.lastEventAt);

  // a button with no switch of its own: it needs something to do
  assert.equal((await owner.post(`/nodes/${NODE_ID}/inputs`, { type: 'toggle_button', pin: 2 })).status, 400);
  const scene = (await owner.post('/scenes', { name: 'Lights out', actions: [{ deviceId: state.bulb, on: false }] })).body;
  const button = await owner.post(`/nodes/${NODE_ID}/inputs`, {
    type: 'toggle_button', pin: 2, name: 'Bedside button', settings: { gestures: true },
    actions: { double: { type: 'scene', sceneId: scene.id }, long: { type: 'allOff', roomId: state.livingRoom } },
  });
  assert.equal(button.status, 201, JSON.stringify(button.body));
  await applied();
  const node = (await owner.get('/nodes')).body.find((n) => n.id === NODE_ID);
  const b = node.inputs.find((i) => i.pin === 2);
  assert.equal(b.targetName, null);
  assert.equal(b.actions.double.type, 'scene');

  await owner.post(`/devices/${state.bulb}/commands`, { on: true });
  fake.stdin.write('double D4\n');
  await until('double-press ran the scene', async () => (await bulbOn()) === false);
  await owner.post(`/devices/${state.bulb}/commands`, { on: true });
  fake.stdin.write('hold D4\n');
  await until('long press switched the room off', async () => (await bulbOn()) === false);
  assert.equal((await prisma.command.findFirst({ where: { deviceId: state.bulb }, orderBy: { createdAt: 'desc' } })).channel, 'automation');

  // change what it does; members can't
  const changed = await owner.patch(`/inputs/${b.id}`, { name: 'Bed button', actions: { double: { type: 'device', deviceId: state.bulb } } });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal(changed.body.name, 'Bed button');
  assert.deepEqual(Object.keys(changed.body.actions), ['double']);
  fake.stdin.write('double D4\n');
  await until('double-press toggled the bulb', async () => (await bulbOn()) === true);
  assert.equal((await member.patch(`/inputs/${b.id}`, { name: 'x' })).status, 403);
  await owner.del(`/inputs/${b.id}`);
  await owner.del(`/inputs/${wall.body.id}`);
  await applied();
});

/** What the phone app does when the internet is down: a signed request straight to the board. */
async function localCall(board, urlPath, body = '', tamper = {}) {
  const { createHmac } = require('node:crypto');
  const hello = await (await fetch(`http://${board.ip}/local/hello`)).json();
  const nonce = tamper.nonce ?? hello.nonce;
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const sig = createHmac('sha256', board.passKey).update(`${nonce}\n${urlPath}\n${text}`).digest('hex');
  const res = await fetch(`http://${board.ip}${urlPath}`, {
    method: 'POST', body: text, headers: { 'X-Pass': tamper.pass ?? board.pass, 'X-Nonce': nonce, 'X-Sig': sig },
  });
  return { status: res.status, body: await res.json(), nonce };
}

test('local control: the phone switches the board over Wi-Fi with a pass, even with the internet down', async () => {
  const memberId = (await member.get('/auth/me')).body.id;
  // giving rights retires older passes and makes sure the board holds the current key
  await owner.put(`/users/${memberId}/rooms`, { rooms: [{ roomId: state.livingRoom, access: 'CONTROL' }] });
  const ready = await until('board holds the key', async () => (await owner.get('/nodes/local')).body.find((n) => n.nodeId === NODE_ID && n.ready), 10000);
  assert.equal(ready.supported, true);
  assert.equal((await owner.get('/nodes')).body.find((n) => n.id === NODE_ID).localControl, 'ready');
  assert.equal((await member.get('/nodes/local')).status, 403);
  await prisma.device.update({ where: { id: state.bulb }, data: { childLock: false } });

  const mine = (await member.get('/local')).body;
  const board = mine.boards.find((b) => b.nodeId === NODE_ID);
  assert.equal(board.ready, true);
  assert.equal(board.ip, `127.0.0.1:${LOCAL_PORT}`);
  const pass = JSON.parse(Buffer.from(board.pass, 'base64url').toString());
  assert.equal(pass.u, memberId);
  assert.deepEqual(pass.c, ['bulb']);                       // the sensor can be seen, not switched
  assert.ok(pass.v.includes('room_climate'));
  assert.equal(board.devices.find((d) => d.key === 'room_climate').control, false);

  // switch it straight on the board; the server hears it as switched from the phone
  const before = (await owner.get(`/devices/${state.bulb}`)).body.state.on;
  const sw = await localCall(board, '/local/command', { key: 'bulb', on: !before });
  assert.equal(sw.status, 200, JSON.stringify(sw.body));
  assert.equal(sw.body.state.on, !before);
  await until('server saw the local switch', async () => (await owner.get(`/devices/${state.bulb}`)).body.state.on === !before);
  const st = await localCall(board, '/local/state');
  assert.deepEqual(st.body.devices.map((d) => d.key).sort(), [...pass.v].sort());

  // what doesn't work: a nonce used twice, an edited pass, switching what the pass doesn't allow
  assert.equal((await localCall(board, '/local/command', { key: 'bulb', toggle: true }, { nonce: sw.nonce })).status, 401);
  const edited = Buffer.from(JSON.stringify({ ...pass, c: ['bulb', 'room_climate'] })).toString('base64url');
  assert.equal((await localCall(board, '/local/command', { key: 'bulb', toggle: true }, { pass: edited })).status, 401);
  assert.equal((await localCall(board, '/local/command', { key: 'room_climate', on: true })).status, 403);

  // rights reduced: the old pass stops working; the new one may only look
  await owner.put(`/users/${memberId}/rooms`, { rooms: [{ roomId: state.livingRoom, access: 'VIEW' }] });
  await until('old pass refused', async () => (await localCall(board, '/local/state')).status === 401);
  const viewer = (await member.get('/local')).body.boards.find((b) => b.nodeId === NODE_ID);
  await until('new pass accepted', async () => (await localCall(viewer, '/local/state')).status === 200);
  assert.equal((await localCall(viewer, '/local/command', { key: 'bulb', toggle: true })).status, 403);
  await owner.put(`/users/${memberId}/rooms`, { rooms: [{ roomId: state.livingRoom, access: 'CONTROL' }] });

  // the internet goes: the board still answers the phone, and tells the server when it's back
  const ownerBoard = (await owner.get('/local')).body.boards.find((b) => b.nodeId === NODE_ID);
  await until('owner pass accepted', async () => (await localCall(ownerBoard, '/local/state')).status === 200);
  const online = async () => (await owner.get('/nodes')).body.find((n) => n.id === NODE_ID)?.online;
  fake.stdin.write('drop\n');
  await until('offline', async () => !(await online()), 12000);
  const now = (await owner.get(`/devices/${state.bulb}`)).body.state.on;
  const offlineSwitch = await localCall(ownerBoard, '/local/command', { key: 'bulb', on: !now });
  assert.equal(offlineSwitch.status, 200, JSON.stringify(offlineSwitch.body));
  fake.stdin.write('rejoin\n');
  await until('online again', online, 12000);
  await until('server caught up', async () => (await owner.get(`/devices/${state.bulb}`)).body.state.on === !now);
  // (the outages test below counts its own outages)
  await until('outage closed', async () => !(await prisma.node.findUnique({ where: { id: NODE_ID } })).offlineSince);
  await prisma.outage.deleteMany({ where: { nodeId: NODE_ID } });
});

test('firmware: upload a build, send it to a board over Wi-Fi, the board verifies and runs it', async () => {
  const bad = new FormData();
  bad.append('file', new Blob([new Uint8Array([1, 2, 3])]), 'x.bin');
  bad.append('version', '9.9.9');
  const refused = await fetch(`${base}/firmware`, { method: 'POST', body: bad, headers: { Cookie: owner.cookieHeader } });
  assert.equal(refused.status, 400);

  // a build stamps its FIRMWARE_VERSION into the .bin; the server reads it and the board reports it
  const stamped = (version, size = 4096) => {
    const image = new Uint8Array(size).fill(7);
    image[0] = 0xe9;
    if (version) image.set(new TextEncoder().encode(`@@HOMENODE-FW:${version}@@`), 100);
    return new Blob([image]);
  };
  const upload = (blob, version) => {
    const form = new FormData();
    form.append('file', blob, 'home_node.ino.bin');
    if (version !== undefined) form.append('version', version);
    return fetch(`${base}/firmware`, { method: 'POST', body: form, headers: { Cookie: owner.cookieHeader } });
  };
  // typing another number than the file says is refused (the board would report the file's number)
  const wrong = await upload(stamped('2.9.0-test'), '3.0.0');
  assert.equal(wrong.status, 400);
  assert.match((await wrong.json()).message, /built as firmware 2\.9\.0-test/);

  const up = await upload(stamped('2.9.0-test'));            // no version typed: read from the file
  assert.equal(up.status, 201);
  const fw = await up.json();
  assert.equal(fw.size, 4096);
  assert.equal(fw.version, '2.9.0-test');
  assert.equal((await upload(stamped('2.9.0-test'))).status, 400); // the same number twice

  const sent = await owner.post(`/nodes/${NODE_ID}/update`, { firmwareId: fw.id });
  assert.equal(sent.status, 201);
  await until('board runs the new firmware', async () => (await owner.get('/nodes')).body.find((n) => n.id === NODE_ID)?.firmware === '2.9.0-test', 10000);

  // an old build without the stamp, labelled 3.0.0: the board installs it but still reports what it was built as
  const legacy = await upload(stamped(null), '3.0.0');
  assert.equal(legacy.status, 201);
  await owner.post(`/nodes/${NODE_ID}/update`, { firmwareId: (await legacy.json()).id });
  await new Promise((r) => setTimeout(r, 2500));
  assert.equal((await owner.get('/nodes')).body.find((n) => n.id === NODE_ID)?.firmware, '2.9.0-test');
  // links cannot be forged
  const forged = await fetch(`${base}/firmware/${fw.id}/download?node=${NODE_ID}&exp=${Date.now() + 60000}&sig=abc`);
  assert.equal(forged.status, 404);
  assert.equal((await member.get('/firmware')).status, 403);
});

test('staged firmware rollout: one board first, waves after, stops when a board fails', async () => {
  const stamped = (version, size = 4096) => {
    const image = new Uint8Array(size).fill(7);
    image[0] = 0xe9;
    if (version) image.set(new TextEncoder().encode(`@@HOMENODE-FW:${version}@@`), 100);
    return new Blob([image]);
  };
  const upload = async (blob, version) => {
    const form = new FormData();
    form.append('file', blob, 'home_node.ino.bin');
    if (version !== undefined) form.append('version', version);
    return (await fetch(`${base}/firmware`, { method: 'POST', body: form, headers: { Cookie: owner.cookieHeader } })).json();
  };
  const good = await upload(stamped('2.10.0-test'));
  assert.equal((await member.post('/platform/rollouts', { firmwareId: good.id })).status, 403);
  const started = await owner.post('/platform/rollouts', { firmwareId: good.id, daytimeOnly: false, skipWeak: false, waveGapMin: 0 });
  assert.equal(started.status, 201, JSON.stringify(started.body));
  const r = started.body.rollouts[0];
  assert.equal(r.version, '2.10.0-test');
  assert.equal(r.counts.total, 1);
  assert.equal(r.targets[0].wave, 0);
  assert.equal((await owner.post('/platform/rollouts', { firmwareId: good.id })).status, 400); // one at a time
  const done = await until('rollout finished', async () => (await owner.get('/platform/rollouts')).body.rollouts.find((x) => x.id === r.id && x.status === 'DONE'), 15000);
  assert.equal(done.counts.done, 1);
  assert.equal(done.targets[0].fromVersion, '2.9.0-test');
  assert.equal((await owner.get('/nodes')).body.find((n) => n.id === NODE_ID).firmware, '2.10.0-test');
  assert.match((await owner.post('/platform/rollouts', { firmwareId: good.id })).body.message, /Every board already runs 2\.10\.0-test/);

  // a build that doesn't come up as itself: the rollout stops and says why
  const broken = await upload(stamped(null), '3.1.0');
  const r2 = (await owner.post('/platform/rollouts', { firmwareId: broken.id, daytimeOnly: false, skipWeak: false })).body.rollouts[0];
  const halted = await until('rollout stopped', async () => (await owner.get('/platform/rollouts')).body.rollouts.find((x) => x.id === r2.id && x.status === 'HALTED'), 15000);
  assert.match(halted.haltReason, /1 board failed .*reports firmware 2\.10\.0-test/);
  assert.ok((await owner.get('/notifications')).body.items.some((n) => n.kind === 'firmware' && /rollout stopped/.test(n.title)));
  const cancelled = await owner.post(`/platform/rollouts/${r2.id}/cancel`);
  assert.equal(cancelled.body.rollouts.find((x) => x.id === r2.id).status, 'CANCELLED');
});

test('outages: the internet drops (the board stays on), then a power cut (the board starts again)', async () => {
  owner.home = state.homeId;
  const online = () => owner.get('/devices').then((r) => r.body.every((d) => d.online));
  // the Wi-Fi or internet goes: the broker loses the board; it comes back without restarting
  fake.stdin.write('drop\n');
  await until('offline', async () => !(await online()), 12000);
  assert.ok((await prisma.node.findUnique({ where: { id: NODE_ID } })).offlineSince);
  await new Promise((r) => setTimeout(r, 1500));
  fake.stdin.write('rejoin\n');
  await until('online again', online, 12000);
  const net = await until('internet outage recorded', async () => (await owner.get('/outages')).body.outages.find((o) => o.kind === 'NETWORK'));
  assert.equal(net.label, 'Wi‑Fi or internet down');
  assert.ok(net.seconds >= 1);
  assert.equal((await prisma.node.findUnique({ where: { id: NODE_ID } })).offlineSince, null);

  // a power cut: the board is gone, then starts from scratch ("Power On", uptime back to 0)
  await new Promise((r) => setTimeout(r, 16000));   // it has been running a while (a restart moves its start time forward)
  fake.kill('SIGKILL');
  await until('offline', async () => !(await online()), 12000);
  fake = spawn('python3', [path.join(ROOT, 'tools/fake-node/fake_node.py'), '--id', NODE_ID, '--keepalive', '2',
    '--local-port', String(LOCAL_PORT), '--password', process.env.MQTT_NODE_PASSWORD ?? ''], { env: { ...process.env }, stdio: ['pipe', 'pipe', 'inherit'] });
  await until('online again', online, 15000);
  const cut = await until('power cut recorded', async () => (await owner.get('/outages')).body.outages.find((o) => o.kind === 'POWER'));
  assert.equal(cut.label, 'Power cut');
  assert.equal(cut.reset, 'Power On');
  const body = (await owner.get('/outages')).body;
  assert.equal(body.summary.powerCuts, 1);
  assert.equal(body.summary.networkOuts, 1);
  if (cut.seconds >= 20) {
    const n = await until('power cut notice', async () => (await owner.get('/notifications')).body.items.find((x) => x.kind === 'powerCut'));
    assert.match(n.body, /^No power from /);
  }
  // a member sees the home's outages too; the console sees them per home
  assert.equal((await member.get('/outages')).status, 200);
  const staff = (await owner.get('/platform/outages')).body;
  assert.equal(staff.homes[0].power, 1);
  assert.deepEqual(staff.down, []);
});

test('a board that disappears goes offline and commands say so', async () => {
  fake.kill('SIGKILL');
  await until('offline via Last Will', async () => (await owner.get('/devices')).body.every((d) => !d.online), 12000);
  const res = await owner.post(`/devices/${state.bulb}/commands`, { on: false });
  assert.equal(res.status, 503);
  assert.match(res.body.message, /offline/);
  // no notice straight away: most cuts are over in minutes and get one notice when they end
  assert.ok((await prisma.node.findUnique({ where: { id: NODE_ID } })).offlineSince);
  assert.equal((await owner.get('/platform/outages')).body.down.length, 1);
});

test('the platform console: overview, homes, workspace, audit', async () => {
  const me = (await owner.get('/auth/me')).body;
  assert.equal(me.staff.role, 'SUPERADMIN');
  const o = await owner.get('/platform/overview');
  assert.equal(o.status, 200);
  assert.equal(o.body.kpis.homes, 1);
  assert.equal(o.body.kpis.boardsInstalled, 1);
  assert.ok(o.body.kpis.commands >= 3);
  assert.equal(o.body.bars.length, 24);
  assert.ok(o.body.attention.some((a) => a.tone === 'bad')); // the board just went offline
  assert.ok(o.body.services.find((s) => s.key === 'database').ok);
  const homes = (await owner.get('/platform/homes')).body;
  assert.equal(homes.length, 1);
  assert.equal(homes[0].status, 'attention');
  const ws = (await owner.get(`/platform/homes/${state.homeId}`)).body;
  assert.equal(ws.stepsDone, 6); // owner is a member: handed over
  assert.equal(ws.boards[0].cond, 'bad');
  const audit = (await owner.get('/platform/audit')).body;
  assert.ok(audit.some((a) => a.action === 'board.assign'));
  assert.ok(audit.some((a) => a.action === 'board.offline' && a.system));
  assert.ok((await owner.get('/platform/audit?category=access')).body.every((a) => a.category === 'access'));
  const csv = await fetch(`${base}/platform/audit.csv`, { headers: { Cookie: owner.cookieHeader } });
  assert.match(await csv.text(), /^When,Who,Role,Action,What,Home/);
  const activity = (await owner.get('/home/activity')).body;
  assert.ok(activity.length > 0 && activity.every((a) => a.homeId === state.homeId));
  // home people are not staff
  assert.equal((await member.get('/platform/overview')).status, 403);
  assert.equal((await member.get('/home/activity')).status, 403);
});

test('SaaS: a second organization is isolated, staff roles do what they should', async () => {
  const other = new Client();
  const signed = await other.post('/auth/signup', { orgName: 'Bright Homes', name: 'Sana', email: 'sana@bright.example', password: 'secret123' });
  assert.equal(signed.status, 201);
  assert.equal(signed.body.staff.org.status, 'TRIAL');
  assert.equal(signed.body.home, null);
  assert.deepEqual((await other.get('/platform/homes')).body, []);
  // cannot open the first organization's home or its boards
  other.home = state.homeId;
  assert.equal((await other.get('/devices')).status, 404);
  assert.equal((await other.get(`/platform/homes/${state.homeId}`)).status, 404);
  other.home = null;
  assert.equal((await other.post('/platform/inventory', { ids: [NODE_ID], board: 'NODEMCU_V2' })).status, 409);
  assert.equal((await other.get('/devices')).status, 409); // no home picked

  // their own home, an installer and a support person
  const created = await other.post('/platform/homes', { name: 'Iyer apartment', city: 'Chennai', owner: { email: 'karthik@example.com', name: 'Karthik' }, rooms: ['Hall'] });
  assert.equal(created.status, 201);
  assert.ok(created.body.invite.path.startsWith('/invite/'));
  const homeB = created.body.id;
  const inst = await other.post('/platform/staff/invites', { email: 'ravi@bright.example', name: 'Ravi', staffRole: 'INSTALLER' });
  const sup = await other.post('/platform/staff/invites', { email: 'neha@bright.example', name: 'Neha', staffRole: 'SUPPORT' });
  const installer = new Client();
  const support = new Client();
  assert.equal((await installer.post(`/invites/${inst.body.token}/accept`, { name: 'Ravi', password: 'secret123' })).status, 201);
  assert.equal((await support.post(`/invites/${sup.body.token}/accept`, { name: 'Neha', password: 'secret123' })).status, 201);
  assert.equal((await installer.get('/auth/me')).body.staff.role, 'INSTALLER');

  // installers see only homes assigned to them
  assert.deepEqual((await installer.get('/platform/homes')).body, []);
  const team = (await other.get('/platform/staff')).body.people;
  const raviId = team.find((p) => p.email === 'ravi@bright.example').id;
  assert.equal((await other.patch(`/platform/homes/${homeB}`, { installerId: raviId })).status, 200);
  assert.equal((await installer.get('/platform/homes')).body.length, 1);
  installer.home = homeB;
  const room = await installer.post('/rooms', { name: 'Kitchen' });
  assert.equal(room.status, 201);
  assert.equal((await installer.post('/invites', { email: 'x@example.com', role: 'MEMBER' })).status, 403);
  // staff cannot make themselves (or a colleague) the owner of a customer's home
  assert.equal((await installer.post('/invites', { email: 'ravi@bright.example', role: 'OWNER' })).status, 403);
  assert.equal((await installer.get('/platform/inventory')).status, 403);

  // support reads everything, changes nothing
  support.home = homeB;
  assert.equal((await support.get('/rooms')).status, 200);
  assert.equal((await support.get('/nodes')).status, 200);
  assert.equal((await support.post('/rooms', { name: 'Garage' })).status, 403);
  assert.equal((await support.get('/platform/overview')).status, 200);
  assert.equal((await support.post('/platform/homes', { name: 'Nope' })).status, 403);

  // the owner accepts: a membership in that home, home view, read-only boards
  const karthik = new Client();
  const acc = await karthik.post(`${created.body.invite.path.replace('/invite/', '/invites/')}/accept`, { name: 'Karthik', password: 'secret123' });
  assert.equal(acc.status, 201);
  assert.equal(acc.body.home.id, homeB);
  assert.equal(acc.body.home.role, 'OWNER');
  assert.equal(acc.body.home.canSetup, false);
  assert.equal((await karthik.post('/nodes/scan')).status, 403);
  assert.equal((await karthik.post('/invites', { email: 'kid2@example.com', role: 'MEMBER' })).status, 201);
  assert.equal((await karthik.post('/home/support', { message: 'Kitchen light flickers' })).status, 200);
  const ws = (await other.get(`/platform/homes/${homeB}`)).body;
  assert.equal(ws.steps[5].done, true);

  // the owner of the first home also belongs to it only
  assert.deepEqual((await karthik.get('/auth/me')).body.homes.map((h) => h.id), [homeB]);

  // a super admin of one organization who is a guest in another organization's home gets no setup rights there
  const guestInvite = await owner.post('/invites', { email: 'sana@bright.example', role: 'GUEST' });
  assert.equal(guestInvite.status, 201);
  assert.equal((await other.post(`/invites/${guestInvite.body.token}/accept`, { password: 'secret123' })).status, 201);
  other.home = state.homeId;
  assert.equal((await other.get('/auth/me')).body.home.canSetup, false);
  assert.equal((await other.post('/nodes/scan')).status, 403);
  assert.equal((await other.del(`/nodes/${NODE_ID}`)).status, 403);
  assert.equal((await other.get('/nodes')).status, 403);
  other.home = null;

  // your own company (the self-hosted one): no plans, no limits
  const mine = (await owner.get('/platform/org')).body;
  assert.equal(mine.selfHosted, true);
  assert.deepEqual(mine.limits, { homes: null, boards: null, staff: null });
  assert.equal((await owner.post('/platform/org/plan', { plan: 'PRO' })).status, 400);
  assert.equal((await owner.get('/auth/me')).body.staff.org.selfHosted, true);

  // plan limits and billing (a company that signed up)
  const org = (await other.get('/platform/org')).body;
  assert.equal(org.selfHosted, false);
  assert.equal(org.plan, 'STARTER');
  assert.equal(org.usage.homes, 1);
  for (let i = 0; i < 4; i++) assert.equal((await other.post('/platform/homes', { name: `Home ${i}` })).status, 201);
  assert.equal((await other.post('/platform/homes', { name: 'One too many' })).status, 403);
  assert.equal((await other.post('/platform/org/plan', { plan: 'PRO' })).body.plan, 'PRO');
  assert.equal((await other.post('/platform/homes', { name: 'Now fine' })).status, 201);

  // assigning a board with an installer hands them the job, even when the home already had an installer
  // (here the super admin who created it): it shows in their "My jobs" and they can open the home
  const bossId = (await other.get('/auth/me')).body.id;
  const shah = (await other.post('/platform/homes', { name: 'Shah house', installerId: bossId })).body.id;
  assert.equal((await other.post('/platform/inventory', { ids: ['esp-move01'], board: 'NODEMCU_V2' })).status, 201);
  assert.equal((await other.post('/platform/inventory/esp-move01/assign', { homeId: shah, installerId: raviId })).status, 200);
  fs.appendFileSync(BROKER_LOG, `${Math.floor(Date.now() / 1000)}: New client connected from 39.45.77.1:50000 as esp-move01 (p4, c1, k15, u'node').\n`);
  await until('connection of the assigned board', async () => (await prisma.nodeConnection.count({ where: { nodeId: 'esp-move01' } })) === 1);
  const jobs = (await installer.get('/platform/homes')).body;
  assert.ok(jobs.some((h) => h.id === shah && h.installerId === raviId), 'the job reaches the installer');
  installer.home = shah;
  assert.equal((await installer.get('/auth/me')).body.home.canSetup, true);
  installer.home = null;

  // who sees which boards' connections in the console (and so what the console assistant can tell them)
  const nowFine = (await other.get('/platform/homes')).body.find((h) => h.name === 'Now fine').id;
  assert.equal((await other.post('/platform/inventory', { ids: ['esp-other02'], board: 'NODEMCU_V2' })).status, 201);
  assert.equal((await other.post('/platform/inventory/esp-other02/assign', { homeId: nowFine })).status, 200);
  const ids = async (who) => (await who.get('/platform/connectivity')).body.boards.map((b) => b.id).sort();
  assert.deepEqual(await ids(other), ['esp-move01', 'esp-other02']);          // super admin: the whole company
  assert.deepEqual(await ids(support), ['esp-move01', 'esp-other02']);        // support: everything, read-only
  assert.deepEqual(await ids(installer), ['esp-move01']);                     // installer: only their jobs
  assert.equal((await installer.get('/platform/boards/esp-other02/connections')).status, 404);
  assert.equal((await installer.get('/platform/boards/esp-move01/connections')).body.current.ip, '39.45.77.1');
  assert.ok(!(await ids(other)).includes(NODE_ID), 'another company never sees our boards');
  assert.equal((await other.get(`/platform/boards/${NODE_ID}/connections`)).status, 404);

  // back to stock: the next customer must not see where this home is
  assert.equal((await other.post('/platform/inventory/esp-move01/unassign')).status, 200);
  assert.equal(await prisma.nodeConnection.count({ where: { nodeId: 'esp-move01' } }), 0);
  assert.equal((await prisma.node.findUnique({ where: { id: 'esp-move01' } })).publicIp, null);
  assert.equal((await installer.post('/platform/org/plan', { plan: 'BUSINESS' })).status, 403);
});

test('website: "Book a free visit" reaches the organization; the public form is guarded', async () => {
  const send = (body, ip) => fetch(`${base}/public/visit-requests`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify(body),
  });
  const good = { name: 'Sana Malik', phone: '0300 1234567', city: 'Karachi', homeSize: '5 Marla' };
  assert.equal((await send({ ...good, phone: 'call me' }, '203.0.113.7')).status, 400);
  assert.equal((await send({ ...good, name: 'Bot', website: 'https://spam.example' }, '203.0.113.7')).status, 201); // a bot: thanked, not stored
  assert.equal((await send(good, '203.0.113.7')).status, 201);

  const list = await owner.get('/platform/visit-requests');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.requests.map((r) => [r.name, r.status]), [['Sana Malik', 'NEW']]);
  assert.equal(list.body.counts.NEW, 1);
  assert.equal((await member.get('/platform/visit-requests')).status, 403); // home members never see them

  const id = list.body.requests[0].id;
  assert.equal((await owner.patch(`/platform/visit-requests/${id}`, { status: 'CONTACTED', note: 'Visit Saturday' })).status, 200);
  assert.equal((await owner.get('/platform/visit-requests')).body.requests[0].statusLabel, 'Called');

  // five an hour from one visitor; others are not affected
  for (let i = 0; i < 4; i++) assert.equal((await send(good, '203.0.113.7')).status, 201);
  assert.equal((await send(good, '203.0.113.7')).status, 429);
  assert.equal((await send(good, '198.51.100.4')).status, 201);
});

test('sign-up and first run: password rules, the invite page, the owner and company tours', async () => {
  const boss = new Client();
  const weak = await boss.post('/auth/signup', { orgName: 'Glow Homes', name: 'Faraz', email: 'faraz@glow.example', password: 'onlyletters' });
  assert.equal(weak.status, 400);
  assert.match(weak.body.message, /number or a symbol/);
  assert.match((await boss.post('/auth/signup', { orgName: 'Glow Homes', name: 'Faraz', email: 'faraz@glow.example', password: 'Password1' })).body.message, /too common/);
  const signed = await boss.post('/auth/signup', { orgName: 'Glow Homes', name: 'Faraz Ali', email: 'faraz@glow.example', password: 'lamp-post-42' });
  assert.equal(signed.status, 201);
  assert.equal(signed.body.staff.org.onboarded, false); // a new organization gets the company tour
  assert.equal((await owner.get('/auth/me')).body.home.onboarded, true); // setup: you made your own home, no owner tour

  // step 1: the company
  assert.equal((await boss.patch('/platform/org', { logo: 'data:text/html;base64,PGI+' })).status, 400);
  const logo = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal((await boss.patch('/platform/org', { logo, cities: ['Lahore', 'Lahore', 'Karachi'], teamSize: '2–5' })).status, 200);
  const org = (await boss.get('/platform/org')).body;
  assert.deepEqual([org.logo, org.cities, org.teamSize, org.onboarded], [logo, ['Lahore', 'Karachi'], '2–5', false]);
  // step 2: a first home, with its owner's invite
  const me = (await boss.get('/auth/me')).body;
  const home = await boss.post('/platform/homes', { name: 'Khan residence', city: 'Lahore', installerId: me.id, owner: { email: 'ayesha@example.com', name: 'Ayesha Khan' }, rooms: ['Living room', 'Kitchen'] });
  assert.equal(home.status, 201);
  const token = home.body.invite.path.split('/').pop();
  const page = (await new Client().get(`/invites/${token}`)).body;
  assert.equal(page.role, 'OWNER');
  assert.equal(page.inviter, 'Faraz Ali');
  assert.equal(page.orgName, 'Glow Homes');
  assert.equal(page.orgLogo, logo);
  assert.equal(page.home.installer, 'Faraz Ali');
  assert.deepEqual(page.home.rooms.map((r) => r.name).sort(), ['Kitchen', 'Living room']);
  assert.equal(page.existingAccount, false);
  // the owner's password follows the same rules
  const ayesha = new Client();
  assert.equal((await ayesha.post(`/invites/${token}/accept`, { name: 'Ayesha Khan', password: '12345678' })).status, 400);
  const joined = await ayesha.post(`/invites/${token}/accept`, { name: 'Ayesha Khan', password: 'Sunflower#7' });
  assert.equal(joined.status, 201);
  assert.equal(joined.body.home.onboarded, false); // the owner tour is waiting
  const welcome = (await ayesha.get('/home/welcome')).body;
  assert.equal(welcome.home.name, 'Khan residence');
  assert.equal(welcome.installer, 'Faraz Ali');
  assert.equal(welcome.org.name, 'Glow Homes');
  assert.equal(welcome.rooms.length, 2);
  assert.equal(welcome.tryDevice, null); // nothing installed yet
  assert.equal((await ayesha.post('/home/onboarded')).status, 204);
  assert.equal((await ayesha.get('/auth/me')).body.home.onboarded, true);
  // staff looking into the home never get the owner's tour
  boss.home = home.body.id;
  assert.equal((await boss.get('/auth/me')).body.home.onboarded, true);
  boss.home = null;
  // step 4: done
  assert.equal((await boss.patch('/platform/org', { onboarded: true })).status, 200);
  assert.equal((await boss.get('/auth/me')).body.staff.org.onboarded, true);

  // a wrong password says so, without saying which part was wrong
  const wrong = await new Client().post('/auth/login', { email: 'faraz@glow.example', password: 'nope' });
  assert.equal(wrong.status, 401);
  assert.match(wrong.body.message, /^Wrong email or password\./);
});

test('Help Center: starter articles, policies as drafts, staff-only articles, editing, isolation', async () => {
  const list = (await owner.get('/platform/help')).body;
  assert.deepEqual(list.map((a) => a.slug).sort(), ['policy/warranty', 'process/adopt-a-board', 'usage/switch-a-device']);
  const warranty = list.find((a) => a.slug === 'policy/warranty');
  assert.equal(warranty.published, false); // a policy is a promise to customers: it starts as a draft
  assert.deepEqual(list.find((a) => a.slug === 'usage/switch-a-device').tags, ['batti', 'pankha']);

  // what the assistant gets: published only; staff articles only for the company's staff
  const titles = (r) => r.body.articles.map((a) => a.title).sort();
  assert.deepEqual(titles(await owner.get('/help/feed?articles=1')), ['Adopt a board on installation day', 'Switch a device on or off']);
  assert.deepEqual(titles(await owner.get('/help/feed?articles=1&view=customer')), ['Switch a device on or off']);
  assert.deepEqual(titles(await member.get('/help/feed?articles=1&view=staff')), ['Switch a device on or off']);
  const before = (await member.get('/help/feed')).body.key;

  // only super admins edit; members can't even read the console list
  assert.equal((await member.get('/platform/help')).status, 403);
  assert.equal((await member.get(`/platform/help/${warranty.id}`)).status, 403);
  const page = (await owner.get(`/platform/help/${warranty.id}`)).body;
  assert.equal(page.title, warranty.title);
  assert.equal(page.starter, true);
  assert.equal(page.updatedBy, null);
  assert.equal((await owner.get('/platform/help/nope')).status, 404);
  assert.equal((await member.patch(`/platform/help/${warranty.id}`, { published: true })).status, 403);
  assert.equal((await owner.patch(`/platform/help/${warranty.id}`, { published: true, body: 'Boards: 12 months.' })).status, 200);
  const after = await member.get('/help/feed?articles=1');
  assert.notEqual(after.body.key, before); // the assistant rebuilds its index
  assert.ok(after.body.articles.some((a) => a.title === 'Warranty' && a.body === 'Boards: 12 months.'));

  const made = await owner.post('/platform/help', { title: 'Service hours', category: 'POLICY', body: 'Mon to Sat.', published: true });
  const madePage = (await owner.get(`/platform/help/${made.body.id}`)).body;
  assert.equal(madePage.starter, false);
  assert.equal(madePage.updatedBy, 'Fawad');
  assert.equal(made.status, 201);
  assert.equal((await owner.post('/platform/help', { title: 'x', category: 'POLICY', body: '' })).status, 400);
  assert.equal((await owner.del(`/platform/help/${made.body.id}`)).status, 204);
  assert.ok(!(await owner.get('/platform/help')).body.some((a) => a.id === made.body.id));
  // removed starter articles stay removed (kept archived, matched by slug)
  assert.equal((await owner.del(`/platform/help/${warranty.id}`)).status, 204);
  const archived = await prisma.helpArticle.findUnique({ where: { id: warranty.id } });
  assert.ok(archived.archivedAt);

  // another company gets its own copy and can't touch this one's
  const other = new Client();
  assert.equal((await other.post('/auth/signup', { orgName: 'Help Co', name: 'Hina', email: 'hina@help.example', password: 'secret123' })).status, 201);
  const theirs = (await other.get('/platform/help')).body;
  assert.equal(theirs.length, 3);
  assert.ok(theirs.every((a) => !list.some((b) => b.id === a.id)));
  const mine = (await owner.get('/platform/help')).body[0];
  assert.equal((await other.patch(`/platform/help/${mine.id}`, { title: 'Hacked' })).status, 404);
  assert.equal((await other.get(`/platform/help/${mine.id}`)).status, 404);   // nor read it
});


test('passwords: forgot (same answer for everyone), links made by the owner or a super admin, change while signed in', async () => {
  // "Forgot password?" never tells whether an account exists (and without email set up it says so)
  assert.deepEqual((await new Client().post('/auth/forgot', { email: 'kid@example.com' })).body, { mail: false });
  assert.deepEqual((await new Client().post('/auth/forgot', { email: 'nobody@example.com' })).body, { mail: false });

  // the owner makes a link for a family member who only belongs to this home
  owner.home = state.homeId;
  const kid = new Client();
  await kid.post('/auth/login', { email: 'kid@example.com', password: 'kidpass123' });
  const kidId = (await kid.get('/auth/me')).body.id;
  assert.equal((await kid.post(`/users/${owner.id ?? 'x'}/reset-link`)).status, 403);           // a member can't
  const me = (await owner.get('/auth/me')).body;
  assert.equal((await owner.post(`/users/${me.id}/reset-link`)).status, 400);                  // not for yourself
  const link = await owner.post(`/users/${kidId}/reset-link`);
  assert.equal(link.status, 201, JSON.stringify(link.body));
  assert.equal(link.body.expiresInHours, 24);
  const token = link.body.path.split('/').pop();
  const info = (await new Client().get(`/auth/reset/${token}`)).body;
  assert.equal(info.name, 'Ali');
  assert.equal(info.email, 'k**@example.com');
  assert.equal(info.madeByOther, true);
  assert.equal((await new Client().post(`/auth/reset/${token}`, { password: 'password' })).status, 400);   // too common
  const fresh = new Client();
  const done = await fresh.post(`/auth/reset/${token}`, { password: 'new-kid-pass-7' });
  assert.equal(done.status, 200);
  assert.equal(done.body.email, 'kid@example.com');                                            // signed in here
  assert.equal((await fresh.get('/devices')).status, 200);
  assert.equal((await new Client().post(`/auth/reset/${token}`, { password: 'again-pass-7' })).status, 404); // works once
  assert.equal((await kid.post('/auth/refresh')).status, 401);                                  // other sessions are signed out
  assert.equal((await new Client().post('/auth/login', { email: 'kid@example.com', password: 'kidpass123' })).status, 401);
  assert.equal((await new Client().post('/auth/login', { email: 'kid@example.com', password: 'new-kid-pass-7' })).status, 200);
  const audit = await prisma.auditLog.findMany({ where: { action: { in: ['user.reset_link', 'user.password_reset'] } } });
  assert.deepEqual(audit.map((a) => a.action).sort(), ['user.password_reset', 'user.reset_link']);

  // change while signed in: the current password is needed; this browser stays signed in, others don't
  const other = new Client();
  await other.post('/auth/login', { email: 'kid@example.com', password: 'new-kid-pass-7' });
  assert.equal((await fresh.post('/auth/password', { current: 'wrong', password: 'next-kid-pass-8' })).status, 401);
  assert.equal((await fresh.post('/auth/password', { current: 'new-kid-pass-7', password: 'next-kid-pass-8' })).status, 200);
  assert.equal((await fresh.post('/auth/refresh')).status, 200);
  assert.equal((await other.post('/auth/refresh')).status, 401);
  assert.equal((await new Client().post('/auth/login', { email: 'kid@example.com', password: 'next-kid-pass-8' })).status, 200);

  // never for someone who works for a company or also belongs elsewhere: that would hand over their account
  const co = new Client();
  assert.equal((await co.post('/auth/signup', { orgName: 'Reset Co', name: 'Rehan', email: 'rehan@reset.example', password: 'lamp-post-42' })).status, 201);
  const staffInvite = await co.post('/platform/staff/invites', { email: 'imran@reset.example', name: 'Imran', staffRole: 'INSTALLER' });
  const imran = new Client();
  assert.equal((await imran.post(`/invites/${staffInvite.body.token}/accept`, { name: 'Imran', password: 'secret123' })).status, 201);
  const imranId = (await imran.get('/auth/me')).body.id;
  const homeInvite = await owner.post('/invites', { email: 'imran@reset.example', role: 'MEMBER' });
  assert.equal((await imran.post(`/invites/${homeInvite.body.token}/accept`, { password: 'secret123' })).status, 201);
  const refused = await owner.post(`/users/${imranId}/reset-link`);
  assert.equal(refused.status, 403);
  assert.match(refused.body.message, /Forgot password/);

  // a super admin makes one for their own installer, not for another company's
  const staffLink = await co.post(`/platform/staff/${imranId}/reset-link`);
  assert.equal(staffLink.status, 403);                                    // he also has a home with another company
  const sInvite = await co.post('/platform/staff/invites', { email: 'sana@reset.example', name: 'Sana', staffRole: 'SUPPORT' });
  const sana = new Client();
  await sana.post(`/invites/${sInvite.body.token}/accept`, { name: 'Sana', password: 'secret123' });
  const sanaId = (await sana.get('/auth/me')).body.id;
  assert.equal((await co.post(`/platform/staff/${sanaId}/reset-link`)).status, 201);
  assert.equal((await owner.post(`/platform/staff/${sanaId}/reset-link`)).status, 404);
  const coId = (await co.get('/auth/me')).body.id;
  assert.equal((await co.post(`/platform/staff/${coId}/reset-link`)).status, 400);
});
