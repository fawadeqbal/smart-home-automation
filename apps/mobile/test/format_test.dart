import 'package:flutter_test/flutter_test.dart';
import 'package:switchboard_home/core/config/app_settings.dart';
import 'package:switchboard_home/core/util/format.dart';

void main() {
  test('days read like the design', () {
    expect(Fmt.days([0, 1, 2, 3, 4, 5, 6]), 'Every day');
    expect(Fmt.days([1, 2, 3, 4, 5]), 'Weekdays');
    expect(Fmt.days([1, 4]), 'Mon & Thu');
    expect(Fmt.days([0, 6]), 'Weekends');
    expect(Fmt.days([1, 3, 5]), 'Mon, Wed, Fri');
  });

  test('time until', () {
    final now = DateTime(2026, 10, 15, 21, 4);
    expect(Fmt.until(now.add(const Duration(minutes: 25)), now), 'in 25 min');
    expect(Fmt.until(now.add(const Duration(minutes: 100)), now), 'in 1 h 40 min');
    expect(Fmt.until(DateTime(2026, 10, 16, 5), now), 'in 7 h 56 min');
    expect(Fmt.until(DateTime(2026, 10, 16, 18, 30), now), 'tomorrow 18:30');
    expect(Fmt.minutes(60), '1 hour');
    expect(Fmt.minutes(120), '2 hours');
  });

  test('greetings and days', () {
    expect(Fmt.greeting(DateTime(2026, 1, 1, 21)), 'Good evening');
    expect(Fmt.greeting(DateTime(2026, 1, 1, 8)), 'Good morning');
    final now = DateTime(2026, 10, 15, 12);
    expect(Fmt.day(DateTime(2026, 10, 15, 1), now), 'Today');
    expect(Fmt.day(DateTime(2026, 10, 14, 23), now), 'Yesterday');
  });

  test('server addresses', () {
    expect(ServerUrl.normalize('home.example.com/'), 'https://home.example.com');
    expect(ServerUrl.normalize('192.168.1.20:4000'), 'http://192.168.1.20:4000');
    expect(ServerUrl.normalize('https://home.example.com/api'), 'https://home.example.com');
    expect(ServerUrl.normalize('localhost:3000'), 'http://localhost:3000');
  });
}
