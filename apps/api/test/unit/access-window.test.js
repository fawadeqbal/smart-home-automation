// Time-limited access: hours (also across midnight), days, an end, time zones; and how it's said.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  checkAccess, insideHours, accessEndsAt, readLimits, blockedMessage, limitsSummary, daysText, hasLimits,
} = require('../../dist/access/access-window.js');

const KHI = 'Asia/Karachi'; // UTC+5, no daylight saving
const at = (iso) => new Date(iso);
const limits = (l) => ({ accessUntil: null, accessFrom: null, accessTo: null, accessDays: [], ...l });

test('no limits: always in, nothing to end', () => {
  const r = checkAccess(limits({}), KHI, at('2026-10-18T03:00:00Z'));
  assert.deepEqual(r, { ok: true, limited: false, endsAt: null });
  assert.equal(hasLimits(limits({})), false);
});

test('the maid: 9:00 to 17:00 Monday to Saturday, in the home\'s time zone', () => {
  const maid = limits({ accessFrom: '09:00', accessTo: '17:00', accessDays: [1, 2, 3, 4, 5, 6] });
  // Monday 19 Oct 2026, 08:59 in Karachi = 03:59 UTC
  assert.equal(checkAccess(maid, KHI, at('2026-10-19T03:59:00Z')).ok, false);
  assert.equal(checkAccess(maid, KHI, at('2026-10-19T03:59:00Z')).reason, 'hours');
  const in9 = checkAccess(maid, KHI, at('2026-10-19T04:00:00Z'));
  assert.equal(in9.ok, true);
  assert.equal(in9.endsAt.toISOString(), '2026-10-19T12:00:00.000Z'); // 17:00 Karachi
  assert.equal(checkAccess(maid, KHI, at('2026-10-19T11:59:59Z')).ok, true);
  assert.equal(checkAccess(maid, KHI, at('2026-10-19T12:00:00Z')).ok, false); // 17:00 sharp: out
  // Sunday 18 Oct at noon: not a working day
  assert.equal(checkAccess(maid, KHI, at('2026-10-18T07:00:00Z')).ok, false);
  // the same instant is 10:00 in Karachi but 06:00 in London: the home's zone decides
  assert.equal(insideHours(maid, KHI, at('2026-10-19T05:00:00Z')), true);
  assert.equal(insideHours(maid, 'Europe/London', at('2026-10-19T05:00:00Z')), false);
});

test('the night guard: 22:00 to 06:00 crosses midnight and belongs to the day it starts', () => {
  const guard = limits({ accessFrom: '22:00', accessTo: '06:00', accessDays: [5] }); // Friday nights
  // Friday 23 Oct 23:30 Karachi = 18:30 UTC: in
  const fri = checkAccess(guard, KHI, at('2026-10-23T18:30:00Z'));
  assert.equal(fri.ok, true);
  assert.equal(fri.endsAt.toISOString(), '2026-10-24T01:00:00.000Z'); // Saturday 06:00 Karachi
  // Saturday 03:00 Karachi (still Friday's night): in
  assert.equal(checkAccess(guard, KHI, at('2026-10-23T22:00:00Z')).ok, true);
  // Saturday 06:00: out; Saturday 23:00: out (not a Friday)
  assert.equal(checkAccess(guard, KHI, at('2026-10-24T01:00:00Z')).ok, false);
  assert.equal(checkAccess(guard, KHI, at('2026-10-24T18:00:00Z')).ok, false);
  // Friday 05:00 Karachi belongs to Thursday's night: out
  assert.equal(checkAccess(guard, KHI, at('2026-10-23T00:00:00Z')).ok, false);
  // every night when no days are set
  const nightly = limits({ accessFrom: '22:00', accessTo: '06:00' });
  assert.equal(insideHours(nightly, KHI, at('2026-10-20T20:00:00Z')), true); // 01:00
  assert.equal(insideHours(nightly, KHI, at('2026-10-20T10:00:00Z')), false); // 15:00
});

test('a weekend guest: an end time, exact to the second', () => {
  const guest = limits({ accessUntil: at('2026-10-25T12:00:00Z') });
  const before = checkAccess(guest, KHI, at('2026-10-25T11:59:59Z'));
  assert.equal(before.ok, true);
  assert.equal(before.endsAt.toISOString(), '2026-10-25T12:00:00.000Z');
  assert.deepEqual(checkAccess(guest, KHI, at('2026-10-25T12:00:00Z')), { ok: false, reason: 'expired' });
  // hours and an end together: the sooner one ends the pass
  const both = limits({ accessUntil: at('2026-10-19T08:00:00Z'), accessFrom: '09:00', accessTo: '17:00' });
  assert.equal(checkAccess(both, KHI, at('2026-10-19T05:00:00Z')).endsAt.toISOString(), '2026-10-19T08:00:00.000Z');
  // an end beats the hours once it's passed
  assert.equal(checkAccess(both, KHI, at('2026-10-20T05:00:00Z')).reason, 'expired');
});

test('days only (no hours): whole days, and the pass runs to midnight before the next day off', () => {
  const weekend = limits({ accessDays: [6, 0] });
  assert.equal(insideHours(weekend, KHI, at('2026-10-24T10:00:00Z')), true); // Saturday
  assert.equal(insideHours(weekend, KHI, at('2026-10-26T10:00:00Z')), false); // Monday
  const end = accessEndsAt(weekend, KHI, at('2026-10-24T10:00:00Z'));
  assert.equal(end.toISOString(), '2026-10-25T19:00:00.000Z'); // Monday 00:00 Karachi
});

test('a zone with daylight saving: the window follows the local clock', () => {
  const nine = limits({ accessFrom: '09:00', accessTo: '17:00' });
  // London is UTC+1 in summer, UTC+0 after 25 Oct 2026
  assert.equal(insideHours(nine, 'Europe/London', at('2026-07-01T08:00:00Z')), true);  // 09:00 BST
  assert.equal(insideHours(nine, 'Europe/London', at('2026-12-01T08:00:00Z')), false); // 08:00 GMT
});

test('what people type is checked; a time without a zone is the home\'s time', () => {
  const now = at('2026-10-18T06:00:00Z');
  const l = readLimits({ accessUntil: '2026-10-20T17:00', accessFrom: '9:00', accessTo: '17:00', accessDays: [1, 2, 2, 9] }, KHI, undefined, now);
  assert.equal(l.accessUntil.toISOString(), '2026-10-20T12:00:00.000Z');
  assert.equal(l.accessFrom, '09:00');
  assert.deepEqual(l.accessDays, [1, 2]);
  assert.throws(() => readLimits({ accessUntil: '2026-10-17T10:00' }, KHI, undefined, now), /already passed/);
  assert.throws(() => readLimits({ accessFrom: '9:00' }, KHI, undefined, now), /start and an end/);
  assert.throws(() => readLimits({ accessUntil: 'soon' }, KHI, undefined, now), /Say when/);
  // all seven days is the same as every day; null clears
  assert.deepEqual(readLimits({ accessDays: [0, 1, 2, 3, 4, 5, 6] }, KHI, undefined, now).accessDays, []);
  assert.equal(readLimits({ accessUntil: null }, KHI, l, now).accessUntil, null);
  assert.equal(readLimits({ accessFrom: null, accessTo: null }, KHI, l, now).accessFrom, null);
});

test('in words', () => {
  const maid = limits({ accessFrom: '09:00', accessTo: '17:00', accessDays: [1, 2, 3, 4, 5, 6] });
  assert.equal(blockedMessage('Fawad Home', maid, 'hours', KHI), 'Your access to Fawad Home is from 9:00 to 17:00, Monday to Saturday.');
  assert.equal(blockedMessage('Fawad Home', limits({ accessFrom: '09:00', accessTo: '17:00' }), 'hours', KHI), 'Your access to Fawad Home is from 9:00 to 17:00.');
  assert.match(blockedMessage('Fawad Home', limits({ accessUntil: at('2026-10-25T12:00:00Z') }), 'expired', KHI), /ended on Sun 25 Oct, 17:00/);
  assert.equal(limitsSummary(maid, KHI), '9:00–17:00 Mon–Sat');
  assert.equal(daysText([6, 0]), 'Saturday and Sunday');
  assert.equal(daysText([1, 3, 5]), 'Monday, Wednesday and Friday');
  assert.equal(limitsSummary(limits({ accessUntil: at('2026-10-25T12:00:00Z') }), KHI), 'until Sun 25 Oct, 17:00');
});
