// Unit tests on the built code (pnpm build first). No database or broker needed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findPattern, nextCut, cutText, cleanSchedule, daysNeeded, windowText } = require('../../dist/power/shedding.js');
const { cycleFor, previousCycle, cycleUsage, project, billFor, cleanSlabs, checkReading, warningsDue, meterAt, unitsBetween } = require('../../dist/power/bill.js');
const { gridStep, loadsToCut, loadsToRestore, isHeavy, isMainsSensor } = require('../../dist/power/grid.js');
const { kwhBetween } = require('../../dist/energy/energy.service.js');
const { eventsFor, fires, describeRule } = require('../../dist/automation/rules.service.js');

const MIN = 60_000;
const DAY = 86_400_000;
const KHI = 'Asia/Karachi';            // UTC+5, no daylight saving
// local Karachi time on a day `d` days before 18 Oct 2026
const khi = (d, h, m = 0) => Date.UTC(2026, 9, 18 - d, h - 5, m);
const NOW = new Date(khi(0, 11, 0));    // 11:00 am on 18 Oct in Karachi

// ------------------------------------------------------------------ load-shedding pattern
test('a cut at about the same time on most days becomes the pattern', () => {
  const cuts = [];
  // 2–3 pm on 9 of the last 14 days, a few minutes off each time
  for (const d of [1, 2, 3, 5, 6, 8, 9, 11, 12]) cuts.push({ start: khi(d, 14, d % 3), end: khi(d, 15, 2) });
  // a one-off evening cut
  cuts.push({ start: khi(4, 19, 10), end: khi(4, 20, 0) });
  const p = findPattern(cuts, KHI, NOW);
  assert.equal(p.windows.length, 1);
  assert.equal(p.windows[0].from, '14:00');
  assert.equal(p.windows[0].to, '15:00');
  assert.equal(p.windows[0].seen, 9);
  assert.equal(p.windows[0].of, 14);
  assert.equal(windowText(p.windows[0]), '14:00–15:00 every day (seen on 9 of the last 14 days)');
  // the next one is today at 2 pm
  const next = nextCut(p.windows, KHI, NOW);
  assert.equal(next.at.getTime(), khi(0, 14));
  assert.equal(cutText(next, KHI, NOW), 'today around 2:00 pm');
});

test('fewer than 5 days of 14 is not a pattern; a short flicker does not count', () => {
  const cuts = [1, 2, 3, 4].map((d) => ({ start: khi(d, 9), end: khi(d, 10) }));
  cuts.push({ start: khi(5, 9, 0), end: khi(5, 9, 5) });   // 5 minutes: not enough of the slot
  assert.deepEqual(findPattern(cuts, KHI, NOW).windows, []);
  cuts.push({ start: khi(6, 9), end: khi(6, 10) });
  assert.equal(findPattern(cuts, KHI, NOW).windows[0].from, '09:00');
});

test('neighbouring slots merge, and a window over midnight stays one window', () => {
  const cuts = [];
  // 11 pm to 1 am on 6 nights; the morning after belongs to the same night
  for (const d of [1, 2, 3, 4, 5, 6]) cuts.push({ start: khi(d, 23), end: khi(d - 1, 1) });
  const p = findPattern(cuts, KHI, NOW);
  assert.equal(p.windows.length, 1);
  assert.equal(p.windows[0].from, '23:00');
  assert.equal(p.windows[0].to, '01:00');
  assert.equal(p.windows[0].seen, 6);
  // at 11:30 pm the cut is going on now, until 1 am
  const late = new Date(khi(0, 23, 30));
  const n = nextCut(p.windows, KHI, late);
  assert.equal(n.now, true);
  assert.equal(n.until.getTime(), khi(-1, 1));
  assert.equal(cutText(n, KHI, late), 'now, until about 1:00 am');
  // in the morning it's tonight's
  assert.equal(cutText(nextCut(p.windows, KHI, NOW), KHI, NOW), 'today around 11:00 pm');
});

test('the pattern is read in the home\'s own time zone', () => {
  // the same instants are 2 pm in Karachi but 10 am in London (UTC+1 in October)
  const cuts = [1, 2, 3, 4, 5].map((d) => ({ start: khi(d, 14), end: khi(d, 15) }));
  assert.equal(findPattern(cuts, KHI, NOW).windows[0].from, '14:00');
  assert.equal(findPattern(cuts, 'Europe/London', NOW).windows[0].from, '10:00');
  // Dhaka is an hour ahead of Karachi
  assert.equal(findPattern(cuts, 'Asia/Dhaka', NOW).windows[0].from, '15:00');
});

test('a new home needs fewer days, but never just one', () => {
  assert.equal(daysNeeded(14), 5);
  assert.equal(daysNeeded(7), 3);
  assert.equal(daysNeeded(3), 2);
  assert.equal(daysNeeded(1), 2);
  const cuts = [1, 2].map((d) => ({ start: khi(d, 8), end: khi(d, 9) }));
  assert.equal(findPattern(cuts, KHI, NOW, { observedDays: 3 }).windows.length, 1);
  assert.equal(findPattern(cuts, KHI, NOW).windows.length, 0);
});

test('a typed schedule: cleaned, weekdays, and the next cut from it', () => {
  assert.match(cleanSchedule([{ from: '25:00', to: '10:00' }]), /start and an end/);
  assert.match(cleanSchedule([{ from: '10:00', to: '10:00' }]), /the same/);
  const s = cleanSchedule([{ from: '20:00', to: '21:00', days: [1, 3] }, { from: '8:00', to: '9:30' }, { from: '14:00', to: '15:00', days: [0, 1, 2, 3, 4, 5, 6] }]);
  assert.deepEqual(s, [{ from: '08:00', to: '09:30' }, { from: '14:00', to: '15:00' }, { from: '20:00', to: '21:00', days: [1, 3] }]);
  // 18 Oct 2026 is a Sunday: no 8 pm cut today; Monday's is the one after tomorrow morning
  const evening = new Date(khi(0, 16));
  const n = nextCut(s, KHI, evening);
  assert.equal(n.at.getTime(), khi(-1, 8));
  assert.equal(cutText(n, KHI, evening), 'tomorrow around 8:00 am');
  assert.equal(nextCut([{ from: '20:00', to: '21:00', days: [1] }], KHI, evening).at.getTime(), khi(-1, 20));
  assert.equal(nextCut([], KHI, evening), null);
});

// ------------------------------------------------------------------ the bill
test('the billing month runs from the billing day, also at the end of short months', () => {
  const c = cycleFor(1, KHI, NOW);
  assert.equal(c.start.getTime(), Date.UTC(2026, 9, 1, -5));
  assert.equal(c.end.getTime(), Date.UTC(2026, 10, 1, -5));
  const c20 = cycleFor(20, KHI, NOW);    // the 18th: still in the month that began on 20 Sep
  assert.equal(c20.start.getTime(), Date.UTC(2026, 8, 20, -5));
  const feb = cycleFor(31, KHI, new Date(Date.UTC(2027, 1, 28, 12)));
  assert.equal(feb.start.getTime(), Date.UTC(2027, 1, 28, -5));     // the 31st of February is its last day
  assert.equal(feb.end.getTime(), Date.UTC(2027, 2, 31, -5));
  assert.equal(previousCycle(1, KHI, c).start.getTime(), Date.UTC(2026, 8, 1, -5));
});

const r = (kwh, at, newMeter = false, id) => ({ id: id ?? `r${kwh}`, kwh, readAt: new Date(at), newMeter });

test('units this month from readings, a projection at this pace, slabs', () => {
  const c = cycleFor(1, KHI, NOW);
  const readings = [r(12000, Date.UTC(2026, 9, 1, 4)), r(12081, khi(0, 10))];
  const u = cycleUsage(readings, c, NOW, () => 99);
  assert.equal(u.source, 'readings');
  assert.equal(u.units, 81);
  assert.equal(u.estimated, 0);
  // 81 units in a little over 17 days of a 31-day month
  const p = project(u.units, c, u.asOf);
  assert.ok(p > 140 && p < 150, String(p));
  // slabs: 100 at 10, 100 at 15, the rest at 25
  const slabs = cleanSlabs([{ upTo: 100, rate: 10 }, { upTo: 200, rate: 15 }, { upTo: null, rate: 25 }]);
  assert.equal(billFor(150, 60, slabs).cost, 1000 + 750);
  assert.equal(billFor(250, 60, slabs).cost, 1000 + 1500 + 1250);
  assert.equal(billFor(80, 60, []).cost, 4800);
  assert.deepEqual(cleanSlabs([{ upTo: 100, rate: 10 }]), [{ upTo: 100, rate: 10 }, { upTo: null, rate: 10 }]);
  assert.match(cleanSlabs([{ upTo: 200, rate: 10 }, { upTo: 100, rate: 12 }]), /go higher/);
  assert.match(cleanSlabs([{ upTo: null, rate: 10 }, { upTo: 100, rate: 12 }]), /Only the last/);
});

test('no readings, one reading, and the start of the month filled in from estimates', () => {
  const c = cycleFor(1, KHI, NOW);
  const none = cycleUsage([], c, NOW, () => 42.04);
  assert.equal(none.source, 'estimate');
  assert.equal(none.units, 42);
  assert.equal(cycleUsage([], c, NOW, () => 0).source, 'none');
  // one reading this month and none before: can't count from it alone; estimates it is
  const one = cycleUsage([r(5000, khi(3, 9))], c, NOW, () => 30);
  assert.equal(one.source, 'estimate');
  assert.equal(one.latest.kwh, 5000);
  // two readings this month, none at the start: the days before the first are estimated
  const two = cycleUsage([r(5000, khi(10, 9)), r(5060, khi(0, 9))], c, NOW, (a, b) => {
    assert.equal(a.getTime(), c.start.getTime());
    assert.equal(b.getTime(), khi(10, 9));
    return 20;
  });
  assert.equal(two.source, 'readings+estimate');
  assert.equal(two.units, 80);
  assert.equal(two.estimated, 20);
  // a reading last month and one this month: a straight line gives the meter at the start
  const across = cycleUsage([r(1000, Date.UTC(2026, 8, 21, 7)), r(1200, khi(0, 9))], c, NOW, () => 0);
  assert.equal(across.source, 'readings');
  assert.equal(across.units, 129.3);                         // 228 of the 645 hours between them were before the 1st
  assert.equal(across.startReading.exact, false);
  assert.equal(meterAt([r(1000, khi(5, 0))], new Date(khi(6, 0))), null);
  // under a day of data is too little to project
  assert.equal(project(5, c, new Date(c.start.getTime() + 12 * 3600_000)), null);
});

test('a lower reading is a typing mistake unless the meter was replaced', () => {
  const list = [r(12000, khi(10, 9), false, 'a'), r(12081, khi(2, 9), false, 'b')];
  assert.match(checkReading(list, r(11950, khi(0, 9))), /less than the earlier reading \(12081 on 2026-10-16\).*new meter/);
  assert.match(checkReading(list, r(12100, khi(5, 9))), /more than the later reading/);
  assert.equal(checkReading(list, r(12050, khi(5, 9))), null);
  assert.equal(checkReading(list, r(3, khi(0, 9), true)), null);
  assert.match(checkReading(list, r(-1, khi(0, 9))), /number on the meter/);
  // editing a reading doesn't compare it with itself
  assert.equal(checkReading(list, r(12070, khi(2, 9), false, 'b'), 'b'), null);
  // after a new meter, readings compare with the new meter only
  const replaced = [...list, r(5, khi(1, 9), true, 'c')];
  assert.equal(checkReading(replaced, r(30, khi(0, 9))), null);
  // units over a meter change: the old meter up to its last reading, then the new one from its first number
  const c = cycleFor(1, KHI, NOW);
  assert.equal(unitsBetween([...replaced, r(30, khi(0, 9), false, 'd')], new Date(khi(10, 9)), new Date(khi(0, 9))), 81 + 25);
});

test('the protected-limit warnings: once each, near the limit or heading past it', () => {
  assert.deepEqual(warningsDue(200, 100, 150, []), []);
  assert.deepEqual(warningsDue(200, 162, 190, []), ['near']);
  assert.deepEqual(warningsDue(200, 162, 214, []), ['pace']);
  assert.deepEqual(warningsDue(200, 162, 214, ['pace']), []);
  assert.deepEqual(warningsDue(200, 170, 190, ['pace']), []);       // already told it's heading past
  assert.deepEqual(warningsDue(200, 205, 260, ['pace']), ['over']);
  assert.deepEqual(warningsDue(null, 500, 900, []), []);
});

test('estimates over any stretch of time come from each switch\'s on-time', () => {
  const runs = [
    { id: 'g', name: 'Geyser', watts: 2000, intervals: [{ start: 0, end: 2 * 3600_000 }] },
    { id: 'f', name: 'Fan', watts: 100, intervals: [{ start: 0, end: 10 * 3600_000 }] },
  ];
  const all = kwhBetween(runs, 0, 10 * 3600_000);
  assert.equal(all.kwh, 5);
  assert.deepEqual(all.devices.map((d) => d.name), ['Geyser', 'Fan']);
  assert.equal(kwhBetween(runs, 3600_000, 2 * 3600_000).kwh, 2.1);
});

// ------------------------------------------------------------------ UPS mode
test('the grid sensor: off, back, a flicker, and a first report', () => {
  const t0 = new Date(khi(0, 14, 3));
  assert.deepEqual(gridStep({ active: true }, { active: false }, null, t0), { type: 'off', since: t0 });
  // already on UPS: another "off" changes nothing
  assert.deepEqual(gridStep({ active: true }, { active: false }, t0, t0), { type: 'none' });
  // its very first report says nothing about when the grid went
  assert.deepEqual(gridStep(null, { active: false }, null, t0), { type: 'none' });
  const back = gridStep({ active: false }, { active: true }, t0, new Date(t0.getTime() + 58 * MIN));
  assert.deepEqual(back, { type: 'back', since: t0, seconds: 58 * 60, blip: false });
  assert.equal(gridStep({ active: false }, { active: true }, t0, new Date(t0.getTime() + 5000)).blip, true);
  // the sensor's own board restarted on the way (no "before"): still back
  assert.equal(gridStep(null, { active: true }, t0, new Date(t0.getTime() + 30 * MIN)).type, 'back');
  assert.deepEqual(gridStep({ active: false }, { active: true }, null, t0), { type: 'none' });
});

test('which heavy loads go off, and which come back', () => {
  const devs = [{ id: 'ac', on: true, online: true }, { id: 'iron', on: false, online: true }, { id: 'geyser', on: true, online: false }, { id: 'fan', on: true, online: true }];
  assert.deepEqual(loadsToCut(['ac', 'iron', 'geyser'], devs), ['ac']);
  const later = [{ id: 'ac', on: false, online: true }, { id: 'iron', on: false, online: true }];
  assert.deepEqual(loadsToRestore(true, ['ac'], later), ['ac']);
  assert.deepEqual(loadsToRestore(false, ['ac'], later), []);
  // someone already switched it back on: nothing to do
  assert.deepEqual(loadsToRestore(true, ['ac'], [{ id: 'ac', on: true, online: true }]), []);
  assert.equal(isHeavy({ name: 'Bedroom AC' }), true);
  assert.equal(isHeavy({ name: 'Iron socket' }), true);
  assert.equal(isHeavy({ name: 'Water motor' }), true);
  assert.equal(isHeavy({ name: 'Ceiling fan' }), false);
  assert.equal(isHeavy({ name: 'Socket 2', watts: 1800 }), true);
  assert.equal(isMainsSensor({ type: 'contact', settings: { kind: 'mains' } }), true);
  assert.equal(isMainsSensor({ type: 'contact', settings: { kind: 'door' } }), false);
});

test('rules: a mains sensor starts rules when the grid goes or comes back', () => {
  assert.deepEqual(eventsFor('contact', { kind: 'mains' }), ['gridOff', 'gridOn']);
  assert.deepEqual(eventsFor('contact', { kind: 'door' }), ['opens', 'closes']);
  assert.equal(fires({ deviceId: 'm', event: 'gridOff' }, { active: true }, { active: false }), true);
  assert.equal(fires({ deviceId: 'm', event: 'gridOff' }, { active: false }, { active: false }), false);
  assert.equal(fires({ deviceId: 'm', event: 'gridOn' }, { active: false }, { active: true }), true);
  const names = new Map([['m', 'Grid sense'], ['ac', 'AC']]);
  assert.equal(describeRule({ deviceId: 'm', event: 'gridOff' }, {}, [{ type: 'device', deviceId: 'ac', on: false }], names, new Map()), 'When the grid goes: AC off');
});
