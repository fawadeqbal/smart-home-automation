import 'dart:async';
import 'dart:io' show Platform;

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/config/app_settings.dart';
import '../core/routing/app_router.dart';
import '../data/models/device.dart';
import '../data/models/notice.dart';
import '../data/repositories/notices_repository.dart';
import '../state/devices.dart';
import '../state/session.dart';

/// Android channels (the server names them in each message): alerts ring and show on top.
const alertsChannel = AndroidNotificationChannel(
  'alerts',
  'Alerts',
  description: 'Water leaks, doors and motion while you’re away: things to look at now',
  importance: Importance.high,
);
const generalChannel = AndroidNotificationChannel(
  'general',
  'Notices',
  description: 'Everything else: a board went offline, a guest’s access ended, everyone left',
);

/// Firebase for this app run. Push stays off — quietly — when the project's google-services.json
/// isn't in the build (see docs/push.md), on the web, and in tests.
class PushSetup {
  PushSetup._(this.available, this._local);

  /// Firebase started: this phone can get a push token.
  final bool available;
  final FlutterLocalNotificationsPlugin? _local;

  /// Links of notifications the person tapped (while the app was open, in the background, or closed).
  final _taps = StreamController<({String? link, String? homeId})>.broadcast();
  ({String? link, String? homeId})? _launch;

  Stream<({String? link, String? homeId})> get taps => _taps.stream;

  /// The tap that opened the app, once.
  ({String? link, String? homeId})? takeLaunch() {
    final l = _launch;
    _launch = null;
    return l;
  }

  static PushSetup off() => PushSetup._(false, null);

  /// Called once in main(). Never throws.
  static Future<PushSetup> init() async {
    if (kIsWeb || !(Platform.isAndroid || Platform.isIOS)) return off();
    try {
      await Firebase.initializeApp();
    } catch (e) {
      debugPrint('Push off: Firebase is not set up in this build ($e)');
      return off();
    }
    FlutterLocalNotificationsPlugin? local;
    try {
      local = FlutterLocalNotificationsPlugin();
      final android = local.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
      await android?.createNotificationChannel(alertsChannel);
      await android?.createNotificationChannel(generalChannel);
    } catch (e) {
      debugPrint('Local notifications unavailable: $e');
      local = null;
    }
    final setup = PushSetup._(true, local);
    await setup._listen();
    return setup;
  }

  Future<void> _listen() async {
    try {
      await _local?.initialize(
        settings: const InitializationSettings(
          android: AndroidInitializationSettings('@mipmap/ic_launcher'),
          iOS: DarwinInitializationSettings(requestAlertPermission: false, requestBadgePermission: false, requestSoundPermission: false),
        ),
        onDidReceiveNotificationResponse: (r) => _taps.add(_fromPayload(r.payload)),
      );
      final launchedLocal = await _local?.getNotificationAppLaunchDetails();
      if (launchedLocal?.didNotificationLaunchApp ?? false) _launch = _fromPayload(launchedLocal!.notificationResponse?.payload);
    } catch (e) {
      debugPrint('Local notifications: $e');
    }
    // the app was closed and a push was tapped
    final initial = await FirebaseMessaging.instance.getInitialMessage();
    if (initial != null) _launch = _fromData(initial.data);
    // in the background, tapped
    FirebaseMessaging.onMessageOpenedApp.listen((m) => _taps.add(_fromData(m.data)));
    // open: Android shows nothing by itself, so alerts and warnings are shown here (the bell has them all)
    FirebaseMessaging.onMessage.listen(_showWhileOpen);
  }

  static ({String? link, String? homeId}) _fromData(Map<String, dynamic> d) =>
      (link: d['link'] as String?, homeId: d['homeId'] as String?);

  static ({String? link, String? homeId}) _fromPayload(String? p) {
    if (p == null || p.isEmpty) return (link: null, homeId: null);
    final i = p.indexOf('|');
    return i < 0 ? (link: p, homeId: null) : (link: p.substring(i + 1).isEmpty ? null : p.substring(i + 1), homeId: p.substring(0, i));
  }

  Future<void> _showWhileOpen(RemoteMessage m) async {
    final n = m.notification;
    final severity = m.data['severity'] as String? ?? 'INFO';
    if (n == null || _local == null || severity == 'INFO') return;
    final alert = severity == 'ALERT';
    final channel = alert ? alertsChannel : generalChannel;
    try {
      await _local.show(
        id: (m.data['id'] as String? ?? m.messageId ?? '').hashCode,
        title: n.title,
        body: n.body,
        notificationDetails: NotificationDetails(
          android: AndroidNotificationDetails(
            channel.id,
            channel.name,
            channelDescription: channel.description,
            importance: alert ? Importance.high : Importance.defaultImportance,
            priority: alert ? Priority.high : Priority.defaultPriority,
          ),
        ),
        payload: '${m.data['homeId'] ?? ''}|${m.data['link'] ?? ''}',
      );
    } catch (e) {
      debugPrint('Could not show a notice: $e');
    }
  }
}

/// Provided in main() (tests get [PushSetup.off]).
final pushSetupProvider = Provider<PushSetup>((ref) => PushSetup.off());

/// Whether to ask: the person hasn't been asked on this phone yet (Android 13+ needs a yes).
enum PushAsk { notAvailable, ask, granted, declined }

/// This phone's push: permission (asked once, after sign-in, with a short explanation), the token the
/// server knows for the signed-in person, and taps that open the right screen.
class PushController {
  PushController(this._ref);
  final Ref _ref;
  static const _askedKey = 'push_asked';
  static const _tokenKey = 'push_token';

  PushSetup get _setup => _ref.read(pushSetupProvider);

  /// What the app should do about permission now.
  Future<PushAsk> status() async {
    if (!_setup.available) return PushAsk.notAvailable;
    try {
      final s = await FirebaseMessaging.instance.getNotificationSettings();
      if (s.authorizationStatus == AuthorizationStatus.authorized || s.authorizationStatus == AuthorizationStatus.provisional) {
        return PushAsk.granted;
      }
    } catch (_) {
      return PushAsk.notAvailable;
    }
    final asked = _ref.read(sharedPrefsProvider).getBool(_askedKey) ?? false;
    return asked ? PushAsk.declined : PushAsk.ask;
  }

  /// The system's question (after our own explanation). True when allowed.
  Future<bool> ask() async {
    await _ref.read(sharedPrefsProvider).setBool(_askedKey, true);
    try {
      final s = await FirebaseMessaging.instance.requestPermission();
      final ok = s.authorizationStatus == AuthorizationStatus.authorized || s.authorizationStatus == AuthorizationStatus.provisional;
      if (ok) await register();
      return ok;
    } catch (_) {
      return false;
    }
  }

  /// Not now: don't ask again on this phone (Me → Notifications can turn it on later).
  Future<void> later() => _ref.read(sharedPrefsProvider).setBool(_askedKey, true);

  /// Tells the server this phone's token for the signed-in person (again after a new token).
  Future<void> register() async {
    if (!_setup.available || _ref.read(sessionProvider).value == null) return;
    try {
      // the registration token: what the server's FCM HTTP v1 messages are addressed to (`message.token`);
      // the newer register()/onRegistered hands out an installation id for another way of sending
      // ignore: deprecated_member_use
      final token = await FirebaseMessaging.instance.getToken();
      if (token == null) return;
      final prefs = _ref.read(sharedPrefsProvider);
      final before = prefs.getString(_tokenKey);
      await _ref.read(noticesRepositoryProvider).registerPhone(
        token: token,
        platform: Platform.isIOS ? 'ios' : 'android',
        appVersion: const String.fromEnvironment('APP_VERSION', defaultValue: '1.0.0'),
        replaces: before != token ? before : null,
      );
      await prefs.setString(_tokenKey, token);
    } catch (e) {
      debugPrint('Push token not sent: $e');
    }
  }

  /// Signing out: no more notices to this phone for that person.
  Future<void> unregister() async {
    final prefs = _ref.read(sharedPrefsProvider);
    final token = prefs.getString(_tokenKey);
    if (token == null) return;
    try {
      await _ref.read(noticesRepositoryProvider).unregisterPhone(token);
    } catch (_) {
      // signed out on the phone either way; the server drops it once Google says it's gone
    }
    await prefs.remove(_tokenKey);
  }

  /// Opens the screen a notice points to (its home first, when it's another one).
  Future<void> open({String? link, String? homeId}) async {
    final me = _ref.read(sessionProvider).value;
    if (me == null) return;
    final target = NoticeTarget.fromLink(link, homeId: homeId);
    if (target.homeId != null && target.homeId != me.home?.id && me.homes.any((h) => h.id == target.homeId)) {
      try {
        await _ref.read(sessionProvider.notifier).openHome(target.homeId!);
      } catch (_) {}
    }
    final router = _ref.read(routerProvider);
    if (target.deviceId != null) {
      // the device's room, when it's one I can see; else the home
      String? room;
      try {
        final List<Device> devices = _ref.read(devicesProvider).value ?? await _ref.read(devicesProvider.future);
        room = devices.where((d) => d.id == target.deviceId).firstOrNull?.roomId;
      } catch (_) {
        // can't load the devices: the home tab it is
      }
      router.go(room != null ? '/home/room/$room' : '/home');
      return;
    }
    router.go(target.route);
  }
}

final pushControllerProvider = Provider<PushController>((ref) => PushController(ref));

/// While signed in: keeps the server's token for this phone current, and follows taps. Watched by the shell.
final pushSyncProvider = Provider<void>((ref) {
  final setup = ref.watch(pushSetupProvider);
  final me = ref.watch(sessionProvider.select((s) => s.value?.id));
  if (!setup.available || me == null) return;
  final push = ref.read(pushControllerProvider);
  unawaited(() async {
    if (await push.status() == PushAsk.granted) await push.register();
  }());
  // a new registration token (see register()): tell the server, replacing the old one
  // ignore: deprecated_member_use
  final refresh = FirebaseMessaging.instance.onTokenRefresh.listen((_) => push.register());
  final taps = setup.taps.listen((t) => push.open(link: t.link, homeId: t.homeId));
  final launch = setup.takeLaunch();
  if (launch != null) unawaited(Future<void>.delayed(const Duration(milliseconds: 300), () => push.open(link: launch.link, homeId: launch.homeId)));
  ref.onDispose(() {
    unawaited(refresh.cancel());
    unawaited(taps.cancel());
  });
});
