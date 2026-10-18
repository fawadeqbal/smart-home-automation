// Unit tests on the built code (pnpm build first). No database or broker needed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decideTank } = require('../../dist/hardware/tank.service.js');
const { boardSettings } = require('../../dist/hardware/nodes.service.js');

const MIN = 60_000;
const T = 1_800_000_000_000;
const base = {
  settings: { motorDeviceId: 'm', fillBelowPct: 30, stopAtPct: 95, dryRunMin: 10, maxRunMin: 60 },
  level: 50, alarm: '', motorOn: false, boardWatches: false, run: null, blocked: false, now: T, lastStart: 0,
};

test('the motor starts when the tank is low, unless something is wrong', () => {
  assert.equal(decideTank({ ...base, level: 29 }).action, 'start');
  assert.equal(decideTank({ ...base, level: 30 }).action, 'none');
  assert.equal(decideTank({ ...base, level: 29, settings: { ...base.settings, fillBelowPct: 0 } }).action, 'none');   // off by default
  assert.equal(decideTank({ ...base, level: 29, alarm: 'dry' }).action, 'none');     // the board stopped it: wait for a person
  assert.equal(decideTank({ ...base, level: 29, blocked: true }).action, 'none');    // the server stopped it
  assert.equal(decideTank({ ...base, level: 29, lastStart: T - 5 * MIN }).action, 'none');   // not again so soon
  assert.equal(decideTank({ ...base, level: null }).action, 'none');                 // no reading: don't guess
});

test('a motor on another board is stopped by the server: full, dry, too long, no readings', () => {
  const running = { ...base, motorOn: true, run: { since: T - 3 * MIN, startLevel: 40 } };
  assert.deepEqual(decideTank({ ...running, level: 95 }), { action: 'stop', alarm: '', why: 'the tank is full' });
  assert.equal(decideTank({ ...running, level: 41 }).action, 'none');               // early days
  const later = { ...running, run: { since: T - 11 * MIN, startLevel: 40 } };
  assert.equal(decideTank({ ...later, level: 41 }).alarm, 'dry');
  assert.equal(decideTank({ ...later, level: 55 }).action, 'none');                 // rising: fine
  assert.equal(decideTank({ ...later, level: null }).alarm, 'sensor');
  assert.equal(decideTank({ ...running, run: { since: T - 61 * MIN, startLevel: 10 }, level: 80 }).alarm, 'long');
  // the motor is on the tank's own board: the board does all of this by itself
  assert.equal(decideTank({ ...later, level: 41, boardWatches: true }).action, 'none');
});

test("a tank's settings as its board gets them", () => {
  const keyOf = new Map([['m1', 'motor'], ['t1', 'roof_tank']]);
  const same = boardSettings({ type: 'tank', settings: { echoPin: 12, motorDeviceId: 'm1', fillBelowPct: 30, stopAtPct: 90 } }, keyOf);
  assert.deepEqual(same, { echoPin: 12, stopAtPct: 90, motorKey: 'motor' });
  const other = boardSettings({ type: 'tank', settings: { echoPin: 12, motorDeviceId: 'elsewhere', motorKey: 'stale' } }, keyOf);
  assert.deepEqual(other, { echoPin: 12 });
  assert.deepEqual(boardSettings({ type: 'fan', settings: { pins: [4, 14] } }, keyOf), { pins: [4, 14] });
});
