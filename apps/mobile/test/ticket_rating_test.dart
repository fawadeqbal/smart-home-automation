import 'package:flutter_test/flutter_test.dart';
import 'package:switchboard_home/data/models/ticket.dart';

void main() {
  test('a solved help request carries its rating and whether it can be rated', () {
    final t = Ticket.fromJson({
      'id': 't1',
      'number': 7,
      'title': 'Lights',
      'status': 'RESOLVED',
      'statusText': 'Solved',
      'rating': 4,
      'ratingComment': 'Quick, thank you',
      'canRate': true,
      'rateUntil': '2026-10-25T10:00:00Z',
      'messages': <Object>[],
    });
    expect(t.done, isTrue);
    expect(t.rating, 4);
    expect(t.ratingComment, 'Quick, thank you');
    expect(t.canRate, isTrue);
    expect(t.rateUntil, isNotNull);
  });

  test('an older server (no rating fields) or a strange value reads as not rated', () {
    final t = Ticket.fromJson({'id': 't2', 'number': 8, 'status': 'OPEN'});
    expect(t.rating, isNull);
    expect(t.canRate, isFalse);
    expect(Ticket.fromJson({'id': 't3', 'rating': 9}).rating, isNull);
    expect(Ticket.fromJson({'id': 't4', 'rating': 'five'}).rating, isNull);
  });
}
