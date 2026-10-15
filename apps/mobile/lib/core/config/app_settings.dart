import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// SharedPreferences, opened once in `main()` and provided here.
final sharedPrefsProvider = Provider<SharedPreferences>(
  (ref) => throw UnimplementedError('Override sharedPrefsProvider in main()'),
);

/// The Switchboard server this app talks to, e.g. `https://home.example.com` or `http://192.168.1.20:4000`.
///
/// Phones start on the cloud server ([preset]); "Server · Change" on the sign-in screen points the
/// app somewhere else (a test server on the home Wi‑Fi). On the web the app is served by its server,
/// so it uses the page's own address. Build for another company with `--dart-define=SERVER_URL=…`,
/// or `--dart-define=SERVER_URL=` to ask for the address on first start.
class ServerUrl extends Notifier<String?> {
  static const _key = 'server_url';
  static const preset = String.fromEnvironment('SERVER_URL', defaultValue: 'https://home.fawadiqbal.dev');

  @override
  String? build() {
    final saved = ref.read(sharedPrefsProvider).getString(_key);
    if (saved != null && saved.isNotEmpty) return saved;
    if (kIsWeb) return Uri.base.origin;
    if (preset.isNotEmpty) return normalize(preset);
    return null;
  }

  Future<void> set(String url) async {
    final clean = normalize(url);
    await ref.read(sharedPrefsProvider).setString(_key, clean);
    state = clean;
  }

  /// "home.example.com" → "https://home.example.com"; a LAN address keeps http.
  static String normalize(String raw) {
    var url = raw.trim();
    while (url.endsWith('/')) {
      url = url.substring(0, url.length - 1);
    }
    if (url.endsWith('/api')) url = url.substring(0, url.length - 4);
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      final host = url.split(':').first;
      final local =
          host == 'localhost' ||
          RegExp(r'^(10|127|192\.168|172\.(1[6-9]|2\d|3[01]))\.').hasMatch(host) ||
          host.endsWith('.local');
      url = '${local ? 'http' : 'https'}://$url';
    }
    return url;
  }
}

final serverUrlProvider = NotifierProvider<ServerUrl, String?>(ServerUrl.new);

/// Light, dark or follow the phone — remembered.
class ThemeModeSetting extends Notifier<ThemeMode> {
  static const _key = 'theme_mode';

  @override
  ThemeMode build() {
    final saved = ref.read(sharedPrefsProvider).getString(_key);
    return ThemeMode.values.firstWhere(
      (m) => m.name == saved,
      orElse: () => ThemeMode.system,
    );
  }

  Future<void> set(ThemeMode mode) async {
    state = mode;
    await ref.read(sharedPrefsProvider).setString(_key, mode.name);
  }
}

final themeModeProvider = NotifierProvider<ThemeModeSetting, ThemeMode>(
  ThemeModeSetting.new,
);
