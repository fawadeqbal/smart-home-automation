// Unit tests on the built code (pnpm build first). No database or broker needed.
// Phone numbers for WhatsApp, the installer's driving order, quote totals, contract renewals,
// low-stock warnings, ticket ratings and offline checklist ticks.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalisePhone, displayPhone } = require('../../dist/common/phone.js');
const { orderStops, mapsRoute, directionsTo, km } = require('../../dist/planner/route.js');
const { cleanLines, quoteTotals, quoteRef, acceptedItems } = require('../../dist/quotes/quote-math.js');
const { daysLeft, onRenewalList, renewedEnd, reminderDue } = require('../../dist/billing/renewals.js');
const { stockAlert } = require('../../dist/platform/stock-rule.js');
const { dayOf, isoDay } = require('../../dist/billing/billing.service.js');
const { ratingRefusal } = require('../../dist/tickets/tickets.service.js');
const { mergeItems } = require('../../dist/installation/installation.service.js');

test('phone numbers as people type them become WhatsApp digits (Pakistan by default)', () => {
  assert.equal(normalisePhone('0300-1234567'), '923001234567');
  assert.equal(normalisePhone('0300 1234567'), '923001234567');
  assert.equal(normalisePhone('+92 300 1234567'), '923001234567');
  assert.equal(normalisePhone('0092 300 1234567'), '923001234567');
  assert.equal(normalisePhone('300 1234567'), '923001234567');
  assert.equal(normalisePhone('(042) 3575 1234'), '924235751234'); // a Lahore landline
  assert.equal(normalisePhone('+44 20 7946 0958'), '442079460958');
  assert.equal(normalisePhone('0300-123'), null); // too short
  assert.equal(normalisePhone('call me'), null);
  assert.equal(normalisePhone(''), null);
  assert.equal(normalisePhone(null), null);
  assert.equal(displayPhone('923001234567'), '+92 300 1234567');
  assert.equal(displayPhone('442079460958'), '+442079460958');
});

test('the day: nearest stop next from the base; stops without a location last, by city', () => {
  const base = { lat: 31.5204, lng: 74.3587 }; // Lahore
  const stops = [
    { name: 'Far', city: 'Lahore', lat: 31.40, lng: 74.20 },
    { name: 'No pin, Karachi', city: 'Karachi', lat: null, lng: null },
    { name: 'Near', city: 'Lahore', lat: 31.52, lng: 74.36 },
    { name: 'No pin, Islamabad', city: 'Islamabad', lat: null, lng: null },
    { name: 'Middle', city: 'Lahore', lat: 31.47, lng: 74.30 },
    { name: 'No city', city: '', lat: null, lng: null },
    { name: 'Also Islamabad', city: 'islamabad', lat: null, lng: null },
  ];
  const { ordered, totalKm } = orderStops(base, stops);
  assert.deepEqual(ordered.map((s) => s.name), ['Near', 'Middle', 'Far', 'No pin, Islamabad', 'Also Islamabad', 'No pin, Karachi', 'No city']);
  assert.ok(ordered[0].legKm < 1);
  assert.equal(ordered[3].legKm, null);
  assert.ok(totalKm > 15 && totalKm < 30, `total ${totalKm}`);
  // no base: the first stop with a location starts the day
  assert.deepEqual(orderStops(null, stops).ordered.slice(0, 3).map((s) => s.name), ['Far', 'Middle', 'Near']);
  assert.equal(orderStops(base, []).ordered.length, 0);
  assert.ok(Math.abs(km({ lat: 31.5204, lng: 74.3587 }, { lat: 33.6844, lng: 73.0479 }) - 270) < 10); // Lahore to Islamabad, as the crow flies
});

test('Google Maps links: the whole day with waypoints, and one stop', () => {
  const base = { lat: 31.5, lng: 74.3 };
  const stops = [{ name: 'A', city: 'Lahore', lat: 31.52, lng: 74.36 }, { name: 'B', city: 'Lahore', lat: 31.47, lng: 74.3 }, { name: 'C', city: 'Multan', lat: null, lng: null }];
  const url = new URL(mapsRoute(base, stops));
  assert.equal(url.origin + url.pathname, 'https://www.google.com/maps/dir/');
  assert.equal(url.searchParams.get('api'), '1');
  assert.equal(url.searchParams.get('origin'), '31.500000,74.300000');
  assert.equal(url.searchParams.get('destination'), '31.470000,74.300000');
  assert.equal(url.searchParams.get('waypoints'), '31.520000,74.360000');
  assert.equal(url.searchParams.get('travelmode'), 'driving');
  assert.equal(mapsRoute(base, [stops[2]]), null); // nothing on the map
  assert.equal(new URL(mapsRoute(null, [stops[0]])).searchParams.get('origin'), null); // from wherever the phone is
  assert.equal(new URL(directionsTo(stops[0])).searchParams.get('destination'), '31.520000,74.360000');
  assert.equal(new URL(directionsTo(stops[2])).searchParams.get('destination'), 'Multan');
  assert.equal(directionsTo({ name: 'x', city: '', lat: null, lng: null }), null);
});

test('quote lines are cleaned and totalled; the discount never goes below zero', () => {
  const lines = cleanLines([
    { name: ' Smart switchboard, 4 switches ', unit: 'board', qty: 3, price: 6500 },
    { name: 'Motion sensor', qty: 2.4, price: 2200.6 },
    { name: '', qty: 1, price: 999 },            // empty: dropped
    { name: 'Free survey', qty: 0, price: -5 },   // at least one, never negative
    null,
  ]);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines[0], { priceItemId: null, name: 'Smart switchboard, 4 switches', unit: 'board', qty: 3, price: 6500 });
  assert.deepEqual(lines[1], { priceItemId: null, name: 'Motion sensor', unit: 'each', qty: 2, price: 2201 });
  assert.deepEqual([lines[2].qty, lines[2].price], [1, 0]);
  assert.deepEqual(quoteTotals(lines, 1000), { subtotal: 19500 + 4402, discount: 1000, total: 23902 - 1000 });
  assert.deepEqual(quoteTotals(lines, 999999), { subtotal: 23902, discount: 23902, total: 0 });
  assert.deepEqual(quoteTotals(lines, -50), { subtotal: 23902, discount: 0, total: 23902 });
  assert.deepEqual(quoteTotals([], 0), { subtotal: 0, discount: 0, total: 0 });
  assert.equal(quoteRef(12), 'Q-12');
  assert.deepEqual(cleanLines('nope'), []);
});

test('what to install adds up the same item across accepted quotes', () => {
  const a = acceptedItems([
    { number: 3, decidedAt: null, items: [{ name: 'Motion sensor', unit: 'each', qty: 2, price: 1 }, { name: 'Board', unit: 'board', qty: 1, price: 1 }] },
    { number: 5, decidedAt: null, items: [{ name: 'motion sensor', unit: 'each', qty: 1, price: 1 }] },
  ]);
  assert.deepEqual(a.items, [{ name: 'Motion sensor', unit: 'each', qty: 3 }, { name: 'Board', unit: 'board', qty: 1 }]);
  assert.deepEqual(a.quotes.map((q) => q.ref), ['Q-3', 'Q-5']);
});

test('renewals: days left, which contracts show, the new end date, and when to remind', () => {
  const today = dayOf(2026, 10, 18);
  assert.equal(daysLeft(dayOf(2026, 11, 17), today), 30);
  assert.equal(daysLeft(today, today), 0);
  assert.equal(daysLeft(dayOf(2026, 10, 10), today), -8);
  assert.equal(onRenewalList(dayOf(2026, 12, 17), today), true);   // 60 days
  assert.equal(onRenewalList(dayOf(2026, 12, 18), today), false);  // 61 days
  assert.equal(onRenewalList(dayOf(2026, 9, 1), today), true);     // ended, not renewed
  assert.equal(onRenewalList(null, today), false);                 // no end date: nothing to renew
  // one more term after the current end; a lapsed contract starts again today
  assert.equal(isoDay(renewedEnd(dayOf(2026, 11, 30), today, 3)), '2027-02-28');
  assert.equal(isoDay(renewedEnd(dayOf(2026, 11, 30), today, 12)), '2027-11-30');
  assert.equal(isoDay(renewedEnd(dayOf(2026, 9, 1), today, 6)), '2027-04-18');
  // reminders: 30 days before, then 7; once each; a contract found inside 7 days gets only the 7-day one
  const none = { remind30At: null, remind7At: null };
  assert.equal(reminderDue(31, none), null);
  assert.equal(reminderDue(30, none), 30);
  assert.equal(reminderDue(12, { remind30At: new Date(), remind7At: null }), null);
  assert.equal(reminderDue(7, { remind30At: new Date(), remind7At: null }), 7);
  assert.equal(reminderDue(5, none), 7);
  assert.equal(reminderDue(3, { remind30At: new Date(), remind7At: new Date() }), null);
  assert.equal(reminderDue(-1, none), null);
});

test('low stock: warn once when it drops below the minimum, again only after it went back up', () => {
  assert.equal(stockAlert(2, 0, null), null);          // off
  assert.equal(stockAlert(5, 3, null), null);
  assert.equal(stockAlert(2, 3, null), 'alert');
  assert.equal(stockAlert(1, 3, new Date()), null);    // already warned
  assert.equal(stockAlert(3, 3, new Date()), 'reset'); // back up: arm it again
  assert.equal(stockAlert(2, 0, new Date()), 'reset'); // turned off
});

test('ticket ratings: only the person who asked, only when solved, changeable for 7 days', () => {
  const now = new Date('2026-10-18T12:00:00Z');
  const t = (status, ratedAt = null) => ({ openedById: 'u1', status, ratedAt });
  assert.equal(ratingRefusal(t('RESOLVED'), 'u1', now), null);
  assert.equal(ratingRefusal(t('CLOSED'), 'u1', now), null);
  assert.match(ratingRefusal(t('RESOLVED'), 'u2', now), /Only the person/);
  assert.match(ratingRefusal(t('IN_PROGRESS'), 'u1', now), /once it is solved/);
  assert.equal(ratingRefusal(t('RESOLVED', new Date('2026-10-12T12:00:00Z')), 'u1', now), null); // 6 days later: may change
  assert.match(ratingRefusal(t('RESOLVED', new Date('2026-10-10T12:00:00Z')), 'u1', now), /7 days/);
});

test('offline checklist ticks: the newest change of each item wins', () => {
  const now = new Date('2026-10-18T12:00:00Z');
  const items = [
    { key: 'mains', label: 'Mains off', done: false },
    { key: 'wiring', label: 'Wiring', done: true, at: '2026-10-18T11:00:00.000Z' },
    { key: 'clean', label: 'Clean', done: false },
  ];
  const out = mergeItems(items, [
    { key: 'mains', done: true, at: '2026-10-18T10:00:00.000Z' },          // first change: taken
    { key: 'wiring', done: false, at: '2026-10-18T10:30:00.000Z' },        // older than the server's: ignored
    { key: 'clean', done: true, note: 'swept', at: '2099-01-01T00:00:00.000Z' }, // a wrong clock counts as now
    { key: 'unknown', done: true },
  ], now);
  assert.deepEqual(out.map((i) => i.done), [true, true, true]);
  assert.equal(out[0].at, '2026-10-18T10:00:00.000Z');
  assert.equal(out[1].at, '2026-10-18T11:00:00.000Z');
  assert.equal(out[2].at, now.toISOString());
  assert.equal(out[2].note, 'swept');
  // a later change from another phone replaces it
  assert.equal(mergeItems(out, [{ key: 'clean', done: false, at: '2026-10-18T11:59:00.000Z' }], now)[2].done, true);
  assert.equal(mergeItems(out, [{ key: 'clean', done: false }], new Date('2026-10-18T12:05:00Z'))[2].done, false);
});
