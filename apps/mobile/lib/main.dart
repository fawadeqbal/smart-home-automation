import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app.dart';
import 'core/config/app_settings.dart';
import 'core/network/api_client.dart';
import 'core/network/session_cookies.dart';
import 'push/push.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // the app's words are English; dates follow (the phone's locale may not have date names loaded)
  Intl.defaultLocale = 'en_US';
  final prefs = await SharedPreferences.getInstance();
  final cookies = await SessionCookies.create();
  // phone notifications: off (without errors) until the build has the Firebase project's files
  final push = await PushSetup.init();
  runApp(
    ProviderScope(
      overrides: [
        sharedPrefsProvider.overrideWithValue(prefs),
        sessionCookiesProvider.overrideWithValue(cookies),
        pushSetupProvider.overrideWithValue(push),
      ],
      child: const SwitchboardApp(),
    ),
  );
}
