// Unit tests on the built code (pnpm build first). No database or broker needed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planWaves, daytime } = require('../../dist/firmware/rollout.service.js');

test('the first wave is one board: online, with the strongest signal; the rest go a few at a time, home by home', () => {
  const nodes = [
    { id: 'a', online: true, rssi: -70, homeId: 'h2' },
    { id: 'b', online: false, rssi: -40, homeId: 'h1' },
    { id: 'c', online: true, rssi: -55, homeId: 'h1' },
    { id: 'd', online: true, rssi: -60, homeId: 'h2' },
    { id: 'e', online: true, rssi: null, homeId: 'h1' },
  ];
  const plan = planWaves(nodes, 2);
  assert.deepEqual(plan.map((n) => [n.id, n.wave]), [['c', 0], ['e', 1], ['b', 1], ['d', 2], ['a', 2]]);
  assert.deepEqual(planWaves([], 3), []);
});

test('updates go out in the daytime at the home', () => {
  const at = (h) => new Date(Date.UTC(2026, 9, 14, h - 5)); // Pakistan time h:00
  assert.equal(daytime('Asia/Karachi', at(9)), false);
  assert.equal(daytime('Asia/Karachi', at(10)), true);
  assert.equal(daytime('Asia/Karachi', at(16)), true);
  assert.equal(daytime('Asia/Karachi', at(17)), false);
});
