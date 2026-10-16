// Unit tests on the built code (pnpm build first). No database or broker needed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fires, withinWindow, describeRule, eventsFor } = require('../../dist/automation/rules.service.js');
const { sunOn, nextSun, cityCoords } = require('../../dist/automation/sun.js');

test('which events each kind of device can start a rule with', () => {
  assert.deepEqual(eventsFor('switch'), ['on', 'off']);
  assert.deepEqual(eventsFor('contact'), ['opens', 'closes']);
  assert.deepEqual(eventsFor('dht'), ['above', 'below']);
  assert.deepEqual(eventsFor('nope'), []);
});

test('a rule fires on the change, not on every reading', () => {
  const door = { deviceId: 'd', event: 'opens' };
  assert.equal(fires(door, { active: false }, { active: true }), true);
  assert.equal(fires(door, { active: true }, { active: true }), false);
  assert.equal(fires(door, null, { active: true }), true);
  assert.equal(fires({ deviceId: 'd', event: 'closes' }, { active: true }, { active: false }), true);
  assert.equal(fires({ deviceId: 'd', event: 'off' }, null, { on: false }), false); // nothing to turn off from

  const hot = { deviceId: 't', event: 'above', value: 35, field: 'temperature' };
  assert.equal(fires(hot, { temperature: 34 }, { temperature: 36 }), true);
  assert.equal(fires(hot, { temperature: 36 }, { temperature: 37 }), false); // still above: once is enough
  assert.equal(fires(hot, { temperature: 36 }, { temperature: 30 }), false);
  const dry = { deviceId: 'w', event: 'below', value: 20, field: 'level' };
  assert.equal(fires(dry, { level: 25 }, { level: 18 }), true);
});

test('time windows are in the home\'s time zone and may cross midnight', () => {
  const tz = 'Asia/Karachi'; // UTC+5
  const at = (h, m = 0) => new Date(Date.UTC(2026, 9, 14, h - 5, m)); // a Wednesday, local time h:m
  const night = { from: '22:00', to: '06:00' };
  assert.equal(withinWindow(night, tz, at(23)), true);
  assert.equal(withinWindow(night, tz, at(5, 59)), true);
  assert.equal(withinWindow(night, tz, at(6)), false);
  assert.equal(withinWindow(night, tz, at(12)), false);
  assert.equal(withinWindow({ from: '09:00', to: '17:00' }, tz, at(12)), true);
  assert.equal(withinWindow({ days: [3] }, tz, at(12)), true);  // Wednesday
  assert.equal(withinWindow({ days: [0, 6] }, tz, at(12)), false);
  assert.equal(withinWindow({}, tz, at(3)), true);
});

test('rules describe themselves in plain words', () => {
  const names = new Map([['door', 'Main door'], ['hall', 'Hall light'], ['t', 'Bedroom AC sensor']]);
  const scenes = new Map([['s', 'Good night']]);
  assert.equal(describeRule({ deviceId: 'door', event: 'opens' }, { from: '22:00', to: '06:00' },
    [{ type: 'device', deviceId: 'hall', on: true, forMinutes: 5 }, { type: 'notify', to: 'me' }], names, scenes),
  'When Main door opens between 22:00 and 06:00: Hall light on for 5 min, tell me');
  assert.equal(describeRule({ deviceId: 't', event: 'above', value: 30, field: 'temperature' }, { away: true },
    [{ type: 'scene', sceneId: 's' }, { type: 'notify', to: 'admins' }], names, scenes),
  'When Bedroom AC sensor goes above 30°C while away: run Good night, tell admins');
});

test('sunrise and sunset', () => {
  const [lat, lon] = cityCoords('Karachi, Sindh, PK');
  const rise = sunOn('Asia/Karachi', 2026, 6, 21, 'SUNRISE', 0, lat, lon);
  const set = sunOn('Asia/Karachi', 2026, 6, 21, 'SUNSET', -15, lat, lon);
  const local = (d) => new Date(d.getTime() + 5 * 3600_000).toISOString().slice(11, 16);
  assert.ok(['05:42', '05:43', '05:44'].includes(local(rise)), local(rise));
  assert.ok(['19:08', '19:09', '19:10'].includes(local(set)), local(set));
  // the next sunset on weekends only, after a Wednesday noon, is on Saturday
  const next = nextSun('SUNSET', 0, [6], 'Asia/Karachi', lat, lon, new Date(Date.UTC(2026, 9, 14, 7)));
  assert.equal(new Date(next.getTime() + 5 * 3600_000).getUTCDay(), 6);
  assert.equal(cityCoords('Nowhere'), null);
});
