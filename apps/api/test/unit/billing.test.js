// Unit tests on the built code (pnpm build first). No database or broker needed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { addMonths, periodText, monthly, dayOf, isoDay, todayIn } = require('../../dist/billing/billing.service.js');

test('a month later stays inside the month', () => {
  assert.equal(isoDay(addMonths(dayOf(2026, 1, 31), 1)), '2026-02-28');
  assert.equal(isoDay(addMonths(dayOf(2028, 1, 31), 1)), '2028-02-29');
  assert.equal(isoDay(addMonths(dayOf(2026, 11, 15), 3)), '2027-02-15');
  assert.equal(isoDay(addMonths(dayOf(2026, 10, 1), 12)), '2027-10-01');
});

test('what an invoice is for, and what a plan is worth a month', () => {
  assert.equal(periodText('Care plan', dayOf(2026, 10, 1), 'MONTHLY'), 'Care plan, 1 Oct – 31 Oct 2026');
  assert.equal(periodText('Annual care', dayOf(2026, 10, 1), 'YEARLY'), 'Annual care, 1 Oct 2026 – 30 Sept 2027');
  assert.equal(monthly({ amount: 6000, period: 'QUARTERLY' }), 2000);
  assert.equal(monthly({ amount: 24000, period: 'YEARLY' }), 2000);
});

test('today is the home’s day, not the server’s', () => {
  // 21:30 UTC on 16 Oct is already 17 Oct in Pakistan
  assert.equal(isoDay(todayIn('Asia/Karachi', new Date(Date.UTC(2026, 9, 16, 21, 30)))), '2026-10-17');
});
