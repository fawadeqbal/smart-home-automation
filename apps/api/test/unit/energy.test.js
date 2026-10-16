// Unit tests on the built code (pnpm build first). No database or broker needed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { guessWatts, onIntervals, withoutCuts, hoursByDay } = require('../../dist/energy/energy.service.js');

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 14, 19); // midnight in Pakistan (UTC+5)

test('what a device probably draws, from its name', () => {
  assert.equal(guessWatts('Geyser'), 2000);
  assert.equal(guessWatts('Bedroom AC'), 1500);
  assert.equal(guessWatts('Ceiling fan'), 75);
  assert.equal(guessWatts('Socket', ['pankha']), 75);
  assert.equal(guessWatts('Porch light'), 15);
  assert.equal(guessWatts('Water motor'), 750);
  assert.equal(guessWatts('Socket 2'), null);
});

test('on-time comes from the history, including a device that was already on', () => {
  const ev = (h, on) => ({ at: new Date(T0 + h * H), on });
  assert.deepEqual(onIntervals([ev(1, true), ev(3, false)], false, T0, T0 + 10 * H), [{ start: T0 + H, end: T0 + 3 * H }]);
  // on from before the window, off at 2 h, on again at 8 h and still on
  assert.deepEqual(onIntervals([ev(2, false), ev(8, true)], true, T0, T0 + 10 * H), [{ start: T0, end: T0 + 2 * H }, { start: T0 + 8 * H, end: T0 + 10 * H }]);
  // repeated "on" reports don't double count
  assert.deepEqual(onIntervals([ev(1, true), ev(2, true), ev(4, false)], false, T0, T0 + 10 * H), [{ start: T0 + H, end: T0 + 4 * H }]);
});

test('power cuts are taken out, and hours are counted per local day', () => {
  const on = [{ start: T0 + 20 * H, end: T0 + 30 * H }];   // 8 pm to 6 am the next day
  const cut = [{ start: T0 + 22 * H, end: T0 + 23 * H }];   // an hour of load-shedding
  const left = withoutCuts(on, cut);
  assert.deepEqual(left, [{ start: T0 + 20 * H, end: T0 + 22 * H }, { start: T0 + 23 * H, end: T0 + 30 * H }]);
  const days = hoursByDay(left, 'Asia/Karachi');
  assert.equal(days.get('2026-10-15'), 3);  // 8–10 pm and 11–12 pm
  assert.equal(days.get('2026-10-16'), 6);  // midnight to 6 am
});
