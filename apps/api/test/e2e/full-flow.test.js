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
const path = require('node:path');
const { io } = require('socket.io-client');

const ROOT = path.resolve(__dirname, '../../../..');
const NODE_ID = 'esp-e2e01';
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
  process.env.ALLOW_SIGNUP = 'true'; // the SaaS test signs up a second organization
  process.env.PUBLIC_API_URL = 'http://127.0.0.1:4555'; // where the fake board downloads firmware
  const { createApp } = require('../../dist/main.js');
  const { PrismaClient } = require('@prisma/client');
  prisma = new PrismaClient();
  await prisma.$executeRawUnsafe('TRUNCATE "Organization", "Home", "User", "Node", "AuditLog", "FirmwareImage", "Invite" CASCADE');
  app = await createApp();
  await app.listen(4555, '127.0.0.1');
  base = `${await app.getUrl()}/api`.replace('[::1]', '127.0.0.1');
});

after(async () => {
  fake?.kill('SIGKILL');
  // Leave no retained messages from the test board on the broker.
  const mqtt = require('mqtt');
  const client = await mqtt.connectAsync(process.env.MQTT_URL ?? 'mqtt://localhost:1883',
    { username: 'api', password: process.env.MQTT_API_PASSWORD });
  for (const t of ['announce', 'status', 'config', 'devices/bulb/state', 'devices/room_climate/state']) {
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
  assert.deepEqual((await owner.get('/auth/status')).body, { setupNeeded: true, signupOpen: true });
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
    '--password', process.env.MQTT_NODE_PASSWORD ?? ''], { env, stdio: ['pipe', 'pipe', 'inherit'] });
  fake.stdout.on('data', (d) => { state.fakeLog = (state.fakeLog ?? '') + d; });

  // one organization on this server: the board goes straight into its stock
  const stocked = await until('board in stock', async () => (await owner.get('/platform/inventory')).body.boards.find((b) => b.id === NODE_ID));
  assert.equal(stocked.status, 'STOCK');
  assert.equal((await owner.get('/nodes')).body.length, 0);
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

test('a board that disappears goes offline and commands say so', async () => {
  fake.kill('SIGKILL');
  await until('offline via Last Will', async () => (await owner.get('/devices')).body.every((d) => !d.online), 12000);
  const res = await owner.post(`/devices/${state.bulb}/commands`, { on: false });
  assert.equal(res.status, 503);
  assert.match(res.body.message, /offline/);
  const n = await until('offline notice', async () => (await owner.get('/notifications')).body.items.find((x) => x.kind === 'boardOffline'));
  assert.match(n.title, /disconnected/);
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
  const jobs = (await installer.get('/platform/homes')).body;
  assert.ok(jobs.some((h) => h.id === shah && h.installerId === raviId), 'the job reaches the installer');
  installer.home = shah;
  assert.equal((await installer.get('/auth/me')).body.home.canSetup, true);
  installer.home = null;
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
