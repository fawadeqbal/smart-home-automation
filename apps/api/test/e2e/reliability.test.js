/**
 * End-to-end, reliability: timers that retry a board that is offline and then say they failed; schedules
 * that were due while the server was down (skipped or run late, never twice, even with two API servers);
 * sign-in limits per email and network, per network and per account; a board marked faulty keeps its
 * devices; replacing a board with another (two fake boards) keeps every device id, and switching works
 * through the new board.
 *
 * Needs Postgres and Mosquitto running and python + paho-mqtt. WARNING: empties the database it points at.
 * Run:  pnpm --filter @home/api test:e2e
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../../..');
const OLD = 'esp-rel01';
const NEW = 'esp-rel02';
// ports can be moved (E2E_API_PORT) to run two copies of the tests side by side
const API_PORT = Number(process.env.E2E_API_PORT || 4555);
let app, base, prisma, createApp;
const fakes = {};
const logs = {};

class Client {
  constructor(ip) { this.cookies = new Map(); this.home = null; this.ip = ip; }
  get cookieHeader() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  async req(method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: {
        'Content-Type': 'application/json', Cookie: this.cookieHeader, ...(this.home ? { 'X-Home-Id': this.home } : {}),
        // the test talks to the API from 127.0.0.1, like Caddy does: it says who the visitor is
        ...(this.ip ? { 'X-Forwarded-For': this.ip } : {}),
      },
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
  del(u) { return this.req('DELETE', u); }
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

function startFake(id, board) {
  logs[id] = '';
  const p = spawn('python3', [path.join(ROOT, 'tools/fake-node/fake_node.py'), '--id', id, '--board', board, '--keepalive', '2',
    '--password', process.env.MQTT_NODE_PASSWORD ?? ''], { env: { ...process.env }, stdio: ['pipe', 'pipe', 'inherit'] });
  p.stdout.on('data', (d) => { logs[id] += d; });
  fakes[id] = p;
  return p;
}

/** A 2.6.0 board reconnects once with its own login right after it first connects (when the broker
 *  has per-board logins): wait for that, so the hand-over doesn't look like the board dropping out. */
async function settled(id) {
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    if ((await prisma.node.findUnique({ where: { id } }))?.mqttLoginUsedAt) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  await until(`${id} online`, async () => (await prisma.node.findUnique({ where: { id } }))?.online);
}

async function listen() {
  app = await createApp();
  await app.listen(API_PORT, '127.0.0.1');
  base = `${await app.getUrl()}/api`.replace('[::1]', '127.0.0.1');
}

/** The retained messages a board would get on connecting (what is left on the broker for it). */
async function retained(nodeId, ms = 600) {
  const mqtt = require('mqtt');
  const client = await mqtt.connectAsync(process.env.MQTT_URL ?? 'mqtt://localhost:1883', { username: 'api', password: process.env.MQTT_API_PASSWORD });
  const got = {};
  client.on('message', (topic, payload, packet) => {
    if (packet.retain) got[topic.replace(`home/v1/nodes/${nodeId}/`, '')] = payload.length ? JSON.parse(payload.toString()) : null;
  });
  await client.subscribeAsync(`home/v1/nodes/${nodeId}/#`);
  await new Promise((r) => setTimeout(r, ms));
  await client.endAsync();
  return got;
}

before(async () => {
  process.env.COMMAND_TIMEOUT_MS = '2000';
  process.env.SCHEDULER_TICK_MS = '400';
  // tries again after about 2, 3 and 5 seconds (minutes in real life: 1, 3, 10)
  process.env.SCHEDULE_RETRY_MINUTES = '0.03,0.05,0.08';
  process.env.GEOIP = 'off';
  ({ createApp } = require('../../dist/main.js'));
  const { PrismaClient } = require('@prisma/client');
  prisma = new PrismaClient();
  await prisma.$executeRawUnsafe('TRUNCATE "Organization", "Home", "User", "Node", "AuditLog", "FirmwareImage", "Invite", "LoginAttempt" CASCADE');
  await listen();
});

after(async () => {
  // the API first: a board's "offline" arriving while it shuts down would start a timer that keeps it running
  await app?.close();
  // then the boards, cleanly (no Last Will arriving after the clean-up below)
  await Promise.all(Object.values(fakes).map((p) => new Promise((resolve) => {
    if (p.exitCode !== null) return resolve();
    const t = setTimeout(() => { p.kill('SIGKILL'); resolve(); }, 3000);
    p.once('exit', () => { clearTimeout(t); resolve(); });
    p.stdin.write('quit\n');
  })));
  // leave no retained messages from the test boards on the broker
  const mqtt = require('mqtt');
  const client = await mqtt.connectAsync(process.env.MQTT_URL ?? 'mqtt://localhost:1883', { username: 'api', password: process.env.MQTT_API_PASSWORD });
  for (const id of [OLD, NEW]) {
    for (const t of ['announce', 'status', 'config', 'devices/lamp/state', 'devices/geyser/state']) {
      await client.publishAsync(`home/v1/nodes/${id}/${t}`, '', { retain: true, qos: 1 });
    }
  }
  await client.endAsync();
  await prisma?.$disconnect();
});

const owner = new Client('198.51.100.10');
const state = {};

test('setup: a home with a board, a lamp, a geyser and a wall button', async () => {
  const res = await owner.post('/auth/setup', { homeName: 'Reliable home', name: 'Fawad', email: 'owner@example.com', password: 'secret123' });
  assert.equal(res.status, 201);
  state.homeId = res.body.home.id;
  state.room = (await owner.get('/rooms')).body[0].id;

  startFake(OLD, 'NODEMCU_V2');
  await until('board in stock', async () => (await owner.get('/platform/inventory')).body.boards.find((b) => b.id === OLD));
  await settled(OLD);
  assert.equal((await owner.post(`/platform/inventory/${OLD}/assign`, { homeId: state.homeId })).status, 200);
  await until('board online', async () => (await owner.get('/nodes')).body.find((n) => n.id === OLD)?.online);
  assert.equal((await owner.post(`/nodes/${OLD}/adopt`, { name: 'Hall board', board: 'NODEMCU_V2' })).status, 204);

  const lamp = await owner.post(`/nodes/${OLD}/devices`, { name: 'Lamp', type: 'switch', pin: 5, roomId: state.room });
  const geyser = await owner.post(`/nodes/${OLD}/devices`, { name: 'Geyser', type: 'switch', pin: 4, roomId: state.room });
  assert.equal(lamp.status, 201);
  assert.equal(geyser.status, 201);
  state.lamp = lamp.body.id;
  state.geyser = geyser.body.id;
  assert.equal((await owner.post(`/nodes/${OLD}/inputs`, { type: 'wall_switch', pin: 14, targetId: state.lamp })).status, 201);
  await until('board applied its devices', async () => {
    const n = (await owner.get('/nodes')).body.find((x) => x.id === OLD);
    return n.appliedRev === n.configRev && !n.configError && n.devices.length === 2;
  });
});

const schedule = async (id) => (await owner.get('/schedules')).body.find((s) => s.id === id);
const failedNotices = async () => (await owner.get('/notifications')).body.items.filter((n) => n.kind === 'scheduleFailed');

test('a timer to an offline board is tried again, then recorded as failed and its creator told once', async () => {
  fakes[OLD].stdin.write('drop\n');
  await until('board offline', async () => !(await owner.get(`/devices/${state.lamp}`)).body.online, 12000);

  const timer = await owner.post('/schedules', { kind: 'ONCE', runAt: new Date(Date.now() + 1000).toISOString(), actions: [{ deviceId: state.lamp, on: true }] });
  assert.equal(timer.status, 201);
  const retrying = await until('first try failed', async () => {
    const s = await schedule(timer.body.id);
    return s?.lastStatus === 'retrying' ? s : null;
  });
  assert.match(retrying.lastResult, /^Not yet: Lamp is offline: its board is not connected\. Trying again at \d\d:\d\d\.$/);
  assert.ok(retrying.retryAt);
  assert.equal((await failedNotices()).length, 0, 'nobody is told while it is still trying');

  const failed = await until('all tries used', async () => {
    const s = await schedule(timer.body.id);
    return s?.lastStatus === 'failed' ? s : null;
  }, 20000);
  assert.match(failed.lastResult, /^Failed: Lamp is offline: its board is not connected\. \(tried 4 times\)$/);
  assert.equal(failed.retryAt, null);
  assert.equal(failed.enabled, false);
  await new Promise((r) => setTimeout(r, 1000));
  const notices = await failedNotices();
  assert.equal(notices.length, 1);
  assert.match(notices[0].body, /tried 4 times/);
});

test('a board that comes back in time: the next try switches it, and it worked', async () => {
  const timer = await owner.post('/schedules', { kind: 'ONCE', runAt: new Date(Date.now() + 500).toISOString(), actions: [{ deviceId: state.lamp, on: true }] });
  await until('first try failed', async () => (await schedule(timer.body.id))?.lastStatus === 'retrying');
  fakes[OLD].stdin.write('rejoin\n');
  const done = await until('a later try worked', async () => {
    const s = await schedule(timer.body.id);
    return s?.lastStatus === 'ok' ? s : null;
  }, 20000);
  assert.equal(done.lastResult, 'Done: Lamp on.');
  assert.equal((await owner.get(`/devices/${state.lamp}`)).body.state.on, true);
  assert.equal((await failedNotices()).length, 1, 'no new notice');
});

test('after downtime: overdue schedules are skipped or run late by the cut-off, once, even with two API servers', async () => {
  const daily = (await owner.post('/schedules', { kind: 'DAILY', time: '07:00', actions: [{ deviceId: state.lamp, on: true }] })).body;
  const lateOk = (await owner.post('/schedules', { kind: 'DAILY', time: '07:05', actions: [{ deviceId: state.lamp, on: false }] })).body;
  assert.equal((await owner.patch(`/schedules/${lateOk.id}`, { ifMissed: 'run' })).status, 204);
  const in30 = new Date(Date.now() + 30 * 60_000).toISOString();
  const geyserOff = (await owner.post('/schedules', { kind: 'ONCE', runAt: in30, actions: [{ deviceId: state.geyser, on: false }] })).body;
  const lightsOn = (await owner.post('/schedules', { kind: 'ONCE', runAt: in30, actions: [{ deviceId: state.lamp, on: true }] })).body;
  assert.equal(geyserOff.ifMissed, 'auto');

  // the server stops; while it is down, the schedules' times pass (two hours ago)
  await app.close();
  const due = new Date(Date.now() - 2 * 3600_000);
  await prisma.schedule.updateMany({ where: { id: { in: [daily.id, lateOk.id, geyserOff.id, lightsOn.id] } }, data: { nextRunAt: due } });
  await prisma.schedule.updateMany({ where: { id: { in: [geyserOff.id, lightsOn.id] } }, data: { runAt: due } });
  const restartedAt = new Date();
  // back up: this server and a second one, both with a scheduler
  await listen();
  const second = await createApp();
  await second.listen(0, '127.0.0.1');
  try {
    const ran = await until('the overdue ones were handled', async () => {
      const list = (await owner.get('/schedules')).body;
      const all = [daily, lateOk, geyserOff, lightsOn].map((x) => list.find((s) => s.id === x.id));
      return all.every((s) => s?.lastRunAt && s.lastStatus !== 'retrying') ? all : null;
    }, 20000);
    const [d, l, g, o] = ran;
    // a missed "lights on at 7:00" is not done at 9:00; it waits for tomorrow
    assert.equal(d.lastStatus, 'skipped');
    // "at 07:00", or "at Sun 18 Oct, 07:00" when the missed time was on another day (the test may run across midnight)
    assert.match(d.lastResult, /^Skipped: the server was down at (\w{3} \d{1,2} \w{3}, )?\d\d:\d\d\.$/);
    assert.equal(d.enabled, true);
    assert.ok(new Date(d.nextRunAt).getTime() > Date.now());
    // the one set to "run it late" runs, and says how late
    assert.equal(l.lastStatus, 'ok');
    assert.match(l.lastResult, /^Ran 2 h late \(the server was down at (\w{3} \d{1,2} \w{3}, )?\d\d:\d\d\)\. Done: Lamp off\.$/);
    // a missed "geyser off" still runs; a missed "lights on" timer doesn't
    assert.equal(g.lastStatus, 'ok');
    assert.match(g.lastResult, /late .*Done: Geyser off\.$/);
    assert.equal(g.enabled, false);
    assert.equal(o.lastStatus, 'skipped');
    assert.equal(o.enabled, false);

    // never twice: one command for each, though two schedulers were running
    await new Promise((r) => setTimeout(r, 1500));
    const cmds = await prisma.command.findMany({ where: { channel: 'automation', createdAt: { gte: restartedAt } }, select: { deviceId: true } });
    assert.deepEqual(cmds.map((c) => c.deviceId).sort(), [state.geyser, state.lamp].sort());
  } finally {
    await second.close();
  }
});

test('sign-in limits: per email and network, per network, and per account', async () => {
  const from = (ip) => new Client(ip);
  const wrong = (ip, email = 'owner@example.com') => from(ip).post('/auth/login', { email, password: 'not-it-123' });

  // 5 wrong passwords from one network: that email waits there, and is told how long
  for (let i = 1; i <= 4; i++) assert.equal((await wrong('203.0.113.1')).status, 401);
  const fifth = await wrong('203.0.113.1');
  assert.equal(fifth.status, 429);
  assert.match(fifth.body.message, /try again in 15 minutes/);
  const right = await from('203.0.113.1').post('/auth/login', { email: 'owner@example.com', password: 'secret123' });
  assert.equal(right.status, 429, 'even the right password waits');
  // the same email from another network is not blocked: someone else can't lock the owner out
  const home = from('203.0.113.2');
  assert.equal((await home.post('/auth/login', { email: 'owner@example.com', password: 'secret123' })).status, 200);
  // a right password forgets that network's wrong tries
  assert.equal((await wrong('203.0.113.2')).status, 401);
  assert.equal((await from('203.0.113.2').post('/auth/login', { email: 'owner@example.com', password: 'secret123' })).status, 200);
  assert.equal(await prisma.loginAttempt.count({ where: { ip: '203.0.113.2' } }), 0);
  // after the wait the count starts fresh: one wrong try doesn't lock again
  await prisma.$executeRawUnsafe(`UPDATE "LoginAttempt" SET at = at - interval '16 minutes' WHERE ip = '203.0.113.1'`);
  const again = await wrong('203.0.113.1');
  assert.equal(again.status, 401);
  assert.equal(again.body.message, 'Wrong email or password.');

  // one network trying many emails waits, whatever email it types next
  for (let i = 0; i < 30; i++) {
    const r = await wrong('203.0.113.50', `nobody${i}@example.com`);
    assert.equal(r.status, i < 29 ? 401 : 429, `try ${i + 1}`);
  }
  const net = await from('203.0.113.50').post('/auth/login', { email: 'someone-else@example.com', password: 'whatever-1' });
  assert.equal(net.status, 429);
  assert.match(net.body.message, /from this network\. Try again in 15 minutes/);

  // many networks against one account: it waits too (not from a network it is signed in on), and its owner is told
  await prisma.loginAttempt.deleteMany({});
  for (let n = 0; n < 10; n++) for (let i = 0; i < 5; i++) await wrong(`192.0.2.${n + 1}`);
  const stranger = await from('192.0.2.200').post('/auth/login', { email: 'owner@example.com', password: 'secret123' });
  assert.equal(stranger.status, 429);
  assert.match(stranger.body.message, /this account\. For its safety, try again in 15 minutes/);
  assert.equal((await from('203.0.113.2').post('/auth/login', { email: 'owner@example.com', password: 'secret123' })).status, 200);
  const security = await until('security notice', async () => (await owner.get('/notifications')).body.items.find((n) => n.kind === 'security'));
  assert.match(security.title, /trying to sign in/);

  // guessing password-reset links: a network that tries many is stopped
  for (let i = 0; i < 19; i++) assert.equal((await from('203.0.113.77').get(`/auth/reset/made-up-link-${i}`)).status, 404);
  const guessed = await from('203.0.113.77').get('/auth/reset/made-up-link-x');
  assert.equal(guessed.status, 429);
  assert.match(guessed.body.message, /Too many links tried from this network\. Try again in 15 minutes\./);
  assert.equal((await from('203.0.113.78').get('/auth/reset/made-up-link-y')).status, 404);    // another network is not affected
  await prisma.loginAttempt.deleteMany({});
});

test('a board marked faulty keeps its devices, scenes and timers: they wait for a replacement board', async () => {
  const scene = await owner.post('/scenes', { name: 'Good night', actions: [{ deviceId: state.lamp, on: false }, { deviceId: state.geyser, on: false }] });
  assert.equal(scene.status, 201);
  state.scene = scene.body.id;
  const daily = await owner.post('/schedules', { kind: 'DAILY', time: '19:00', actions: [{ deviceId: state.lamp, on: true }] });
  state.daily = daily.body.id;
  const rule = await owner.post('/rules', { trigger: { deviceId: state.lamp, event: 'on' }, actions: [{ type: 'device', deviceId: state.geyser, on: false }] });
  assert.equal(rule.status, 201);
  state.rule = rule.body.id;
  // some history to keep
  assert.equal((await owner.post(`/devices/${state.lamp}/commands`, { on: true })).status, 200);
  state.historyBefore = (await owner.get(`/devices/${state.lamp}/history`)).body.length;

  const marked = await owner.post(`/platform/inventory/${OLD}/faulty`, { note: 'Relay stuck' });
  assert.equal(marked.status, 200);
  assert.equal(marked.body.kept, true);

  const devices = (await owner.get('/devices')).body;
  const lamp = devices.find((d) => d.id === state.lamp);
  assert.ok(lamp, 'the lamp is still in the home');
  assert.equal(lamp.waiting, true);
  assert.equal(lamp.online, false);
  assert.equal(lamp.name, 'Lamp');
  const cmd = await owner.post(`/devices/${state.lamp}/commands`, { on: false });
  assert.equal(cmd.status, 409);
  assert.equal(cmd.body.message, 'Lamp: waiting for a replacement board.');

  const sc = (await owner.get('/scenes')).body.find((s) => s.id === state.scene);
  assert.deepEqual(sc.actions.map((a) => a.deviceName), ['Lamp', 'Geyser']);
  assert.equal(sc.actions[0].problem, 'Lamp: waiting for a replacement board');
  const sched = await schedule(state.daily);
  assert.deepEqual(sched.problems, ['Lamp: waiting for a replacement board']);
  assert.equal(sched.actions[0].deviceName, 'Lamp');
  const r = (await owner.get('/rules')).body.find((x) => x.id === state.rule);
  assert.deepEqual(r.problems, ['Lamp: waiting for a replacement board', 'Geyser: waiting for a replacement board']);
  assert.equal(r.trigger.deviceName, 'Lamp');

  const node = (await owner.get('/nodes')).body.find((n) => n.id === OLD);
  assert.equal(node.status, 'FAULTY');
  assert.equal(node.waiting, true);
  assert.equal(node.devices.length, 2);
  assert.equal(node.inputs.length, 1);
  const inv = (await owner.get('/platform/inventory')).body.boards.find((b) => b.id === OLD);
  assert.equal(inv.waiting, true);
  assert.equal(inv.condText, 'Faulty · waiting for a replacement');
  // the board stops running them
  await until('the faulty board got an empty configuration', async () => /applied \(waiting to be adopted\): no devices/.test(logs[OLD]));
  // it can't go back on the shelf while it holds the home's devices
  assert.equal((await owner.post(`/platform/inventory/${OLD}/restock`)).status, 400);
});

test('replacing the board keeps every device id; the new board gets the configuration and switches', async () => {
  startFake(NEW, 'WEMOS_D1_MINI');
  await until('new board in stock and online', async () => (await owner.get('/platform/inventory')).body.boards.find((b) => b.id === NEW && b.online));
  await settled(NEW);
  const epochBefore = (await prisma.home.findUnique({ where: { id: state.homeId } })).localEpoch;

  const options = await owner.get(`/nodes/${OLD}/replacements`);
  assert.equal(options.status, 200);
  const cand = options.body.candidates.find((c) => c.id === NEW);
  assert.ok(cand, 'the board in stock is offered');
  assert.deepEqual(cand.problems, []);
  assert.deepEqual(cand.plan.map((p) => [p.name, p.from, p.to]), [
    ['Geyser', 'D2 (GPIO 4)', 'D2 (GPIO 4)'], ['Lamp', 'D1 (GPIO 5)', 'D1 (GPIO 5)'], ['Wall switch', 'D5 (GPIO 14)', 'D5 (GPIO 14)'],
  ]);

  const swap = await owner.post(`/nodes/${OLD}/replace`, { newId: NEW });
  assert.equal(swap.status, 200, JSON.stringify(swap.body));
  assert.deepEqual([swap.body.devices, swap.body.inputs, swap.body.oldStatus], [2, 1, 'FAULTY']);

  // same ids, now on the new board, which took the old one's name and place
  const devices = (await owner.get('/devices')).body;
  assert.deepEqual(devices.map((d) => d.id).sort(), [state.geyser, state.lamp].sort());
  assert.ok(devices.every((d) => d.nodeId === NEW && !d.waiting));
  const nodes = (await owner.get('/nodes')).body;
  const fresh = nodes.find((n) => n.id === NEW);
  assert.equal(fresh.status, 'ADOPTED');
  assert.equal(fresh.name, 'Hall board');
  assert.equal(fresh.board, 'WEMOS_D1_MINI');
  assert.equal(fresh.inputs[0].targetId, state.lamp);
  assert.ok(!nodes.some((n) => n.id === OLD), 'the old board left the home');

  // the new board runs the devices
  await until('new board applied the configuration', async () => {
    const n = (await owner.get('/nodes')).body.find((x) => x.id === NEW);
    return n.appliedRev === n.configRev && !n.configError && /applied \(adopted\): lamp=switch@D1, geyser=switch@D2/.test(logs[NEW]);
  });
  const on = await owner.post(`/devices/${state.lamp}/commands`, { on: true });
  assert.equal(on.status, 200, JSON.stringify(on.body));
  assert.deepEqual(on.body.state, { on: true });
  assert.equal(on.body.nodeId, NEW);
  const ran = await owner.post(`/scenes/${state.scene}/run`);
  assert.equal(ran.body.ok, true, JSON.stringify(ran.body));
  assert.deepEqual((await schedule(state.daily)).problems, []);
  assert.ok((await owner.get(`/devices/${state.lamp}/history`)).body.length > state.historyBefore, 'history goes on');

  // a new local-control key, and the home's epoch raised (older phone passes stop working)
  const row = await prisma.node.findUnique({ where: { id: NEW } });
  assert.match(row.localKey, /^[0-9a-f]{64}$/);
  assert.equal(row.localKeyHome, state.homeId);
  assert.equal((await prisma.home.findUnique({ where: { id: state.homeId } })).localEpoch, epochBefore + 1);

  // the old board: faulty shelf with a note, nothing of the home left on the broker for it
  const old = await prisma.node.findUnique({ where: { id: OLD } });
  assert.equal(old.status, 'FAULTY');
  assert.equal(old.homeId, null);
  assert.match(old.note, /^Replaced by esp-rel02 on \d{1,2} \w{3} \d{4}\. Relay stuck$/);
  const left = await retained(OLD);
  assert.equal(left.config.adopted, false);
  assert.deepEqual(left.config.devices, []);
  assert.equal(left['devices/lamp/state'], undefined);
  const inv = (await owner.get('/platform/inventory')).body.boards;
  assert.equal(inv.find((b) => b.id === OLD).replacedBy.id, NEW);
  assert.equal(inv.find((b) => b.id === NEW).replaced.id, OLD);
  const audit = await prisma.auditLog.findFirst({ where: { action: 'board.replace' } });
  assert.deepEqual([audit.details.from, audit.details.to, audit.details.devices], [OLD, NEW, 2]);
});

test('a board that died without being marked faulty can be replaced too (and the old one go back to stock)', async () => {
  // the first board was repaired: back to stock, then it takes over from the second one, which went offline
  assert.equal((await owner.post(`/platform/inventory/${OLD}/restock`)).status, 200);
  fakes[NEW].stdin.write('drop\n');
  await until('second board offline', async () => !(await owner.get('/nodes')).body.find((n) => n.id === NEW).online, 12000);
  assert.equal((await owner.get('/nodes')).body.find((n) => n.id === NEW).status, 'ADOPTED');

  const swap = await owner.post(`/nodes/${NEW}/replace`, { newId: OLD, oldTo: 'stock' });
  assert.equal(swap.status, 200, JSON.stringify(swap.body));
  assert.equal(swap.body.oldStatus, 'STOCK');
  const devices = (await owner.get('/devices')).body;
  assert.ok(devices.every((d) => d.nodeId === OLD) && devices.length === 2);
  await until('first board runs them again', async () => {
    const n = (await owner.get('/nodes')).body.find((x) => x.id === OLD);
    return n.online && n.appliedRev === n.configRev && n.devices.length === 2;
  });
  assert.equal((await owner.post(`/devices/${state.geyser}/commands`, { on: true })).status, 200);
  const second = await prisma.node.findUnique({ where: { id: NEW } });
  assert.equal(second.status, 'STOCK');
  assert.match(second.note, /^Replaced by esp-rel01 on .*It worked, back in stock$/);
  // a board in use somewhere can't take over
  assert.equal((await owner.post(`/nodes/${OLD}/replace`, { newId: OLD })).status, 404);
});
