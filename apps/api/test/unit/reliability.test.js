// Reliability: when a late timer still runs, retries, sign-in limits, the visitor's address, and the pin
// plan of a board swap. On the built code (pnpm build first); no database or broker needed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { missedDecision, retryDelayMin, skippedText, lateNote, clockText, runSummary, failureLine } = require('../../dist/automation/schedule-policy.js');
const { limitState, RULES, blockedMessage, waitText } = require('../../dist/auth/login-limiter.js');
const { clientIp } = require('../../dist/common/client-ip.js');
const { pinPlan, swapProblems, firmwareWarnings, replacedNote } = require('../../dist/hardware/board-swap.js');

const MIN = 60_000;
const off = [{ on: false }];
const on = [{ on: true }];

test('on time, or late within the cut-off: it runs', () => {
  for (const kind of ['ONCE', 'DAILY', 'SUN']) {
    for (const ifMissed of ['auto', 'run', 'skip']) {
      assert.equal(missedDecision({ kind, ifMissed }, on, 0, 15), 'run');
      assert.equal(missedDecision({ kind, ifMissed }, on, 15 * MIN, 15), 'run');
    }
  }
});

test('after downtime: a missed "geyser off" still runs, a missed "lights on at 7:00" does not', () => {
  const late = 4 * 60 * MIN; // 07:00 timer, server back at 11:00
  assert.equal(missedDecision({ kind: 'ONCE', ifMissed: 'auto' }, off, late, 15), 'run');
  assert.equal(missedDecision({ kind: 'ONCE', ifMissed: 'auto' }, on, late, 15), 'skip');
  // anything that switches something on is not "safe to do late"
  assert.equal(missedDecision({ kind: 'ONCE', ifMissed: 'auto' }, [{ on: false }, { on: true }], late, 15), 'skip');
  // a timer with nothing in it (a scene that was emptied) has nothing safe to do
  assert.equal(missedDecision({ kind: 'ONCE', ifMissed: 'auto' }, [], late, 15), 'skip');
  // daily and sunset schedules run again at their next time: skip, even when they switch things off
  assert.equal(missedDecision({ kind: 'DAILY', ifMissed: 'auto' }, off, late, 15), 'skip');
  assert.equal(missedDecision({ kind: 'SUN', ifMissed: 'auto' }, off, 16 * MIN, 15), 'skip');
});

test('the per-schedule choice wins over the default', () => {
  const late = 3 * 60 * MIN;
  assert.equal(missedDecision({ kind: 'DAILY', ifMissed: 'run' }, on, late, 15), 'run');
  assert.equal(missedDecision({ kind: 'ONCE', ifMissed: 'skip' }, off, late, 15), 'skip');
  assert.equal(missedDecision({ kind: 'ONCE', ifMissed: 'run' }, on, 30 * 24 * 60 * MIN, 15), 'run');
  // the cut-off can be changed
  assert.equal(missedDecision({ kind: 'DAILY', ifMissed: 'auto' }, on, 20 * MIN, 30), 'run');
});

test('retries after 1, 3 and 10 minutes, then no more', () => {
  const delays = [1, 3, 10];
  assert.deepEqual([1, 2, 3, 4].map((a) => retryDelayMin(a, delays)), [1, 3, 10, null]);
  assert.equal(retryDelayMin(1, []), null);
  assert.equal(retryDelayMin(0, delays), null);
});

test('what the schedule says, in the home\'s time', () => {
  const tz = 'Asia/Karachi';
  const due = new Date('2026-10-18T02:00:00Z');                    // 07:00 in Karachi
  assert.equal(skippedText(due, tz, new Date('2026-10-18T06:00:00Z')), 'Skipped: the server was down at 07:00.');
  assert.equal(clockText(due, tz, new Date('2026-10-19T06:00:00Z')), 'Sun 18 Oct, 07:00');   // not today: the day too
  assert.equal(lateNote(due, tz, new Date('2026-10-18T02:00:30Z')), '');                        // on time
  assert.equal(lateNote(due, tz, new Date('2026-10-18T02:12:00Z')), 'Ran 12 min late (the server was down at 07:00). ');
  assert.equal(lateNote(due, tz, new Date('2026-10-18T06:00:00Z')), 'Ran 4 h late (the server was down at 07:00). ');
  assert.equal(runSummary(['Lamp on'], ['Fan: offline']), 'Done: Lamp on. Failed: Fan: offline');
  assert.equal(runSummary([], []), 'Nothing to do.');
  assert.equal(failureLine('Lamp', 'Lamp is offline: its board is not connected.'), 'Lamp is offline: its board is not connected.');
  assert.equal(failureLine('Lamp', 'You may not control this room.'), 'Lamp: You may not control this room.');
});

const pair = RULES.login.find((r) => r.scope === 'pair');
const perIp = RULES.login.find((r) => r.scope === 'ip');
const account = RULES.login.find((r) => r.scope === 'account');

test('5 wrong passwords in 15 minutes: a 15-minute wait for that email on that network', () => {
  const t0 = Date.parse('2026-10-18T10:00:00Z');
  const tries = [0, 1, 2, 3].map((m) => t0 + m * MIN);
  assert.deepEqual(limitState(tries, pair, t0 + 4 * MIN), { blocked: false, waitMs: 0, left: 1, since: null });
  tries.push(t0 + 4 * MIN);
  const s = limitState(tries, pair, t0 + 5 * MIN);
  assert.equal(s.blocked, true);
  assert.equal(s.waitMs, 14 * MIN);
  assert.equal(s.since, t0 + 4 * MIN);
  // tries spread over more than 15 minutes never add up to a wait
  const slow = [0, 4, 8, 12, 16, 20].map((m) => t0 + m * MIN);
  assert.equal(limitState(slow, pair, t0 + 21 * MIN).blocked, false);
});

test('after the wait the count starts fresh: one wrong try does not lock again', () => {
  const t0 = Date.parse('2026-10-18T10:00:00Z');
  const tries = [0, 1, 2, 3, 4].map((m) => t0 + m * MIN);
  const after = t0 + 20 * MIN;                                     // the wait ended at 19 min
  assert.equal(limitState(tries, pair, after).blocked, false);
  assert.equal(limitState(tries, pair, after).left, 5);
  const one = limitState([...tries, after], pair, after + 1000);
  assert.equal(one.blocked, false);
  assert.equal(one.left, 4);
  // tries refused during a wait don't count (they never reach the password check), even if they were recorded
  const during = [...tries, t0 + 6 * MIN, t0 + 7 * MIN, t0 + 8 * MIN, t0 + 9 * MIN];
  assert.equal(limitState(during, pair, after).left, 5);
});

test('per network across emails, and a high cap per account across networks', () => {
  const t0 = Date.parse('2026-10-18T10:00:00Z');
  const spray = Array.from({ length: 30 }, (_, i) => t0 + i * 20_000);   // 30 wrong tries in 10 minutes from one network
  assert.equal(limitState(spray.slice(0, 29), perIp, t0 + 10 * MIN).blocked, false);
  assert.equal(limitState(spray, perIp, t0 + 10 * MIN).blocked, true);
  // an account tried from everywhere: 50 in an hour → at most a 15-minute wait for its owner
  const spread = Array.from({ length: 50 }, (_, i) => t0 + i * MIN);
  const s = limitState(spread, account, t0 + 50 * MIN);
  assert.equal(s.blocked, true);
  assert.ok(s.waitMs <= 15 * MIN);
  assert.equal(limitState(spread, account, t0 + 49 * MIN + 15 * MIN).blocked, false);
});

test('"Forgot password?" is a rolling count, not a wait', () => {
  const rule = RULES.forgot.find((r) => r.scope === 'account');
  const t0 = Date.parse('2026-10-18T10:00:00Z');
  const asked = [t0, t0 + 10 * MIN, t0 + 20 * MIN];
  const s = limitState(asked, rule, t0 + 30 * MIN);
  assert.equal(s.blocked, true);
  assert.equal(s.waitMs, 30 * MIN);                                // the first one leaves the hour at 60 min
  assert.equal(limitState(asked, rule, t0 + 61 * MIN).blocked, false);
});

test('the messages say how long to wait', () => {
  assert.equal(waitText(14 * MIN + 1), '15 minutes');
  assert.equal(waitText(30_000), '1 minute');
  assert.match(blockedMessage('login', 'pair', 14 * MIN), /try again in 14 minutes/);
  assert.match(blockedMessage('login', 'ip', 3 * MIN), /from this network\. Try again in 3 minutes/);
  assert.match(blockedMessage('login', 'account', 15 * MIN), /this account/);
  assert.match(blockedMessage('code', 'pair', 15 * MIN), /wrong codes/);
});

test('the visitor\'s address: X-Forwarded-For only from our own proxy, and its last hop', () => {
  const req = (peer, xff) => ({ socket: { remoteAddress: peer }, headers: xff === undefined ? {} : { 'x-forwarded-for': xff } });
  assert.equal(clientIp(req('203.0.113.9')), '203.0.113.9');
  // someone reaching the API directly can't pick their address
  assert.equal(clientIp(req('203.0.113.9', '1.2.3.4')), '203.0.113.9');
  // behind Caddy (a private address): what Caddy saw
  assert.equal(clientIp(req('::ffff:172.18.0.5', '198.51.100.7')), '198.51.100.7');
  // a client that sends its own header: the proxy appends the real address on the right
  assert.equal(clientIp(req('127.0.0.1', '1.2.3.4, 198.51.100.7')), '198.51.100.7');
  assert.equal(clientIp(req('127.0.0.1', '1.2.3.4, 198.51.100.7, 10.0.0.2'), 2), '198.51.100.7');
  assert.equal(clientIp(req('127.0.0.1')), '127.0.0.1');
});

test('swap: the new board must have every pin, with the same use, extra pins included', () => {
  const devices = [
    { name: 'Lamp', type: 'switch', pin: 5, settings: {} },
    { name: 'Ceiling fan', type: 'fan', pin: 14, settings: { pins: [12, 13] } },
    { name: 'Tank', type: 'tank', pin: 4, settings: { echoPin: 3 } },
  ];
  const inputs = [{ name: '', type: 'wall_switch', pin: 0, settings: {}, targetId: 'x', actions: {} }];
  const plan = pinPlan('NODEMCU_V2', 'WEMOS_D1_MINI', devices, inputs);
  assert.deepEqual(plan.map((r) => [r.gpio, r.from, r.to, r.use]), [
    [0, 'D3 (GPIO 0)', 'D3 (GPIO 0)', 'input'], [3, 'RX (GPIO 3)', 'RX (GPIO 3)', 'input'], [4, 'D2 (GPIO 4)', 'D2 (GPIO 4)', 'output'],
    [5, 'D1 (GPIO 5)', 'D1 (GPIO 5)', 'output'], [12, 'D6 (GPIO 12)', 'D6 (GPIO 12)', 'output'], [13, 'D7 (GPIO 13)', 'D7 (GPIO 13)', 'output'],
    [14, 'D5 (GPIO 14)', 'D5 (GPIO 14)', 'output'],
  ]);
  assert.ok(plan.some((r) => r.name === 'Ceiling fan · relay 3'));
  assert.deepEqual(swapProblems('WEMOS_D1_MINI', plan), []);       // a NodeMCU and a D1 mini share their pins
  assert.deepEqual(swapProblems('NOPE', plan), ['Unknown board model NOPE.']);
  // a pin the new board can't use that way is named
  const bad = pinPlan('NODEMCU_V2', 'NODEMCU_V2', [{ name: 'Fan', type: 'fan', pin: 14, settings: { pins: [12, 17] } }], []);
  assert.match(swapProblems('NODEMCU_V2', bad)[0], /^Fan · relay 3: A0 \(GPIO 17\) cannot be used as output/);
});

test('swap: firmware the new board needs, and the note on the old one', () => {
  const devices = [{ name: 'Ceiling fan', type: 'fan', pin: 14, settings: { pins: [12, 13] } }];
  assert.match(firmwareWarnings('2.5.0', devices, [])[0], /needs firmware 2\.6\.0/);
  assert.deepEqual(firmwareWarnings('2.6.0', devices, []), []);
  assert.match(firmwareWarnings('2.3.0', [], [{ type: 'wall_switch', pin: 0, settings: {}, targetId: 'x' }])[0], /2\.4\.0/);
  const at = new Date('2026-10-18T20:30:00Z');                     // already the 19th in Karachi
  assert.equal(replacedNote('esp-9f02', at, 'Asia/Karachi'), 'Replaced by esp-9f02 on 19 Oct 2026');
  assert.equal(replacedNote('esp-9f02', at, 'UTC', 'Relay stuck'), 'Replaced by esp-9f02 on 18 Oct 2026. Relay stuck');
});
