import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:switchboard_home/core/config/app_settings.dart';
import 'package:switchboard_home/core/theme/app_theme.dart';
import 'package:switchboard_home/data/models/session.dart';
import 'package:switchboard_home/data/models/work/day.dart';
import 'package:switchboard_home/features/work/today_screen.dart';
import 'package:switchboard_home/state/session.dart';
import 'package:switchboard_home/state/work.dart';

class _FakeSession extends SessionController {
  _FakeSession(this.me);
  final Me me;

  @override
  Future<Me?> build() async => me;
}

final _ravi = Me.fromJson({
  'id': 'u1',
  'name': 'Ravi Kumar',
  'email': 'r@x',
  'staff': {
    'role': 'INSTALLER',
    'org': {'name': 'Bright Homes'},
  },
});

Future<void> pumpToday(WidgetTester tester, InstallerDay day) async {
  SharedPreferences.setMockInitialValues({});
  final prefs = await SharedPreferences.getInstance();
  tester.view.physicalSize = const Size(1170, 3600);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        sharedPrefsProvider.overrideWithValue(prefs),
        sessionProvider.overrideWith(() => _FakeSession(_ravi)),
        workDayProvider.overrideWith((ref) async => day),
      ],
      child: MaterialApp(
        theme: AppTheme.light(),
        home: const Scaffold(body: TodayScreen()),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('the day lists the stops in order with their jobs and what to do there', (tester) async {
    await pumpToday(
      tester,
      InstallerDay.fromJson({
        'date': WorkDays.today(),
        'installer': {'id': 'u1', 'name': 'Ravi Kumar'},
        'baseSet': true,
        'totalKm': 19.3,
        'mapsUrl': 'https://www.google.com/maps/dir/?api=1',
        'stops': [
          {
            'key': 'h1',
            'n': 1,
            'kind': 'home',
            'name': 'Khan residence',
            'city': 'Lahore',
            'lat': 31.4,
            'lng': 74.2,
            'homeId': 'h1',
            'phone': '+923214567890',
            'whatsapp': '923214567890',
            'legKm': 6.2,
            'directions': 'https://maps',
            'jobs': [
              {'type': 'install', 'title': 'Installation', 'detail': '1 board to install'},
              {
                'type': 'ticket',
                'title': '#1 · Fan doesn’t go to speed 3',
                'detail': 'High priority',
                'link': '/console/tickets/t1',
              },
            ],
          },
          {
            'key': 'visit:v',
            'n': 2,
            'kind': 'visit',
            'name': 'Bilal Chaudhry',
            'city': 'Lahore',
            'phone': '0300 1234567',
            'whatsapp': '923001234567',
            'jobs': [
              {'type': 'visit', 'title': 'Home visit: Bilal Chaudhry', 'detail': '4:30 pm · 10 marla'},
            ],
          },
        ],
      }),
    );
    expect(find.text('Today'), findsOneWidget);
    expect(find.text('2 stops'), findsOneWidget);
    expect(find.text('Whole route'), findsOneWidget);
    expect(find.text('From the base · 6.2 km'), findsOneWidget);
    expect(find.text('Khan residence'), findsOneWidget);
    expect(find.text('#1 · Fan doesn’t go to speed 3'), findsOneWidget);
    expect(find.text('Checklist'), findsOneWidget); // an installation stop
    expect(find.text('New customer'), findsOneWidget);
    expect(find.text('On my way'), findsNWidgets(2));
    expect(find.text('Call'), findsNWidgets(2));
    // installers only see their own day
    expect(find.text('Ravi Kumar'), findsNothing);
  });

  testWidgets('an empty day says what would show there', (tester) async {
    await pumpToday(tester, InstallerDay.fromJson({'date': WorkDays.today(), 'stops': []}));
    expect(find.text('Nothing for today'), findsOneWidget);
    expect(find.textContaining('Visits booked for you'), findsOneWidget);
  });
}
