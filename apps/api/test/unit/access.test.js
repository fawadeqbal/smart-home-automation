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

test('help articles: front matter, tags, policies start as drafts', () => {
  const { parseArticle } = require('../../dist/help/help.service.js');
  const a = parseArticle('---\ntitle: "Board offline"\ncategory: troubleshooting\naudience: everyone\ntags: [wifi nahi, "power"]\n---\n\nCheck the power.\n');
  assert.deepEqual(a, { title: 'Board offline', category: 'TROUBLESHOOTING', audience: 'EVERYONE', tags: ['wifi nahi', 'power'], body: 'Check the power.', published: true });
  assert.equal(parseArticle('---\ntitle: Warranty\ncategory: policy\n---\nx').published, false);
  assert.equal(parseArticle('---\ntitle: Warranty\ncategory: policy\npublished: true\n---\nx').published, true);
  assert.equal(parseArticle('---\ntitle: Adopt\ncategory: process\naudience: staff\n---\nx').audience, 'STAFF');
  assert.equal(parseArticle('no front matter'), null);
  assert.equal(parseArticle('---\ntitle: X\ncategory: nonsense\n---\nx'), null);
});
