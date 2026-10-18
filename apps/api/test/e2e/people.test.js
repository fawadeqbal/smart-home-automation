/**
 * End-to-end: people features with the fake board — time-limited access (hours and an end) for a guest,
 * enforced for devices, the assistant and phone passes; phone push tokens (Firebase, with a fake Google);
 * "share when I'm home" and the last one out switching things off on the board.
 *
 * Needs Postgres and Mosquitto (pnpm infra:up) and python + paho-mqtt. Empties the database it points at.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createHmac, generateKeyPairSync } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../../..');
const NODE_ID = 'esp-e2eppl';
const API_PORT = Number(process.env.E2E_API_PORT || 4555);
const LOCAL_PORT = Number(process.env.E2E_LOCAL_PORT || 4588);
const BROKER_LOG = path.join(os.tmpdir(), `home-e2e-people-broker-${process.pid}.log`);
const TZ = 'Asia/Karachi';
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

async function until(what, fn, timeoutMs = 10000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

/** "HH:MM" in the home's time zone, `minutes` from now. */
function homeClock(minutes) {
  const at = new Date(Date.now() + minutes * 60_000);
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
}

/** A signed request straight to the fake board, like the phone app over the Wi‑Fi. */
async function localCall(board, urlPath, body = '') {
  const hello = await (await fetch(`http://${board.ip}/local/hello`)).json();
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const sig = createHmac('sha256', board.passKey).update(`${hello.nonce}\n${urlPath}\n${text}`).digest('hex');
  const res = await fetch(`http://${board.ip}${urlPath}`, { method: 'POST', body: text, headers: { 'X-Pass': board.pass, 'X-Nonce': hello.nonce, 'X-Sig': sig } });
  return { status: res.status, body: await res.json() };
}

/** What a fake Google got (Firebase), and what it answers per phone token. */
const google = { sent: [], answer: {} };
function fakeGoogle(url, init) {
  if (url.includes('oauth2')) return Promise.resolve({ status: 200, json: async () => ({ access_token: 'fake-access', expires_in: 3600 }) });
  const msg = JSON.parse(init.body).message;
  google.sent.push(msg);
  const status = google.answer[msg.token] ?? 200;
  return Promise.resolve({ status, json: async () => (status === 404 ? { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } } : { name: 'm1' }) });
}

before(async () => {
  process.env.COMMAND_TIMEOUT_MS = '2000';
  process.env.ACCESS_TICK_MS = '500';     // expiry side effects every half second in tests
  process.env.PRESENCE_TICK_MS = '500';
  process.env.PRESENCE_SETTLE_MS = '0';   // "away" counts at once in tests (normally after 2 minutes)
  process.env.ALLOW_SIGNUP = 'true';
  process.env.BROKER_LOG = BROKER_LOG;
  fs.writeFileSync(BROKER_LOG, '');
  process.env.GEOIP = 'off';
  delete process.env.FCM_SERVICE_ACCOUNT; // starts with phone push off, like a server without the key
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
  const mqtt = require('mqtt');
  const client = await mqtt.connectAsync(process.env.MQTT_URL ?? 'mqtt://localhost:1883', { username: 'api', password: process.env.MQTT_API_PASSWORD });
  for (const t of ['announce', 'status', 'config', 'devices/hall_light/state', 'devices/ceiling_fan/state', 'devices/fridge/state']) {
    await client.publishAsync(`home/v1/nodes/${NODE_ID}/${t}`, '', { retain: true, qos: 1 });
  }
  await client.endAsync();
  await app?.close();
  await prisma?.$disconnect();
  fs.rmSync(BROKER_LOG, { force: true });
});

const owner = new Client();
const guest = new Client();
const kid = new Client();
const state = {};
const board = async () => (await owner.get('/nodes')).body.find((n) => n.id === NODE_ID);
const isOn = async (id) => (await owner.get(`/devices/${id}`)).body.state?.on;

test('setup: a home, a board with a light, a fan-named switch and a fridge', async () => {
  const res = await owner.post('/auth/setup', { homeName: 'People home', name: 'Fawad Iqbal', email: 'owner@people.test', password: 'secret123' });
  assert.equal(res.status, 201);
  state.homeId = res.body.home.id;
  state.room = (await owner.get('/rooms')).body[0].id;
  fake = spawn('python3', [path.join(ROOT, 'tools/fake-node/fake_node.py'), '--id', NODE_ID, '--keepalive', '2',
    '--local-port', String(LOCAL_PORT), '--password', process.env.MQTT_NODE_PASSWORD ?? ''], { env: { ...process.env }, stdio: ['pipe', 'pipe', 'inherit'] });
  fake.stdout.on('data', () => {});
  await until('board in stock', async () => (await owner.get('/platform/inventory')).body.boards.find((b) => b.id === NODE_ID));
  assert.equal((await owner.post(`/platform/inventory/${NODE_ID}/assign`, { homeId: state.homeId })).status, 200);
  await until('board online', async () => (await board())?.online);
  assert.equal((await owner.post(`/nodes/${NODE_ID}/adopt`, { name: 'Hall board', board: 'NODEMCU_V2' })).status, 204);
  for (const [name, pin] of [['Hall light', 5], ['Ceiling fan', 4], ['Fridge', 14]]) {
    const d = await owner.post(`/nodes/${NODE_ID}/devices`, { name, type: 'switch', pin, roomId: state.room });
    assert.equal(d.status, 201, JSON.stringify(d.body));
    state[name] = d.body.id;
  }
  await until('applied', async () => { const n = await board(); return n.status === 'ADOPTED' && n.appliedRev === n.configRev && !n.configError; });
  await until('board holds its local key', async () => (await owner.get('/nodes/local')).body.find((n) => n.nodeId === NODE_ID && n.ready), 15000);
});

test('a guest with hours: inside them they switch; outside they get a clear 403 and no phone pass', async () => {
  // invited for the next hour or so, every day
  const invite = await owner.post('/invites', {
    email: 'maid@people.test', name: 'Shazia', role: 'GUEST', rooms: [{ roomId: state.room, access: 'CONTROL' }],
    accessFrom: homeClock(-60), accessTo: homeClock(90),
  });
  assert.equal(invite.status, 201, JSON.stringify(invite.body));
  assert.match(invite.body.access, /–/);
  assert.equal((await guest.get(`/invites/${invite.body.path.split('/').pop()}`)).body.access, invite.body.access);
  const joined = await guest.post(`/invites/${invite.body.path.split('/').pop()}/accept`, { name: 'Shazia', password: 'maidpass123' });
  assert.equal(joined.status, 201, JSON.stringify(joined.body));
  state.guestId = joined.body.id;
  assert.equal(joined.body.home.blocked, null);
  assert.ok(joined.body.home.access.summary);

  // inside the hours: devices, switching, a phone pass that ends when the hours do
  assert.equal((await guest.get('/devices')).body.length, 3);
  assert.equal((await guest.post(`/devices/${state['Hall light']}/commands`, { on: true })).status, 200);
  const passes = (await guest.get('/local')).body;
  assert.ok(passes.expiresAt, 'a time-limited pass says when it ends');
  const pass = JSON.parse(Buffer.from(passes.boards[0].pass, 'base64url').toString());
  assert.equal(pass.x, Math.floor(new Date(passes.expiresAt).getTime() / 1000));
  await until('guest pass works on the board', async () => (await localCall(passes.boards[0], '/local/state')).status === 200);
  const people = (await owner.get('/users')).body;
  assert.equal(people.find((p) => p.id === state.guestId).access.status, 'active');

  // the owner moves the hours to later today: outside them now
  const epoch = (await prisma.home.findUnique({ where: { id: state.homeId } })).localEpoch;
  const moved = await owner.patch(`/users/${state.guestId}`, { accessFrom: homeClock(120), accessTo: homeClock(180), accessDays: [] });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  const devices = await guest.get('/devices');
  assert.equal(devices.status, 403);
  assert.match(devices.body.message, /^Your access to People home is from \d{1,2}:\d{2} to \d{1,2}:\d{2}\.$/);
  assert.equal((await guest.post(`/devices/${state['Hall light']}/commands`, { on: false })).status, 403);
  assert.equal((await guest.get('/local')).status, 403);          // no phone pass outside the hours
  assert.equal((await guest.post('/assistant/chat', { text: 'lights off' })).status, 403); // nor the assistant
  // they can still open the app and read why
  const me = await guest.get('/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.home.blocked.reason, 'hours');
  assert.equal(me.body.home.blocked.message, devices.body.message);
  assert.equal((await guest.get('/notifications')).status, 200);
  // narrower hours retire the old passes on the boards
  assert.ok((await prisma.home.findUnique({ where: { id: state.homeId } })).localEpoch > epoch);
  await until('old guest pass refused', async () => (await localCall(passes.boards[0], '/local/state')).status === 401);
  assert.equal((await owner.get('/users')).body.find((p) => p.id === state.guestId).access.status, 'outside');

  // owners and admins can't be given hours
  assert.equal((await owner.patch(`/users/${state.guestId}`, { role: 'ADMIN', accessFrom: '09:00', accessTo: '17:00' })).status, 400);
});

test('an end time: exact, then marked expired (owners told, passes retired), and it can be extended', async () => {
  const until5s = new Date(Date.now() + 4000).toISOString();
  const set = await owner.patch(`/users/${state.guestId}`, { accessFrom: null, accessTo: null, accessUntil: until5s });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal((await guest.get('/devices')).status, 200);
  const passes = (await guest.get('/local')).body;
  assert.equal(new Date(passes.expiresAt).toISOString(), new Date(until5s).toISOString()); // capped at the end
  const epoch = (await prisma.home.findUnique({ where: { id: state.homeId } })).localEpoch;

  await until('end passed', async () => Date.now() > new Date(until5s).getTime() + 50, 8000);
  const after = await guest.get('/devices');
  assert.equal(after.status, 403);
  assert.match(after.body.message, /^Your access to People home ended on .+\. Ask the home’s owner if you need it again\.$/);
  // the minutely job: expired, the owner is told, the home's epoch goes up (the pass stops on the board)
  await until('marked expired', async () => (await owner.get('/users')).body.find((p) => p.id === state.guestId).access.status === 'expired');
  await until('owner told', async () => (await owner.get('/notifications')).body.items.find((n) => n.kind === 'accessEnded' && /Shazia/.test(n.title)));
  await until('epoch raised', async () => (await prisma.home.findUnique({ where: { id: state.homeId } })).localEpoch > epoch);
  await until('expired pass refused', async () => (await localCall(passes.boards[0], '/local/state')).status === 401);

  // extended by a day: in again
  const ext = await owner.patch(`/users/${state.guestId}`, { accessUntil: new Date(Date.now() + 86400_000).toISOString() });
  assert.equal(ext.status, 200);
  assert.equal((await guest.get('/devices')).status, 200);
  assert.equal((await owner.get('/users')).body.find((p) => p.id === state.guestId).access.status, 'active');
  assert.equal((await prisma.membership.findFirst({ where: { userId: state.guestId } })).expiredAt, null);
});

test('phone push tokens: register, move on rotation, unregister; FCM gets the notices and drops gone phones', async () => {
  const reg = await guest.post('/push/phone', { token: 'phone-token-aaaaaaaa', platform: 'android', appVersion: '1.2.0' });
  assert.equal(reg.status, 200, JSON.stringify(reg.body));
  assert.equal(reg.body.phonePush, false); // no key on this server yet: kept, nothing sent
  assert.deepEqual((await guest.get('/push/devices')).body, { devices: 0, phones: 1, phonePush: false });
  // Firebase rotated the token
  await guest.post('/push/phone', { token: 'phone-token-bbbbbbbb', platform: 'android', appVersion: '1.2.0', replaces: 'phone-token-aaaaaaaa' });
  assert.deepEqual((await prisma.phoneToken.findMany({ where: { userId: state.guestId } })).map((t) => t.token), ['phone-token-bbbbbbbb']);
  assert.equal((await guest.post('/push/phone', { token: 'x', platform: 'android' })).status, 400);
  // the same phone, now signed in by the owner: the token moves to them
  await owner.post('/push/phone', { token: 'phone-token-bbbbbbbb', platform: 'android' });
  assert.equal((await prisma.phoneToken.findUnique({ where: { token: 'phone-token-bbbbbbbb' } })).userId, (await owner.get('/auth/me')).body.id);
  assert.equal((await owner.post('/push/phone/remove', { token: 'phone-token-bbbbbbbb' })).status, 204);
  assert.equal(await prisma.phoneToken.count(), 0);

  // now with a (fake) Firebase key: notices go out through the same path as web push, with their link
  const { PushService } = require('../../dist/monitoring/push.service.js');
  const { FcmClient } = require('../../dist/monitoring/fcm.js');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sa = { project_id: 'people-test', client_email: 'push@people-test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  app.get(PushService, { strict: false }).useFcm(new FcmClient(sa, fakeGoogle));
  await owner.post('/push/phone', { token: 'owner-phone-1111', platform: 'android' });
  await owner.post('/push/phone', { token: 'owner-old-phone-2222', platform: 'android' });
  google.answer['owner-old-phone-2222'] = 404;
  // a notice for the owner (their guest's end time)
  await owner.patch(`/users/${state.guestId}`, { accessUntil: new Date(Date.now() + 1500).toISOString() });
  const sent = await until('pushed to the phone', async () => google.sent.find((m) => m.token === 'owner-phone-1111' && m.data.kind === 'accessEnded'), 8000);
  assert.match(sent.notification.title, /Shazia’s access ended/);
  assert.equal(sent.data.link, `/people?home=${state.homeId}`);
  assert.equal(sent.android.priority, 'NORMAL');
  await until('gone phone forgotten', async () => !(await prisma.phoneToken.findUnique({ where: { token: 'owner-old-phone-2222' } })));
  // a person who turned that kind of notice off gets no push for it
  await owner.put('/notifications/prefs', { accessEnded: false });
  const before = google.sent.length;
  await owner.patch(`/users/${state.guestId}`, { accessUntil: new Date(Date.now() + 1000).toISOString() });
  await until('expired again', async () => (await owner.get('/users')).body.find((p) => p.id === state.guestId).access.status === 'expired');
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(google.sent.slice(before).filter((m) => m.data.kind === 'accessEnded').length, 0);
  await owner.put('/notifications/prefs', { accessEnded: true });
  await owner.patch(`/users/${state.guestId}`, { accessUntil: null });
});

test('who\'s home: only people who share count; the last one out switches lights and fans off on the board', async () => {
  // a family member with control of the room
  const inv = await owner.post('/invites', { email: 'kid@people.test', role: 'MEMBER', rooms: [{ roomId: state.room, access: 'CONTROL' }] });
  await kid.post(`/invites/${inv.body.path.split('/').pop()}/accept`, { name: 'Ali', password: 'kidpass123' });

  // off by default: reports are ignored until they share
  assert.deepEqual((await kid.post('/presence', { atHome: true })).body, { sharing: false });
  assert.equal((await kid.get('/presence')).body.people.length, 0);
  const shared = (await kid.put('/presence/me', { sharing: true })).body;
  assert.equal(shared.sharing, true);
  // the phone gets the home's boards to ask on the Wi‑Fi
  assert.deepEqual(shared.boards, [{ nodeId: NODE_ID, ip: `127.0.0.1:${LOCAL_PORT}` }]);
  assert.equal((await owner.put('/presence/me', { sharing: true })).body.sharing, true);
  await kid.post('/presence', { atHome: true });
  await owner.post('/presence', { atHome: true });
  const who = (await owner.get('/presence')).body;
  assert.match(who.line, /^(Fawad and Ali|Ali and Fawad) are home\.$/);
  // the guest doesn't share: they see nothing of the others
  assert.deepEqual((await guest.get('/presence')).body.people, []);
  // only owners and admins set the rule
  assert.equal((await kid.put('/presence/rule', { switchOff: 'lights' })).status, 403);

  // when the last person leaves: lights and fans off, away mode on, tell me; coming home: a scene
  const scene = await owner.post('/scenes', { name: 'Welcome', actions: [{ deviceId: state['Hall light'], on: true }] });
  assert.equal(scene.status, 201, JSON.stringify(scene.body));
  const rule = await owner.put('/presence/rule', { switchOff: 'lights', awayMode: true, notify: true, arriveSceneId: scene.body.id });
  assert.equal(rule.status, 200, JSON.stringify(rule.body));
  assert.equal(rule.body.rule.out, false);
  assert.equal(rule.body.devices.find((d) => d.id === state.Fridge).lightOrFan, false);
  for (const name of ['Hall light', 'Ceiling fan', 'Fridge']) {
    assert.equal((await owner.post(`/devices/${state[name]}/commands`, { on: true })).status, 200);
  }

  // one leaves: nothing happens
  await kid.post('/presence', { atHome: false });
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(await isOn(state['Hall light']), true);
  // the last one leaves: off on the board (not the fridge), away mode on, the owner told
  await owner.post('/presence', { atHome: false });
  await until('light off', async () => (await isOn(state['Hall light'])) === false);
  await until('fan off', async () => (await isOn(state['Ceiling fan'])) === false);
  assert.equal(await isOn(state.Fridge), true);
  assert.equal((await owner.get('/home/away')).body.on, true);
  const left = await until('owner told', async () => (await owner.get('/notifications')).body.items.find((n) => n.kind === 'presence' && n.title === 'Everyone has left'));
  assert.match(left.body, /Switched off (Hall light, Ceiling fan|Ceiling fan, Hall light)\. Away mode on\./);
  const cmd = await prisma.command.findFirst({ where: { deviceId: state['Hall light'] }, orderBy: { createdAt: 'desc' } });
  assert.equal(cmd.channel, 'automation');
  // a phone push for it too (the owner's phone is registered)
  await until('pushed', async () => google.sent.find((m) => m.data.kind === 'presence'));
  // reports again while out: not twice
  await owner.post('/presence', { atHome: false });
  await new Promise((r) => setTimeout(r, 800));
  assert.equal((await owner.get('/notifications')).body.items.filter((n) => n.title === 'Everyone has left').length, 1);

  // Ali comes home: the welcome scene, away mode off again
  await kid.post('/presence', { atHome: true });
  await until('welcome scene ran', async () => (await isOn(state['Hall light'])) === true);
  await until('away off', async () => (await owner.get('/home/away')).body.on === false);
  const r = (await owner.get('/presence/rule')).body.rule;
  assert.equal(r.lastEvent, 'arrived');
  assert.match(r.lastResult, /Away mode off\. Ran Welcome\./);
  assert.equal((await owner.get('/presence')).body.line, 'Ali is home.');

  // someone who stops sharing no longer counts (and their reports are ignored)
  await kid.put('/presence/me', { sharing: false });
  assert.equal((await owner.get('/presence')).body.people.length, 1);
  assert.equal((await owner.del('/presence/rule')).status, 204);
});
