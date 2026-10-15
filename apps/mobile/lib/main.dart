import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app.dart';
import 'core/config/app_settings.dart';
import 'core/network/api_client.dart';
import 'core/network/session_cookies.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // the app's words are English; dates follow (the phone's locale may not have date names loaded)
  Intl.defaultLocale = 'en_US';
  final prefs = await SharedPreferences.getInstance();
  final cookies = await SessionCookies.create();
  runApp(
    ProviderScope(
      overrides: [
        sharedPrefsProvider.overrideWithValue(prefs),
        sessionCookiesProvider.overrideWithValue(cookies),
      ],
      child: const SwitchboardApp(),
    ),
  );
}
