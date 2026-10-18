/**
 * End-to-end: power at home. The real API (built: `pnpm build`), database and broker, and a fake board
 * with a mains-sense sensor (a contact sensor of kind "mains": active while the grid is on):
 *   the grid goes -> heavy loads off, a notice, heavy loads ask before going on -> the grid is back ->
 *   loads back on, one power cut recorded (not also by the boards) -> meter readings, the bill and the
 *   protected-slab warning (once) -> load-shedding: the learned pattern, and a typed schedule that wins.
 *
 * Needs Postgres and Mosquitto running and python + paho-mqtt. WARNING: empties the database it points at.
 * Run:  pnpm --filter @home/api test:e2e
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../../..');
const NODE_ID = 'esp-power01';
// ports can be moved (E2E_API_PORT, E2E_LOCAL_PORT) to run two copies of the tests side by side
const API_PORT = Number(process.env.E2E_API_PORT || 4555);
const LOCAL_PORT = Number(process.env.E2E_LOCAL_PORT || 4588);
const MIN = 60_000;
const DAY = 86_400_000;
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
  process.env.RULES_TICK_MS = '1000';
  process.env.POWER_TICK_MS = '3600000';   // the test runs the power clock itself
  process.env.ALLOW_SIGNUP = 'true';
  process.env.PUBLIC_API_URL = `http://127.0.0.1:${API_PORT}`;
  process.env.HELP_DIR = path.join(__dirname, 'help-fixture');
  process.env.BROKER_LOG = '';
  process.env.GEOIP = 'off';
  const { createApp } = require('../../dist/main.js');
  const { PrismaClient } = require('@prisma/client');
  prisma = new PrismaClient();
  await prisma.$executeRawUnsafe('TRUNCATE "Organization", "Home", "User", "Node", "AuditLog", "FirmwareImage", "Invite" CASCADE');
  app = await createApp();
  await app.listen(API_PORT, '127.0.0.1');
  base = `${await app.getUrl()}/api`.replace('[::1]', '127.0.0.1');
});

after(async () => {
  fake?.kill('SIGKILL');
  // close the API first: it would start its "still offline?" timers for the board going away
  await app?.close();
  const mqtt = require('mqtt');
  const client = await mqtt.connectAsync(process.env.MQTT_URL ?? 'mqtt://localhost:1883', { username: 'api', password: process.env.MQTT_API_PASSWORD });
  for (const t of ['announce', 'status', 'config', 'devices/ac/state', 'devices/iron/state', 'devices/fan/state', 'devices/grid/state']) {
    await client.publishAsync(`home/v1/nodes/${NODE_ID}/${t}`, '', { retain: true, qos: 1 });
  }
  await client.endAsync();
  await prisma?.$disconnect();
});

const owner = new Client();
const kid = new Client();
const s = {};
const dev = (id) => owner.get(`/devices/${id}`).then((r) => r.body);
const notices = (c = owner) => c.get('/notifications').then((r) => r.body.items);

test('a home with a board: AC, iron, fan and a mains-sense sensor', async () => {
  const res = await owner.post('/auth/setup', { homeName: 'Power home', name: 'Fawad', email: 'owner@example.com', password: 'secret123' });
  assert.equal(res.status, 201);
  s.homeId = res.body.home.id;
  owner.home = s.homeId;
  const rooms = (await owner.get('/rooms')).body;
  s.room = rooms[0].id;
  fake = spawn('python3', [path.join(ROOT, 'tools/fake-node/fake_node.py'), '--id', NODE_ID, '--keepalive', '2',
    '--local-port', String(LOCAL_PORT), '--password', process.env.MQTT_NODE_PASSWORD ?? ''], { env: { ...process.env }, stdio: ['pipe', 'pipe', 'inherit'] });
  fake.stdout.on('data', () => undefined);
  await until('board in stock', async () => (await owner.get('/platform/inventory')).body.boards?.find((b) => b.id === NODE_ID), 10000);
  assert.equal((await owner.post(`/platform/inventory/${NODE_ID}/assign`, { homeId: s.homeId })).status, 200);
  await until('board online', async () => (await owner.get('/nodes')).body.find((n) => n.id === NODE_ID)?.online, 10000);
  assert.equal((await owner.post(`/nodes/${NODE_ID}/adopt`, { name: 'Main board', board: 'NODEMCU_V2' })).status, 204);

  const add = async (body) => {
    const r = await owner.post(`/nodes/${NODE_ID}/devices`, { roomId: s.room, ...body });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.id;
  };
  s.ac = await add({ name: 'AC', type: 'switch', pin: 5 });
  s.iron = await add({ name: 'Iron', type: 'switch', pin: 4 });
  s.fan = await add({ name: 'Fan', type: 'switch', pin: 14 });
  s.grid = await add({ name: 'Grid', type: 'contact', pin: 12, activeLow: true, settings: { kind: 'mains' } });
  await until('board applied the config', async () => {
    const n = (await owner.get('/nodes')).body.find((x) => x.id === NODE_ID);
    return n.status === 'ADOPTED' && n.appliedRev === n.configRev && !n.configError;
  }, 10000);
  // the fake board's sensor starts inactive; the grid is on: trip it once
  await until('sensor reported', async () => (await dev(s.grid)).state?.active === false, 10000);
  fake.stdin.write('trip grid\n');
  await until('grid on', async () => (await dev(s.grid)).state?.active === true);
  assert.equal((await owner.get('/power')).body.grid.off, false);

  // a member, to check who sees what
  const inv = await owner.post('/invites', { email: 'kid@example.com', role: 'MEMBER' });
  assert.equal(inv.status, 201, JSON.stringify(inv.body));
  const accepted = await kid.post(`/invites/${inv.body.token}/accept`, { name: 'Kid', password: 'kidpass123' });
  assert.equal(accepted.status, 201);
  await owner.put(`/users/${accepted.body.id}/rooms`, { rooms: [{ roomId: s.room, access: 'CONTROL' }] });
  kid.home = s.homeId;
});

test('rules: a mains sensor starts a rule when the grid goes, not when it "opens"', async () => {
  const wrong = await owner.post('/rules', { trigger: { deviceId: s.grid, event: 'opens' }, actions: [{ type: 'notify', to: 'me' }] });
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.message, /the grid goes, the grid comes back/);
  const rule = await owner.post('/rules', { trigger: { deviceId: s.grid, event: 'gridOff' }, actions: [{ type: 'device', deviceId: s.fan, on: false }] });
  assert.equal(rule.status, 201, JSON.stringify(rule.body));
  assert.equal(rule.body.name, 'When the grid goes: Fan off');
  s.rule = rule.body.id;
});

test('the grid goes: heavy loads off, a notice, and heavy loads ask before going on', async () => {
  const g = (await owner.get('/power/grid')).body;
  assert.equal(g.sensor.name, 'Grid');
  assert.deepEqual(g.switches.filter((x) => x.heavy).map((x) => x.name).sort(), ['AC', 'Iron']);   // suggested from their names
  assert.equal((await kid.put('/power/grid', { loads: [s.ac] })).status, 403);
  const set = await owner.put('/power/grid', { loads: [s.ac, s.iron, s.grid], restore: true });
  assert.equal(set.status, 200);
  assert.deepEqual(set.body.loads.sort(), [s.ac, s.iron].sort());   // only switches
  assert.equal(set.body.restore, true);

  for (const id of [s.ac, s.fan]) assert.equal((await owner.post(`/devices/${id}/commands`, { on: true })).status, 200);
  fake.stdin.write('trip grid\n');
  await until('AC switched off by itself', async () => (await dev(s.ac)).state?.on === false, 10000);
  const p = (await owner.get('/power')).body;
  assert.equal(p.grid.off, true);
  assert.deepEqual(p.grid.switchedOff, ['AC']);
  const n = await until('UPS notice', async () => (await notices()).find((x) => x.kind === 'ups'));
  assert.match(n.title, /^On UPS or solar since \d{1,2}:\d{2} [ap]m$/);
  assert.match(n.body, /Switched off to save the battery: AC\. They go back on when the power returns\./);
  // the rule ran too
  await until('rule ran', async () => (await dev(s.fan)).state?.on === false, 10000);
  // a member sees "on UPS" too, but isn't sent the owners' notice
  assert.equal((await kid.get('/power')).body.grid.off, true);
  assert.ok(!(await notices(kid)).some((x) => x.kind === 'ups'));

  // switching a heavy load on asks first; "yes, anyway" goes through
  const warn = await owner.post(`/devices/${s.iron}/commands`, { on: true });
  assert.equal(warn.status, 409);
  assert.equal(warn.body.code, 'ups');
  assert.match(warn.body.message, /The home is on UPS since .*Iron draws a lot.*Switch it on anyway\?/);
  assert.equal((await owner.post(`/devices/${s.fan}/commands`, { on: true })).status, 200);   // not a heavy load
  assert.equal((await owner.post(`/devices/${s.iron}/commands?confirm=ups`, { on: true })).status, 200);
  assert.equal((await owner.post(`/devices/${s.iron}/commands`, { on: false })).status, 200);   // off is always fine
});

test('the grid is back: loads back on, one power cut recorded and not counted twice', async () => {
  // it has been off for 58 minutes; one of the boards reported a restart in that time too
  const since = new Date(Date.now() - 58 * MIN);
  await prisma.home.update({ where: { id: s.homeId }, data: { gridOffSince: since } });
  await prisma.outage.create({ data: { nodeId: NODE_ID, homeId: s.homeId, kind: 'POWER', startedAt: new Date(since.getTime() + 10_000), endedAt: new Date(Date.now() - 50 * MIN), seconds: 480, reset: 'Power On' } });
  fake.stdin.write('trip grid\n');
  await until('AC back on', async () => (await dev(s.ac)).state?.on === true, 10000);
  assert.equal((await dev(s.iron)).state.on, false);   // it wasn't on when the grid went
  const n = await until('power back notice', async () => (await notices()).find((x) => x.title.startsWith('Power back')));
  assert.equal(n.title, 'Power back after 58 min');
  assert.match(n.body, /Switched back on: AC\./);
  const kidNotice = await until('member told of the cut', async () => (await notices(kid)).find((x) => x.kind === 'powerCut'));
  assert.match(kidNotice.body, /\(58 min\)/);
  assert.equal((await owner.get('/power')).body.grid.off, false);

  const out = (await owner.get('/outages')).body;
  assert.equal(out.summary.powerCuts, 1);
  const cuts = out.outages.filter((o) => o.kind === 'POWER');
  assert.equal(cuts.length, 1);
  assert.equal(cuts[0].source, 'mains');
  assert.equal(cuts[0].label, 'Power cut (grid sensor)');
  assert.ok(Math.abs(cuts[0].seconds - 58 * 60) < 10);

  // a board that restarted with "Power On" in that same time adds nothing: the sensor already has it
  const { OutagesService } = require('../../dist/monitoring/outages.service.js');
  const outages = app.get(OutagesService);
  assert.equal(await outages.record(NODE_ID, 'POWER', new Date(since.getTime() + 60_000), new Date(Date.now() - 40 * MIN), 'Power On'), null);
  assert.equal((await owner.get('/outages')).body.summary.powerCuts, 1);
  // one the sensor never saw (the sensor's own board lost power, the grid stayed on): a real cut
  const own = await outages.record(NODE_ID, 'POWER', new Date(Date.now() - 4 * DAY), new Date(Date.now() - 4 * DAY + 10 * MIN), 'Power On');
  assert.equal(own.kind, 'POWER');
  await prisma.outage.delete({ where: { id: own.id } });
  // the rule fired once (the grid going), not on its return
  assert.match((await owner.get('/rules')).body.find((r) => r.id === s.rule).lastResult, /Done: Fan off/);
});

test('meter readings: the bill this month, the projection and the slab warning (once)', async () => {
  // a billing day about 10 days ago, so the month has a pace to project
  const local = (d) => new Date(d.getTime() + 5 * 3600_000);
  const billingDay = Math.min(28, local(new Date(Date.now() - 10 * DAY)).getUTCDate());
  assert.equal((await kid.get('/power/bill')).status, 403);
  assert.equal((await kid.post('/power/readings', { kwh: 1 })).status, 403);
  const set = await owner.put('/power/bill', { billingDay, protectedLimit: 200 });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.source === 'none' || set.body.source === 'estimate', true);
  const start = new Date(set.body.cycle.start);

  const first = await owner.post('/power/readings', { kwh: 5000, readAt: new Date(start.getTime() + 2 * 3600_000).toISOString() });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const second = await owner.post('/power/readings', { kwh: 5150, readAt: new Date(Date.now() - MIN).toISOString() });
  assert.equal(second.status, 201);
  const b = second.body;
  assert.equal(b.source, 'readings');
  assert.equal(b.units, 150);
  assert.ok(b.projected > 200, String(b.projected));
  assert.equal(b.heading, true);
  assert.match(b.message, new RegExp(`^You've used 150 units since the ${b.billingDayText}\\. At this pace you'll reach \\d+ by the ${b.billingDayText} — staying at 200 or below keeps the protected rate\\.$`));
  assert.equal(b.cost.soFar, 150 * 60);   // the flat default rate

  const warn = await until('slab warning', async () => (await notices()).find((x) => x.kind === 'bill'));
  assert.equal(warn.title, 'Electricity: heading past 200 units');
  assert.match(warn.body, /staying at 200 or below keeps the protected rate/);
  // another reading the same month: no second warning
  assert.equal((await owner.post('/power/readings', { kwh: 5160, readAt: new Date().toISOString() })).status, 201);
  const { PowerService } = require('../../dist/power/power.service.js');
  await app.get(PowerService).checkBill(s.homeId);
  assert.equal((await notices()).filter((x) => x.kind === 'bill').length, 1);

  // a lower number is a typing mistake ... unless the meter was replaced
  const lower = await owner.post('/power/readings', { kwh: 4990, readAt: new Date().toISOString() });
  assert.equal(lower.status, 400);
  assert.match(lower.body.message, /less than the earlier reading .*new meter/);
  const replaced = await owner.post('/power/readings', { kwh: 3, readAt: new Date().toISOString(), newMeter: true });
  assert.equal(replaced.status, 201);
  const list = (await owner.get('/power/readings')).body;
  assert.equal(list.length, 4);
  assert.equal(list[0].newMeter, true);
  assert.equal(list[0].by, 'Fawad');
  assert.equal((await owner.del(`/power/readings/${list[0].id}`)).status, 200);
  // a typo fixed
  const fixed = await owner.patch(`/power/readings/${second.body.latest ? list[2].id : list[2].id}`, { kwh: 5140 });
  assert.equal(fixed.status, 200, JSON.stringify(fixed.body));
  assert.equal(fixed.body.units, 160);   // 5000 -> 5160 (the latest one)

  // slabs: 100 at 10, then 15
  const slabs = await owner.put('/power/bill', { slabs: [{ upTo: 100, rate: 10 }, { upTo: null, rate: 15 }] });
  assert.equal(slabs.status, 200);
  assert.equal(slabs.body.cost.soFar, 1000 + 60 * 15);
  assert.equal((await owner.put('/power/bill', { slabs: [{ upTo: 100, rate: 10 }, { upTo: 50, rate: 15 }] })).status, 400);
  // turning the protected limit off: no warnings at all
  assert.equal((await owner.put('/power/bill', { protectedLimit: null })).body.protectedLimit, null);
});

test('load-shedding: the pattern from power cuts, and a typed schedule beats it', async () => {
  // 2–3 pm (Karachi) on 6 of the last 13 days
  const at = (daysAgo, h, m = 0) => {
    const d = new Date(Date.now() + 5 * 3600_000 - daysAgo * DAY);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h - 5, m));
  };
  for (const d of [2, 3, 5, 7, 9, 12]) {
    await prisma.outage.create({ data: { nodeId: NODE_ID, homeId: s.homeId, kind: 'POWER', startedAt: at(d, 14, 2), endedAt: at(d, 15, 1), seconds: 3540, source: 'mains' } });
  }
  const learned = (await kid.get('/power/shedding')).body;   // anyone in the home may ask
  assert.equal(learned.source, 'learned');
  assert.deepEqual(learned.windows.map((w) => [w.from, w.to, w.seen]), [['14:00', '15:00', 6]]);
  assert.match(learned.next.text, /around 2:00 pm|now, until about 3:00 pm/);
  assert.equal(learned.learned.slots.length, 48);

  assert.equal((await kid.put('/power/shedding', { windows: [] })).status, 403);
  const bad = await owner.put('/power/shedding', { windows: [{ from: '20:00', to: '20:00' }] });
  assert.equal(bad.status, 400);
  const typed = await owner.put('/power/shedding', { windows: [{ from: '20:00', to: '21:00' }, { from: '8:00', to: '9:00', days: [1] }] });
  assert.equal(typed.status, 200, JSON.stringify(typed.body));
  assert.equal(typed.body.source, 'typed');
  assert.deepEqual(typed.body.windows.map((w) => w.from), ['08:00', '20:00']);
  assert.match(typed.body.next.text, /around (8:00 pm|8:00 am)|now, until about/);
  assert.equal(typed.body.learned.windows[0].from, '14:00');   // still worked out, just not used
  assert.equal((await owner.get('/power')).body.source, 'typed');

  // the "electricity may go" notice, for those who asked for it, once per cut
  const soon = new Date(Date.now() + 5 * 3600_000 + 10 * MIN);
  const hh = (d) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  await owner.put('/power/shedding', { windows: [{ from: hh(soon), to: hh(new Date(soon.getTime() + 60 * MIN)) }] });
  await kid.put('/notifications/prefs', { cutSoon: true });
  const { PowerService } = require('../../dist/power/power.service.js');
  await app.get(PowerService).tick();
  await app.get(PowerService).tick();
  const told = (await notices(kid)).filter((x) => x.kind === 'cutSoon');
  assert.equal(told.length, 1);
  assert.match(told[0].title, /^Electricity may go at \d{1,2}:\d{2} [ap]m$/);
  assert.match(told[0].body, /area’s load-shedding schedule.*Run the motor or iron now/);
  assert.ok(!(await notices()).some((x) => x.kind === 'cutSoon'));   // off by default

  // back to the learned pattern
  assert.equal((await owner.put('/power/shedding', { windows: [] })).body.source, 'learned');
});
