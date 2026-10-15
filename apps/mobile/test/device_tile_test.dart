import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:switchboard_home/core/theme/app_theme.dart';
import 'package:switchboard_home/features/devices/device_tile.dart';

import 'device_kinds_test.dart' show dev;

Widget host(Widget child) => MaterialApp(
  theme: AppTheme.light(),
  home: Scaffold(
    body: Center(child: SizedBox(width: 180, child: child)),
  ),
);

void main() {
  testWidgets('a tile shows its state and switches on tap', (tester) async {
    var taps = 0, opened = 0;
    await tester.pumpWidget(
      host(
        DeviceTile(
          device: dev('Lamp', state: {'on': false}),
          onToggle: () => taps++,
          onOpen: () => opened++,
        ),
      ),
    );
    expect(find.text('Lamp'), findsOneWidget);
    expect(find.text('Off'), findsWidgets);
    await tester.tap(find.text('Lamp'));
    await tester.tap(find.bySemanticsLabel('Lamp details'));
    await tester.pumpAndSettle();
    expect(taps, 1);
    expect(opened, 1);
  });

  testWidgets('pending and offline tiles say so', (tester) async {
    await tester.pumpWidget(host(DeviceTile(device: dev('Lamp', state: {'on': true}), pending: true)));
    expect(find.text('Turning on…'), findsOneWidget);
    final offline = dev('Lamp', state: {'on': true}).copyWith(online: false);
    await tester.pumpWidget(host(DeviceTile(device: offline)));
    await tester.pumpAndSettle();
    expect(find.text('Not responding'), findsOneWidget);
    expect(find.text('!'), findsOneWidget);
  });

  testWidgets('a timer shows on a tile that is on', (tester) async {
    await tester.pumpWidget(
      host(
        DeviceTile(
          device: dev('Fan', state: {'on': true}),
          timerText: 'Off in 25 min',
        ),
      ),
    );
    expect(find.text('Off in 25 min'), findsOneWidget);
  });
}
