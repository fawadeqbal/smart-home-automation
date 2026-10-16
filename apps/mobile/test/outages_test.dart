import 'package:flutter_test/flutter_test.dart';
import 'package:switchboard_home/data/models/outages.dart';

void main() {
  test('outages from the server, in words', () {
    final o = HomeOutages.fromJson({
      'summary': {'powerCuts': 2, 'powerSeconds': 4200, 'networkOuts': 1, 'networkSeconds': 600},
      'outages': [
        {'kind': 'POWER', 'board': 'Living room board', 'startedAt': '2026-10-16T10:10:00.000Z', 'endedAt': '2026-10-16T11:05:00.000Z', 'seconds': 3300},
        {'kind': 'RESTART', 'board': 'Kitchen board', 'startedAt': '2026-10-16T09:00:00.000Z', 'endedAt': '2026-10-16T09:00:20.000Z', 'seconds': 20},
      ],
    });
    expect(o.powerCuts, 2);
    expect(o.outages.first.label, 'Power cut');
    expect(o.outages.where((x) => x.counts).length, 1);
    expect(outageDuration(4200), '1 h 10 min');
    expect(outageDuration(3300), '55 min');
    expect(outageDuration(12), '12 s');
  });
}
