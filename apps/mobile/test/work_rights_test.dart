import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:switchboard_home/core/config/app_settings.dart';
import 'package:switchboard_home/core/routing/routes.dart';
import 'package:switchboard_home/core/theme/app_theme.dart';
import 'package:switchboard_home/data/models/session.dart';
import 'package:switchboard_home/data/models/work/board.dart';
import 'package:switchboard_home/data/models/work/rights.dart';
import 'package:switchboard_home/features/work/pin_map.dart';
import 'package:switchboard_home/features/work/work_routes.dart';
import 'package:switchboard_home/state/session.dart';
import 'package:switchboard_home/state/work.dart';

class _FakeSession extends SessionController {
  _FakeSession(this.me);
  final Me? me;

  @override
  Future<Me?> build() async => me;
}

Me person({String? staff, List<String> homes = const [], String? openHome}) => Me.fromJson({
  'id': 'u1',
  'name': 'Fawad Iqbal',
  'email': 'f@x',
  'staff': staff == null
      ? null
      : {
          'role': staff,
          'org': {'name': 'Bright Homes'},
        },
  'homes': [
    for (final h in homes) {'id': h, 'name': h, 'role': 'OWNER'},
  ],
  'home': openHome == null ? null : {'id': openHome, 'name': openHome, 'role': 'OWNER', 'viaStaff': staff != null},
});

final _probe = Provider.family<({bool handled, String? to}), String>(
  (ref, loc) => workRedirect(ref, ref.watch(sessionProvider).value!, loc),
);

/// Where the router would send [loc] now (it runs the redirect afresh on every change, like this).
({bool handled, String? to}) go(ProviderContainer c, String loc) => c.refresh(_probe(loc));

Future<ProviderContainer> app(Me me, {Map<String, Object> prefs = const {}}) async {
  SharedPreferences.setMockInitialValues(prefs);
  final p = await SharedPreferences.getInstance();
  final c = ProviderContainer(
    overrides: [
      sharedPrefsProvider.overrideWithValue(p),
      sessionProvider.overrideWith(() => _FakeSession(me)),
    ],
  );
  addTearDown(c.dispose);
  await c.read(sessionProvider.future);
  return c;
}

void main() {
  test('who may do what on the phone', () {
    const boss = WorkRights(role: StaffRole.superadmin, userId: 'u0');
    const ravi = WorkRights(role: StaffRole.installer, userId: 'u1');
    const neha = WorkRights(role: StaffRole.support, userId: 'u2');
    // boards and the installation report: super admins anywhere, installers in their own homes, support never
    expect(boss.canSetup('u1'), isTrue);
    expect(boss.canSetup(null), isTrue);
    expect(ravi.canSetup('u1'), isTrue);
    expect(ravi.canSetup('u9'), isFalse);
    expect(ravi.canSetup(null), isFalse);
    expect(neha.canSetup('u2'), isFalse);
    expect(neha.canEditInstallation('u2'), isFalse);
    expect(neha.readOnly, isTrue);
    expect(boss.canReopenInstallation && !ravi.canReopenInstallation, isTrue);
    // the day of someone else, tickets handed on, stock
    expect(ravi.canPickInstaller, isFalse);
    expect(neha.canPickInstaller && boss.canPickInstaller, isTrue);
    expect(ravi.canAssignTickets, isFalse);
    expect(neha.canAssignTickets, isTrue);
    expect(ravi.seesStock || ravi.seesVisitRequests, isFalse);
    expect(neha.seesStock && !neha.canAssignStock, isTrue);
    expect(boss.canAssignStock, isTrue);
    expect(StaffRole.fromJson('SOMETHING_NEW'), StaffRole.support); // the fewest rights
  });

  test('rights follow the signed-in staff member', () async {
    expect((await app(person())).read(workRightsProvider), isNull);
    final c = await app(person(staff: 'INSTALLER'));
    expect(c.read(workRightsProvider)!.role, StaffRole.installer);
    expect(c.read(workRightsProvider)!.userId, 'u1');
  });

  test('staff without a home of their own always work', () async {
    final c = await app(person(staff: 'INSTALLER'));
    expect(c.read(atWorkProvider), isTrue);
    expect(go(c, Routes.home), (handled: true, to: WorkRoutes.today));
    expect(go(c, Routes.noHome), (handled: true, to: WorkRoutes.today));
    expect(go(c, WorkRoutes.homes), (handled: true, to: null));
    expect(go(c, '/work'), (handled: true, to: WorkRoutes.today));
  });

  test('the owner who is also super admin gets his home until he picks Work, and the app remembers', () async {
    final me = person(staff: 'SUPERADMIN', homes: ['h0'], openHome: 'h0');
    var c = await app(me);
    expect(c.read(atWorkProvider), isFalse);
    expect(go(c, Routes.home), (handled: false, to: null));
    expect(go(c, WorkRoutes.today), (handled: true, to: Routes.home));
    await c.read(workChoiceProvider.notifier).set(true);
    expect(c.read(atWorkProvider), isTrue);
    expect(go(c, Routes.home), (handled: true, to: WorkRoutes.today));
    expect(c.read(sharedPrefsProvider).getString('work_mode'), 'work');
    // next start
    c = await app(me, prefs: {'work_mode': 'work'});
    expect(c.read(atWorkProvider), isTrue);
  });

  test('a customer’s home opened from work shows the home app, and work is a tap away', () async {
    final c = await app(person(staff: 'INSTALLER', openHome: 'h7'));
    c.read(customerViewProvider.notifier).open('h7');
    expect(go(c, Routes.home), (handled: true, to: null));
    expect(go(c, Routes.me), (handled: true, to: null));
    expect(go(c, WorkRoutes.today), (handled: true, to: null));
    c.read(customerViewProvider.notifier).close();
    expect(go(c, Routes.home), (handled: true, to: WorkRoutes.today));
  });

  test('people who aren’t staff never see the work pages', () async {
    final c = await app(person(homes: ['h0'], openHome: 'h0'));
    expect(c.read(atWorkProvider), isFalse);
    expect(go(c, WorkRoutes.tickets), (handled: true, to: Routes.home));
    expect(go(c, Routes.home), (handled: false, to: null));
  });

  testWidgets('the pin picker offers only the pins it is given and says when there is none', (tester) async {
    final picked = <int>[];
    final pins = [
      const BoardPin(gpio: 5, label: 'D1', uses: ['output'], note: 'Best choice for a relay'),
      const BoardPin(gpio: 12, label: 'D6', uses: ['output']),
    ];
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light(),
        home: Scaffold(
          body: PinPicker(choices: pins, value: 5, onChanged: picked.add),
        ),
      ),
    );
    expect(find.text('D1'), findsOneWidget);
    expect(find.text('D6'), findsOneWidget);
    expect(find.text('D3'), findsNothing);
    expect(find.text('Best choice for a relay'), findsOneWidget);
    await tester.tap(find.text('D6'));
    expect(picked, [12]);
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light(),
        home: Scaffold(
          body: PinPicker(choices: const [], value: -1, onChanged: picked.add),
        ),
      ),
    );
    expect(find.textContaining('No free pin'), findsOneWidget);
  });
}
