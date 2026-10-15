import 'dart:async';
import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';

/// Android: a foreground service of type "microphone" so "Hey Switchboard" keeps working with the app in
/// the background or the screen off. Android requires the permanent notification; it has a Stop button.
///
/// The listening itself stays in the app's main isolate (lib/voice/hands_free.dart): the service only
/// keeps the app alive and allowed to use the microphone. It has to be started while the app is on
/// screen (Android 14+ refuses to start microphone services from the background).
class BackgroundListening {
  static const _stopButton = 'stop';
  static VoidCallback? _onStop;
  static bool _initialised = false;

  static bool get supported => !kIsWeb && Platform.isAndroid;

  static void _init() {
    if (_initialised) return;
    _initialised = true;
    FlutterForegroundTask.initCommunicationPort();
    FlutterForegroundTask.init(
      androidNotificationOptions: AndroidNotificationOptions(
        channelId: 'hands_free',
        channelName: 'Hey Switchboard',
        channelDescription: 'Shown while Switchboard listens for its wake word',
        channelImportance: NotificationChannelImportance.LOW,
        priority: NotificationPriority.LOW,
        onlyAlertOnce: true,
      ),
      iosNotificationOptions: const IOSNotificationOptions(showNotification: false),
      foregroundTaskOptions: ForegroundTaskOptions(
        eventAction: ForegroundTaskEventAction.nothing(),
        allowWakeLock: true, // keep the CPU awake enough to hear the wake word with the screen off
        autoRunOnBoot: false, // Android doesn't allow microphone services to start at boot
        stopWithTask: true, // swiping the app away stops listening: the user expects that
      ),
    );
    FlutterForegroundTask.addTaskDataCallback((data) {
      if (data == _stopButton) _onStop?.call();
    });
  }

  static Future<void> start(String phrase, {required VoidCallback onStop}) async {
    if (!supported) return;
    _init();
    _onStop = onStop;
    final permission = await FlutterForegroundTask.checkNotificationPermission();
    if (permission != NotificationPermission.granted) {
      await FlutterForegroundTask.requestNotificationPermission();
    }
    if (await FlutterForegroundTask.isRunningService) return;
    await FlutterForegroundTask.startService(
      serviceId: 410,
      serviceTypes: [ForegroundServiceTypes.microphone],
      notificationTitle: 'Listening for “$phrase”',
      notificationText: 'Say “$phrase”, then what to do',
      notificationButtons: [const NotificationButton(id: _stopButton, text: 'Stop')],
      callback: _startCallback,
    );
  }

  /// Show the last answer in the notification (useful with the screen off).
  static Future<void> update(String phrase, String lastReply) async {
    if (!supported || !await FlutterForegroundTask.isRunningService) return;
    await FlutterForegroundTask.updateService(notificationTitle: 'Listening for “$phrase”', notificationText: lastReply);
  }

  static Future<void> stop() async {
    if (!supported) return;
    _onStop = null;
    if (await FlutterForegroundTask.isRunningService) await FlutterForegroundTask.stopService();
  }
}

@pragma('vm:entry-point')
void _startCallback() {
  FlutterForegroundTask.setTaskHandler(_KeepAlive());
}

/// Runs in the service's own isolate: does nothing but forward the notification's Stop button.
class _KeepAlive extends TaskHandler {
  @override
  Future<void> onStart(DateTime timestamp, TaskStarter starter) async {}

  @override
  void onRepeatEvent(DateTime timestamp) {}

  @override
  Future<void> onDestroy(DateTime timestamp, bool isTimeout) async {}

  @override
  void onNotificationButtonPressed(String id) => FlutterForegroundTask.sendDataToMain(id);

  @override
  void onNotificationPressed() => FlutterForegroundTask.launchApp();
}
