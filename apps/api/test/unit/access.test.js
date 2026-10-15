// Unit tests on the built code (pnpm build first). No database or broker needed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AccessService, RANK } = require('../../dist/access/access.service.js');
const { slugKey } = require('../../dist/common/zod.js');

test('device keys are safe slugs', () => {
  assert.equal(slugKey('Living Room Bulb!'), 'living_room_bulb');
  assert.equal(slugKey('  '), 'device');
  assert.equal(slugKey('Pankha (fan)'), 'pankha_fan');
});

test('room levels: admins everything, others only listed rooms, no room = admins only', () => {
  const access = new AccessService(null);
  assert.equal(access.levelFor('all', null), 'MANAGE');
  const levels = new Map([['r1', 'CONTROL']]);
  assert.equal(access.levelFor(levels, 'r1'), 'CONTROL');
  assert.equal(access.levelFor(levels, 'r2'), null);
  assert.equal(access.levelFor(levels, null), null);
  assert.ok(RANK.VIEW < RANK.CONTROL && RANK.CONTROL < RANK.MANAGE);
});

test('guests are never given manage rights', async () => {
  const prisma = { roomAccess: { findMany: async () => [{ roomId: 'r1', access: 'MANAGE' }] } };
  const levels = await new AccessService(prisma).roomLevels({ id: 'u', role: 'GUEST' });
  assert.equal(levels.get('r1'), 'CONTROL');
});
