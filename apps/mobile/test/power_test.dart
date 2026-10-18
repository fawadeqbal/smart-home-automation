import 'package:flutter_test/flutter_test.dart';
import 'package:switchboard_home/data/models/device.dart';
import 'package:switchboard_home/data/models/power.dart';
import 'package:switchboard_home/features/devices/device_kinds.dart';

void main() {
  test('on UPS, or the next expected cut, for the home card', () {
    final ups = PowerStatus.fromJson({
      'grid': {'sensor': true, 'off': true, 'sinceText': '2:03 pm', 'switchedOff': ['AC']},
      'next': {'text': 'today around 8:00 pm', 'now': false}, 'source': 'learned',
    });
    expect(ups.headline, 'On UPS/solar since 2:03 pm');
    expect(ups.detail, 'Switched off to save the battery: AC.');

    final next = PowerStatus.fromJson({'grid': {'sensor': false, 'off': false}, 'next': {'text': 'today around 2:00 pm'}, 'source': 'typed'});
    expect(next.headline, 'Next expected cut: today around 2:00 pm');
    expect(next.detail, 'From your area’s schedule');

    expect(PowerStatus.fromJson({'grid': {}, 'next': null}).headline, isNull);
    expect(const PowerStatus().loaded, isFalse);
  });

  test('load-shedding windows read as times people use', () {
    final s = Shedding.fromJson({
      'source': 'learned',
      'windows': [{'from': '14:00', 'to': '15:00', 'seen': 9, 'of': 14}],
      'typed': [],
      'learned': {'windows': [{'from': '14:00', 'to': '15:00', 'seen': 9, 'of': 14}], 'slots': List.filled(48, 0), 'observedDays': 14, 'needed': 5},
      'next': {'text': 'today around 2:00 pm'},
    });
    expect(s.learned.single.text, '2:00 pm – 3:00 pm · 9 of 14 days');
    expect(s.slots.length, 48);
    expect(s.how, contains('at least 5 of them'));
    expect(const CutWindow(from: '20:00', to: '21:00', days: [1, 3]).text, '8:00 pm – 9:00 pm · Mon, Wed');
    expect(CutWindow.ampm('00:30'), '12:30 am');
    expect(const CutWindow(from: '8:00', to: '9:00', days: [1]).toJson(), {'from': '8:00', 'to': '9:00', 'days': [1]});
  });

  test('the bill: units, projection, the protected limit', () {
    final b = Bill.fromJson({
      'units': 162, 'projected': 214.4, 'source': 'readings', 'estimated': 0,
      'cost': {'soFar': 9720, 'projected': 12864}, 'protectedLimit': 200, 'over': false, 'heading': true,
      'message': "You've used 162 units since the 1st.", 'billingDay': 1, 'billingDayText': '1st', 'cycle': {'daysLeft': 9},
      'topDevices': [{'name': 'AC', 'kwh': 80.4}], 'lastMonth': 188, 'latest': {'kwh': 12162},
    });
    expect(b.warn, isTrue);
    expect(b.limitShare, closeTo(.81, .001));
    expect(b.limitShareEnd, 1);
    expect(b.unitsNote, 'from your meter readings');
    expect(b.topDevices.single.$1, 'AC');
    expect(Bill.fromJson({'source': 'readings+estimate', 'estimated': 20.4}).unitsNote, startsWith('20 of them estimated'));
    expect(Bill.fromJson({'protectedLimit': null}).limitShare, 0);
  });

  test('a mains-sense sensor says "Grid on" or "On UPS", not "Open"', () {
    final on = Device.fromJson({'id': 'm', 'key': 'grid', 'name': 'Grid', 'type': 'contact', 'settings': {'kind': 'mains'}, 'state': {'active': true}, 'online': true});
    final off = Device.fromJson({'id': 'm', 'key': 'grid', 'name': 'Grid', 'type': 'contact', 'settings': {'kind': 'mains'}, 'state': {'active': false}, 'online': true});
    expect(DeviceKinds.of(on).status(on), 'Grid on');
    expect(DeviceKinds.of(off).status(off), 'On UPS');
  });
}
