// Unit tests on the built code (pnpm build first). No database or broker needed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { kindFromReset, duration, mergePower, summarize, areaCuts, when } = require('../../dist/monitoring/outages.service.js');

test('why a board started again, from its own words', () => {
  assert.equal(kindFromReset('Power On'), 'POWER');
  assert.equal(kindFromReset(undefined), 'POWER');            // older firmware: a fresh start is most likely power
  assert.equal(kindFromReset('External System'), 'RESET');
  assert.equal(kindFromReset('Software/System restart'), 'RESTART');
  assert.equal(kindFromReset('Hardware Watchdog'), 'CRASH');
  assert.equal(kindFromReset('Exception'), 'CRASH');
  assert.equal(kindFromReset('Something else'), 'UNKNOWN');
});

test('durations people can read', () => {
  assert.equal(duration(12), '12 s');
  assert.equal(duration(55 * 60), '55 min');
  assert.equal(duration(2 * 3600), '2 h');
  assert.equal(duration(2 * 3600 + 10 * 60), '2 h 10 min');
});

const at = (min) => new Date(Date.UTC(2026, 9, 15, 10, 0) + min * 60000);
const row = (kind, from, to, place = null, home = 'A') => ({ id: `${kind}${from}`, kind, startedAt: at(from), endedAt: at(to), seconds: (to - from) * 60, reset: null, place, node: { name: 'b', home: { id: home, name: home } } });

test('one cut seen by two boards of a home counts once', () => {
  const merged = mergePower([row('POWER', 0, 30), row('POWER', 1, 31), row('POWER', 120, 140), row('NETWORK', 50, 60)]);
  const power = merged.filter((r) => r.kind === 'POWER');
  assert.equal(power.length, 2);
  assert.equal(power[0].seconds, 31 * 60);
  const s = summarize(merged);
  assert.equal(s.powerCuts, 2);
  assert.equal(s.powerSeconds, 31 * 60 + 20 * 60);
  assert.equal(s.networkOuts, 1);
  assert.equal(s.lastPower.startedAt.getTime(), at(120).getTime());
});

test('two homes in one place cut together: an area cut (load-shedding)', () => {
  const areas = areaCuts([row('POWER', 0, 60, 'Swabi, KP, PK', 'Khan'), row('POWER', 5, 62, 'Swabi, KP, PK', 'Iqbal'),
    row('POWER', 0, 60, 'Lahore, Punjab, PK', 'Ali'), row('POWER', 300, 320, 'Swabi, KP, PK', 'Khan')]);
  assert.equal(areas.length, 1);
  assert.equal(areas[0].place, 'Swabi, KP, PK');
  assert.deepEqual(areas[0].homes.sort(), ['Iqbal', 'Khan']);
  assert.equal(areas[0].seconds, 62 * 60);
});

test('times in the home time zone, with the day when not today', () => {
  const now = new Date(Date.UTC(2026, 9, 15, 12, 0));               // 5 pm in Karachi
  assert.equal(when(new Date(Date.UTC(2026, 9, 15, 10, 10)), 'Asia/Karachi', now), '3:10 pm');
  assert.equal(when(new Date(Date.UTC(2026, 9, 14, 10, 10)), 'Asia/Karachi', now), 'yesterday 3:10 pm');
  assert.equal(when(new Date(Date.UTC(2026, 9, 12, 3, 0)), 'Asia/Karachi', now), 'Mon 12 Oct 8:00 am');
});
