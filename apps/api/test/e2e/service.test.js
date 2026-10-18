/**
 * End-to-end: the company's service work, on the real API and database (no board needed):
 *   company settings -> a visit request booked for an installer -> a quote from the price list, opened
 *   by its secret link, accepted -> one step to an installation job (the home, its installer, the owner's
 *   invite) -> contract renewals and their reminders -> the low-stock warning -> ticket ratings ->
 *   the installer's day (only their own jobs, in driving order) and offline checklist ticks.
 *
 * WARNING: empties the database it points at. Run:  pnpm --filter @home/api test:e2e
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const API_PORT = Number(process.env.E2E_API_PORT || 4555);
const STOCK = ['esp-svc01', 'esp-svc02', 'esp-svc03', 'esp-svc04', 'esp-svc05'];
let app, base, prisma;

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

/** Today in Pakistan (where visits are booked), as YYYY-MM-DD. */
const pkDay = (offsetDays = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date(Date.now() + offsetDays * 86400_000));
const ok = (res, code = 200) => { assert.equal(res.status, code, JSON.stringify(res.body)); return res.body; };
const notices = async (c, kind) => (await c.get('/notifications')).body.items.filter((n) => n.kind === kind);

before(async () => {
  process.env.HELP_DIR = path.join(__dirname, 'help-fixture');
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
  // leave no retained configs from the stock boards on the broker
  const mqtt = require('mqtt');
  const client = await mqtt.connectAsync(process.env.MQTT_URL ?? 'mqtt://localhost:1883', { username: 'api', password: process.env.MQTT_API_PASSWORD });
  for (const id of STOCK) await client.publishAsync(`home/v1/nodes/${id}/config`, '', { retain: true, qos: 1 });
  await client.endAsync();
  await app?.close();
  await prisma?.$disconnect();
});

const boss = new Client();      // the company's super admin (and owner of its own home)
const ravi = new Client();      // an installer
const imran = new Client();     // another installer
const support = new Client();   // read-only support
const customer = new Client();  // the customer who accepts the quote and owns the new home
const s = {};

test('setup: a company with two installers and support, payment details, a base and a stock minimum', async () => {
  ok(await boss.post('/auth/setup', { homeName: 'Fawad Smart Homes', name: 'Fawad', email: 'fawad@service.example', password: 'lamp-post-42' }), 201);
  s.bossId = (await boss.get('/auth/me')).body.id;
  s.bossHome = (await boss.get('/auth/me')).body.home.id;
  for (const [c, email, name, staffRole] of [[ravi, 'ravi@service.example', 'Ravi', 'INSTALLER'], [imran, 'imran@service.example', 'Imran', 'INSTALLER'], [support, 'neha@service.example', 'Neha', 'SUPPORT']]) {
    const inv = ok(await boss.post('/platform/staff/invites', { email, name, staffRole }), 201);
    ok(await c.post(`/invites/${inv.token}/accept`, { name, password: 'lamp-post-42' }), 201);
  }
  const team = ok(await boss.get('/platform/staff')).people;
  s.raviId = team.find((p) => p.name === 'Ravi').id;
  s.imranId = team.find((p) => p.name === 'Imran').id;

  ok(await boss.post('/platform/inventory', { ids: STOCK.slice(0, 3), board: 'NODEMCU_V2' }), 201);
  // a JazzCash number must look like a phone number; the base needs both coordinates
  assert.equal((await boss.patch('/platform/org', { jazzcashNumber: 'abc' })).status, 400);
  assert.equal((await boss.patch('/platform/org', { baseLat: 31.52 })).status, 400);
  const org = ok(await boss.patch('/platform/org', {
    bankAccount: 'Meezan Bank · Fawad Smart Homes · PK36MEZN0001234567890', jazzcashNumber: '0300 1234567', easypaisaNumber: '0345-7654321',
    baseLat: 31.5204, baseLng: 74.3587, stockMin: 2,
  }));
  assert.equal(org.jazzcashNumber, '0300 1234567');
  assert.deepEqual([org.baseLat, org.baseLng, org.stockMin], [31.5204, 74.3587, 2]);
  assert.equal((await support.patch('/platform/org', { stockMin: 5 })).status, 403);
});

test('a visit request is booked for an installer: date, time and a WhatsApp number', async () => {
  const send = (body) => fetch(`${base}/public/visit-requests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await send({ name: 'Ayesha Khan', phone: '0300-1234567', city: 'Lahore', homeSize: '5 marla' })).status, 201);
  assert.equal((await send({ name: 'Bilal Ahmed', phone: '+92 321 7654321', city: 'Lahore', homeSize: '10 marla' })).status, 201);
  const list = ok(await boss.get('/platform/visit-requests')).requests;
  const ayesha = list.find((r) => r.name === 'Ayesha Khan');
  s.visitId = ayesha.id;
  s.bilalVisit = list.find((r) => r.name === 'Bilal Ahmed').id;
  assert.equal(ayesha.whatsapp, '923001234567');

  assert.equal((await boss.patch(`/platform/visit-requests/${ayesha.id}`, { visitAt: 'tomorrow' })).status, 400);
  assert.equal((await boss.patch(`/platform/visit-requests/${ayesha.id}`, { assigneeId: (await support.get('/auth/me')).body.id })).status, 400); // support doesn't go on visits
  const booked = ok(await boss.patch(`/platform/visit-requests/${ayesha.id}`, { visitAt: `${pkDay(1)}T16:00`, assigneeId: s.raviId }));
  assert.equal(booked.status, 'SCHEDULED'); // a date means it is booked
  const again = ok(await boss.get('/platform/visit-requests')).requests.find((r) => r.id === ayesha.id);
  assert.equal(again.assignee, 'Ravi');
  // 4 pm in Lahore is 11:00 UTC
  assert.equal(new Date(again.visitAt).toISOString().slice(11, 16), '11:00');
});

test('quote: built from the price list, opened by its secret link, accepted, then turned into an installation job', async () => {
  // the starter price list (rupees), editable by a super admin only
  const prices = ok(await boss.get('/platform/price-items'));
  assert.ok(prices.items.length >= 8 && prices.canEdit);
  assert.ok(prices.items.some((p) => /Fan speed regulator/.test(p.name)) && prices.items.some((p) => /tank/i.test(p.name)));
  const board4 = prices.items.find((p) => /4 switches/.test(p.name));
  const motion = prices.items.find((p) => /Motion sensor/.test(p.name));
  const changed = ok(await boss.put('/platform/price-items', { items: prices.items.map((p) => (p.id === motion.id ? { ...p, price: 2500 } : p)) }));
  assert.equal(changed.items.find((p) => p.id === motion.id).price, 2500);
  assert.equal(changed.items.length, prices.items.length);
  assert.equal((await ravi.put('/platform/price-items', { items: [] })).status, 403);
  assert.equal((await ravi.post('/platform/quotes', { visitRequestId: s.visitId, items: [] })).status, 403); // visit requests are the office's

  const made = ok(await boss.post('/platform/quotes', {
    visitRequestId: s.visitId, discount: 1500, note: 'Includes one year of free check-ups.',
    items: [
      { priceItemId: board4.id, name: board4.name, unit: board4.unit, qty: 3, price: board4.price },
      { priceItemId: motion.id, name: motion.name, unit: 'each', qty: 2, price: 2500 },
      { name: 'Move the router to the hallway', qty: 1, price: 1000 },
    ],
  }), 201);
  assert.equal(made.status, 'DRAFT');
  assert.equal(made.ref, `Q-${made.number}`);
  assert.equal(made.customerName, 'Ayesha Khan');
  assert.equal(made.whatsapp, '923001234567');
  assert.equal(made.subtotal, 3 * board4.price + 5000 + 1000);
  assert.equal(made.total, made.subtotal - 1500);
  s.quote = made;
  const token = made.path.split('/').pop();
  const anyone = new Client();

  // a draft isn't visible by its link; sending it makes the link work
  assert.equal((await anyone.get(`/public/quotes/${token}`)).status, 404);
  assert.equal(ok(await boss.post(`/platform/quotes/${made.id}/send`)).status, 'SENT');
  const pub = ok(await anyone.get(`/public/quotes/${token}`));
  assert.equal(pub.company.name, 'Fawad Smart Homes');
  assert.equal(pub.total, made.total);
  assert.equal(pub.items.length, 3);
  assert.equal(pub.canAnswer, true);
  assert.equal(pub.token, undefined);
  assert.equal((await anyone.get('/public/quotes/not-a-real-token-at-all-1234')).status, 404);
  // the customer may be looking at it: a sent quote is changed only after opening it as a draft again
  assert.equal((await boss.patch(`/platform/quotes/${made.id}`, { discount: 0 })).status, 400);

  const accepted = ok(await anyone.post(`/public/quotes/${token}/accept`, { name: 'Ayesha Khan' }));
  assert.equal(accepted.status, 'ACCEPTED');
  assert.equal(accepted.canAnswer, false);
  assert.equal((await anyone.post(`/public/quotes/${token}/decline`, {})).status, 400); // the first answer counts
  assert.ok((await notices(boss, 'quoteAnswered')).some((n) => n.title === `Ayesha Khan accepted quote ${made.ref}`));

  // one step: the home (made from the visit request), its installer, the owner's invite; the request becomes a customer
  assert.equal((await ravi.post(`/platform/quotes/${made.id}/convert`, { installerId: s.raviId })).status, 403);
  const job = ok(await boss.post(`/platform/quotes/${made.id}/convert`, { installerId: s.raviId, ownerEmail: 'ayesha@example.com' }));
  assert.ok(job.homeId && job.invite.path.startsWith('/invite/'));
  s.homeId = job.homeId;
  s.ownerInvite = job.invite.token;
  assert.ok(job.quote.convertedAt);
  assert.equal((await boss.post(`/platform/quotes/${made.id}/convert`, { installerId: s.raviId })).status, 400);
  const visit = ok(await boss.get('/platform/visit-requests')).requests.find((r) => r.id === s.visitId);
  assert.equal(visit.status, 'CUSTOMER');
  assert.equal(visit.home.id, s.homeId);
  const ws = ok(await boss.get(`/platform/homes/${s.homeId}`));
  assert.equal(ws.home.name, 'Ayesha’s home');
  assert.equal(ws.home.installer.name, 'Ravi');
  assert.ok((await notices(ravi, 'newJob')).some((n) => n.title === 'New installation job: Ayesha Khan'));

  // the accepted items are the installer's list on the installation report
  const report = ok(await ravi.get(`/platform/homes/${s.homeId}/installation`));
  assert.deepEqual(report.toInstall.items.map((i) => [i.name, i.qty]), [[board4.name, 3], [motion.name, 2], ['Move the router to the hallway', 1]]);
  assert.equal(report.toInstall.quotes[0].ref, made.ref);
  assert.equal((await imran.get(`/platform/homes/${s.homeId}/installation`)).status, 404);
  assert.ok(ok(await boss.get('/platform/audit?category=all&limit=50')).some((a) => a.action === 'quote.convert'));

  // a home's quote: staff can price more work for it; declined with a reason, then changed and sent again
  const extra = ok(await ravi.post('/platform/quotes', { homeId: s.homeId, items: [{ name: 'Water tank level sensor', qty: 1, price: 4500 }] }), 201);
  assert.equal(extra.customerName, 'Ayesha Khan');
  assert.equal((await imran.get(`/platform/quotes/${extra.id}`)).status, 404); // not his home
  ok(await ravi.post(`/platform/quotes/${extra.id}/send`));
  const xToken = extra.path.split('/').pop();
  assert.equal(ok(await anyone.post(`/public/quotes/${xToken}/decline`, { reason: 'Too much for now' })).status, 'DECLINED');
  assert.ok((await notices(boss, 'quoteAnswered')).some((n) => /declined/.test(n.title) && /Too much for now/.test(n.body)));
  assert.equal((await ravi.post(`/platform/quotes/${extra.id}/convert`, { installerId: s.raviId })).status, 403);
  assert.equal(ok(await ravi.patch(`/platform/quotes/${extra.id}`, { status: 'DRAFT', discount: 500 })).total, 4000);
  assert.equal((await anyone.get(`/public/quotes/${xToken}`)).status, 404); // a draft again
  assert.equal((await support.patch(`/platform/quotes/${extra.id}`, { discount: 0 })).status, 403);
  const quotes = ok(await support.get(`/platform/quotes?homeId=${s.homeId}`)).quotes;
  assert.equal(quotes.length, 2);
});

test('the customer: phone number on their account, accepted owner invite', async () => {
  ok(await customer.post(`/invites/${s.ownerInvite}/accept`, { name: 'Ayesha Khan', password: 'lamp-post-42' }), 201);
  customer.home = s.homeId;
  assert.equal((await customer.patch('/account/phone', { phone: '12' })).status, 400);
  assert.equal(ok(await customer.patch('/account/phone', { phone: '0333-1112223' })).phone, '+92 333 1112223');
  assert.equal(ok(await customer.get('/auth/me')).phone, '+92 333 1112223');
  // staff can fill it in from the home's page, but not for people outside their homes
  const ownerId = ok(await customer.get('/auth/me')).id;
  assert.equal((await imran.patch(`/platform/homes/${s.homeId}/people/${ownerId}/phone`, { phone: '0300 0000000' })).status, 404);
  assert.equal(ok(await ravi.patch(`/platform/homes/${s.homeId}/people/${ownerId}/phone`, { phone: '0333 1112224' })).phone, '+92 333 1112224');
  assert.equal(ok(await boss.get(`/platform/homes/${s.homeId}`)).home.owner.phone, '+92 333 1112224');
  s.ownerId = ownerId;
});

test('renewals: contracts ending soon and lapsed ones, reminders once each, renewing logged', async () => {
  const day = (offset) => pkDay(offset);
  // ending in 20 days (the new customer), and one that ended without renewal (the company's own home)
  ok(await boss.post('/platform/billing/contracts', { homeId: s.homeId, plan: 'Care plan', amount: 2500, period: 'MONTHLY', startsOn: day(-40), endsOn: day(20) }), 201);
  ok(await boss.post('/platform/billing/contracts', { homeId: s.bossHome, plan: 'Basic care', amount: 1000, period: 'MONTHLY', startsOn: day(-100), endsOn: day(-10) }), 201);
  const list = ok(await boss.get('/platform/billing/renewals'));
  const soon = list.contracts.find((c) => c.homeId === s.homeId);
  const lapsed = list.contracts.find((c) => c.plan === 'Basic care');
  assert.equal(soon.daysLeft, 20);
  assert.equal(soon.ended, false);
  assert.equal(soon.contact.whatsapp, '923331112224'); // the owner's number
  assert.equal(lapsed.ended, true);
  assert.equal(lapsed.daysLeft, -10);
  assert.equal(list.company.pay.jazzcash, '0300 1234567');
  assert.equal((await ravi.get('/platform/billing/renewals')).status, 403);
  assert.equal(ok(await support.get('/platform/billing/renewals')).canEdit, false);
  assert.equal((await support.post(`/platform/billing/contracts/${soon.id}/renew`, { months: 6 })).status, 403);
  assert.equal(ok(await boss.get('/platform/billing')).renewals, 2);

  // the 30-day reminder goes out once, even after a "restart" (it is remembered in the database)
  const { BillingService } = require('../../dist/billing/billing.service.js');
  await app.get(BillingService).tick();
  await app.get(BillingService).tick();
  const ending = (await notices(boss, 'contractEnding')).filter((n) => n.title.startsWith('Ayesha’s home'));
  assert.equal(ending.length, 1);
  assert.equal(ending[0].title, 'Ayesha’s home: contract ends in 20 days');
  assert.ok((await prisma.contract.findUnique({ where: { id: soon.id } })).remind30At);
  // 14 days later: the 7-day one, once
  await app.get(BillingService).tick(new Date(Date.now() + 14 * 86400_000));
  await app.get(BillingService).tick(new Date(Date.now() + 14 * 86400_000));
  assert.equal((await notices(boss, 'contractEnding')).filter((n) => n.title.startsWith('Ayesha’s home')).length, 2);

  // renew for a year at a new price: from the old end date, reminders armed again, logged
  assert.equal((await boss.post(`/platform/billing/contracts/${soon.id}/renew`, {})).status, 400);
  const renewed = ok(await boss.post(`/platform/billing/contracts/${soon.id}/renew`, { months: 12, amount: 2800 }));
  assert.ok(!renewed.contracts.some((c) => c.id === soon.id)); // a year away: off the list
  const row = await prisma.contract.findUnique({ where: { id: soon.id } });
  assert.equal(row.endsOn.toISOString().slice(0, 10), `${Number(day(20).slice(0, 4)) + 1}${day(20).slice(4)}`);
  assert.equal(row.amount, 2800);
  assert.equal(row.remind30At, null);
  const audit = ok(await boss.get('/platform/audit?category=all&limit=100')).find((a) => a.action === 'contract.renew');
  assert.ok(audit);

  // the lapsed one: renewed until a chosen day, it runs again from today
  assert.equal((await boss.post(`/platform/billing/contracts/${lapsed.id}/renew`, { until: day(-20) })).status, 400);
  ok(await boss.post(`/platform/billing/contracts/${lapsed.id}/renew`, { until: day(200) }));
  const back = await prisma.contract.findUnique({ where: { id: lapsed.id } });
  assert.equal(back.status, 'ACTIVE');
  assert.equal(ok(await boss.get('/platform/billing/renewals')).contracts.length, 0);
});

test('stock: one warning when boards in stock drop below the minimum, again only after it went back up', async () => {
  const inv = ok(await boss.get('/platform/inventory'));
  assert.deepEqual(inv.stock, { inStock: 3, min: 2, low: false });
  const assign = async (id) => ok(await boss.post(`/platform/inventory/${id}/assign`, { homeId: s.homeId }));
  await assign(STOCK[0]); // 2 left: not below 2
  assert.equal((await notices(boss, 'stockLow')).length, 0);
  await assign(STOCK[1]); // 1 left: warn
  const warned = await notices(boss, 'stockLow');
  assert.equal(warned.length, 1);
  assert.equal(warned[0].title, 'Only 1 board left in stock');
  await assign(STOCK[2]); // 0 left: already warned
  assert.equal((await notices(boss, 'stockLow')).length, 1);
  assert.equal(ok(await boss.get('/platform/inventory')).stock.low, true);
  // back up to the minimum, then down again: a second warning
  ok(await boss.post('/platform/inventory', { ids: STOCK.slice(3), board: 'NODEMCU_V2' }), 201);
  assert.equal((await prisma.organization.findFirst({ where: { name: 'Fawad Smart Homes' } })).stockAlertAt, null);
  await assign(STOCK[3]);
  assert.equal((await notices(boss, 'stockLow')).length, 2);
  // installers don't get it
  assert.equal((await notices(ravi, 'stockLow')).length, 0);
});

test('ticket ratings: only the person who asked, only once it is solved, changeable for 7 days', async () => {
  // a family admin who can see the home's tickets but didn't ask
  const inv = ok(await customer.post('/invites', { email: 'omar@example.com', role: 'ADMIN' }), 201);
  const omar = new Client();
  ok(await omar.post(`/invites/${inv.token}/accept`, { name: 'Omar', password: 'lamp-post-42' }), 201);
  omar.home = s.homeId;

  const t = ok(await customer.post('/support/tickets', { body: 'The lounge lights do not switch from the app.' }), 201);
  assert.equal(t.canRate, false);
  assert.equal((await customer.post(`/support/tickets/${t.id}/rating`, { stars: 5 })).status, 403);
  // a staff reply: the ticket view has the customer's WhatsApp number for the update
  const staffView = ok(await ravi.post(`/platform/tickets/${t.id}/reply`, { body: 'Coming tomorrow at 11.', status: 'RESOLVED' }), 201);
  assert.equal(staffView.contact.whatsapp, '923331112224');
  assert.equal(staffView.company, 'Fawad Smart Homes');

  const seen = ok(await customer.get(`/support/tickets/${t.id}`));
  assert.equal(seen.canRate, true);
  assert.equal(ok(await omar.get(`/support/tickets/${t.id}`)).canRate, false);
  assert.equal((await omar.post(`/support/tickets/${t.id}/rating`, { stars: 1 })).status, 403);
  boss.home = s.homeId;
  assert.equal((await boss.post(`/support/tickets/${t.id}/rating`, { stars: 5 })).status, 403);
  boss.home = null;
  assert.equal((await customer.post(`/support/tickets/${t.id}/rating`, { stars: 6 })).status, 400);

  const rated = ok(await customer.post(`/support/tickets/${t.id}/rating`, { stars: 4, comment: 'Quick, but came late.' }), 201);
  assert.equal(rated.rating, 4);
  assert.equal(rated.ratingComment, 'Quick, but came late.');
  const firstAt = rated.ratedAt;
  assert.ok((await notices(ravi, 'supportRequest')).some((n) => n.title.startsWith(`#${t.number} rated ★★★★☆`)));
  // changed within 7 days: the first rating's time stays
  const changed = ok(await customer.post(`/support/tickets/${t.id}/rating`, { stars: 5 }), 201);
  assert.equal(changed.rating, 5);
  assert.equal(changed.ratingComment, null);
  assert.equal(changed.ratedAt, firstAt);
  // staff see it on the ticket and in the averages
  assert.equal(ok(await boss.get(`/platform/tickets/${t.id}`)).rating, 5);
  const avg = ok(await boss.get('/platform/tickets/ratings'));
  assert.deepEqual(avg.company, { average: 5, count: 1 });
  assert.deepEqual(avg.people.map((p) => [p.name, p.average, p.count]), [['Ravi', 5, 1]]);
  assert.deepEqual(ok(await imran.get('/platform/tickets/ratings')).people, []);
  // after 7 days it is final
  await prisma.ticket.update({ where: { id: t.id }, data: { ratedAt: new Date(Date.now() - 8 * 86400_000) } });
  assert.equal(ok(await customer.get(`/support/tickets/${t.id}`)).canRate, false);
  const late = await customer.post(`/support/tickets/${t.id}/rating`, { stars: 1 });
  assert.equal(late.status, 403);
  assert.match(late.body.message, /7 days/);
  s.ticket = t;
  // reopened for the day planner: an open ticket assigned to Ravi
  ok(await customer.post(`/support/tickets/${t.id}/reply`, { body: 'It stopped again.', solved: false }), 201);
});

test('the installer’s day: only their own jobs, nearest first from the base, with Google Maps links', async () => {
  // a second customer home for Ravi, nearer the base; Bilal's visit booked for Ravi today; Imran gets a visit too
  const near = ok(await boss.post('/platform/homes', { name: 'Near home', city: 'Lahore', installerId: s.raviId }), 201);
  await prisma.home.update({ where: { id: near.id }, data: { latitude: 31.521, longitude: 74.359 } });
  await prisma.home.update({ where: { id: s.homeId }, data: { latitude: 31.47, longitude: 74.27 } });
  ok(await boss.patch(`/platform/visit-requests/${s.bilalVisit}`, { visitAt: `${pkDay(0)}T15:30`, assigneeId: s.raviId }));
  const send = await fetch(`${base}/public/visit-requests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Sara Malik', phone: '0312 3456789', city: 'Karachi', homeSize: '1 kanal' }) });
  assert.equal(send.status, 201);
  const sara = ok(await boss.get('/platform/visit-requests')).requests.find((r) => r.name === 'Sara Malik');
  ok(await boss.patch(`/platform/visit-requests/${sara.id}`, { visitAt: `${pkDay(0)}T12:00`, assigneeId: s.imranId }));

  const day = ok(await ravi.get('/platform/day'));
  assert.equal(day.installer.name, 'Ravi');
  assert.equal(day.date, pkDay(0));
  assert.deepEqual(day.installers, []); // installers can't pick someone else
  assert.deepEqual(day.stops.map((x) => x.name), ['Near home', 'Ayesha’s home', 'Bilal Ahmed']); // Bilal's home has no location yet: last
  const ayesha = day.stops[1];
  assert.deepEqual(ayesha.jobs.map((j) => j.type).sort(), ['install', 'ticket']);
  assert.equal(ayesha.whatsapp, '923331112224');
  assert.ok(day.stops[0].legKm < 1);
  assert.equal(day.stops[2].legKm, null);
  assert.equal(day.stops[2].jobs[0].type, 'visit');
  assert.match(day.stops[2].jobs[0].detail, /^3:30 pm/);
  assert.equal(day.stops[2].whatsapp, '923217654321');
  const route = new URL(day.mapsUrl);
  assert.equal(route.searchParams.get('origin'), '31.520400,74.358700');
  assert.equal(route.searchParams.get('waypoints'), '31.521000,74.359000');
  assert.equal(route.searchParams.get('destination'), '31.470000,74.270000');
  assert.match(day.stops[2].directions, /destination=Lahore/);
  assert.equal(day.counts.visits, 1);

  // Imran sees only his own visit; he can't open Ravi's day
  const his = ok(await imran.get('/platform/day'));
  assert.deepEqual(his.stops.map((x) => x.name), ['Sara Malik']);
  assert.equal((await imran.get(`/platform/day?installerId=${s.raviId}`)).status, 403);
  // a super admin (and support) can pick an installer
  const picked = ok(await boss.get(`/platform/day?installerId=${s.raviId}`));
  assert.deepEqual(picked.stops.map((x) => x.name), day.stops.map((x) => x.name));
  assert.ok(picked.installers.some((i) => i.name === 'Imran'));
  assert.equal((await boss.get(`/platform/day?installerId=${s.ownerId}`)).status, 400);
  // a past day shows only what was booked for it (ongoing installations and tickets are today's work)
  assert.equal(ok(await ravi.get(`/platform/day?date=${pkDay(-3)}`)).stops.length, 0);
  assert.equal((await ravi.get('/platform/day?date=soon')).status, 400);
});

test('offline checklist ticks: sent later, the newest change of each item wins', async () => {
  const url = `/platform/homes/${s.homeId}/installation`;
  const now = Date.now();
  ok(await boss.put(url, { items: [{ key: 'mains', done: true, at: new Date(now - 60_000).toISOString() }] }));
  // Ravi's phone was offline: his older "not done" for mains loses, his note for wiring is kept
  const r = ok(await ravi.put(url, { items: [
    { key: 'mains', done: false, at: new Date(now - 10 * 60_000).toISOString() },
    { key: 'wiring', done: true, note: 'Used 2.5 mm for the geyser', at: new Date(now - 10 * 60_000).toISOString() },
  ] }));
  assert.equal(r.items.find((i) => i.key === 'mains').done, true);
  const wiring = r.items.find((i) => i.key === 'wiring');
  assert.equal(wiring.done, true);
  assert.equal(wiring.note, 'Used 2.5 mm for the geyser');
  assert.equal((await imran.put(url, { items: [{ key: 'clean', done: true }] })).status, 404);
});
