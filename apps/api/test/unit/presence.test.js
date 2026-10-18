// "Who's home" and "the last one out": when someone counts as out, and when the rule fires.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { personState, decide, isLightOrFan, homeLine, STALE_MS, UNKNOWN_GRACE_MS } = require('../../dist/automation/presence.js');

const NOW = new Date('2026-10-18T12:00:00Z');
const ago = (min) => new Date(NOW.getTime() - min * 60_000);
const SETTLE = 2 * 60_000;
const row = (r) => ({ atHome: null, reportedAt: null, since: null, sharedAt: ago(600), ...r });
const state = (r) => personState(row(r), NOW, SETTLE);

test('a fresh "home" report is home', () => {
  assert.deepEqual(state({ atHome: true, reportedAt: ago(1), since: ago(100) }), { status: 'home', out: false, outSince: null });
});

test('"away" counts once it has held for a couple of minutes (one missed board answer isn\'t leaving)', () => {
  assert.equal(state({ atHome: false, reportedAt: ago(0), since: ago(1) }).out, false);
  const away = state({ atHome: false, reportedAt: ago(0), since: ago(3) });
  assert.equal(away.status, 'away');
  assert.equal(away.out, true);
});

test('unknown (no report, or older than 3 hours) counts as out only after 20 minutes', () => {
  // started sharing 10 minutes ago and never reported: not yet
  assert.equal(state({ sharedAt: ago(10) }).out, false);
  assert.equal(state({ sharedAt: ago(25) }).out, true);
  // last said "home" 3 h 10 min ago: unknown for 10 minutes only
  const stale = state({ atHome: true, reportedAt: ago(190), since: ago(400) });
  assert.equal(stale.status, 'unknown');
  assert.equal(stale.out, false);
  assert.equal(state({ atHome: true, reportedAt: ago(201), since: ago(400) }).out, true);
  // last said "away" long ago: out
  assert.equal(state({ atHome: false, reportedAt: ago(200), since: ago(200) }).out, true);
  assert.equal(STALE_MS, 3 * 3600_000);
  assert.equal(UNKNOWN_GRACE_MS, 20 * 60_000);
});

test('the rule fires "left" once everyone sharing is out, "arrived" when someone is back', () => {
  const home = { status: 'home', out: false };
  const leaving = { status: 'away', out: false };
  const out = { status: 'away', out: true };
  const unknownOut = { status: 'unknown', out: true };
  assert.equal(decide(false, []), null); // nobody shares: nothing to decide
  assert.equal(decide(false, [home, out]), null);
  assert.equal(decide(false, [leaving, out]), null); // one just walked out: wait
  assert.equal(decide(false, [out, unknownOut]), 'left');
  assert.equal(decide(true, [out, unknownOut]), null); // already done: not again
  assert.equal(decide(true, [out, { status: 'unknown', out: false }]), null); // unknown isn't coming home
  assert.equal(decide(true, [out, home]), 'arrived');
  assert.equal(decide(false, [home]), null);
});

test('"lights and fans": fans by type, switches by name; never the fridge or the router', () => {
  assert.equal(isLightOrFan({ type: 'fan', name: 'Ceiling' }), true);
  assert.equal(isLightOrFan({ type: 'switch', name: 'Bedroom light' }), true);
  assert.equal(isLightOrFan({ type: 'switch', name: 'Lounge', aliases: ['batti'] }), true);
  assert.equal(isLightOrFan({ type: 'switch', name: 'Exhaust fan' }), true);
  assert.equal(isLightOrFan({ type: 'switch', name: 'Fridge light socket' }), false);
  assert.equal(isLightOrFan({ type: 'switch', name: 'WiFi router' }), false);
  assert.equal(isLightOrFan({ type: 'switch', name: 'Geyser' }), false);
  assert.equal(isLightOrFan({ type: 'dht', name: 'Light sensor' }), false);
});

test('who\'s home, in words', () => {
  assert.equal(homeLine([]), 'Nobody shares when they’re home yet.');
  assert.equal(homeLine([{ name: 'Ali Khan', status: 'away' }]), 'Nobody is home.');
  assert.equal(homeLine([{ name: 'Ali Khan', status: 'home' }, { name: 'Sara', status: 'unknown' }]), 'Ali is home.');
  assert.equal(homeLine([{ name: 'Ali', status: 'home' }, { name: 'Sara', status: 'home' }, { name: 'Zoya', status: 'home' }]), 'Ali, Sara and Zoya are home.');
});
