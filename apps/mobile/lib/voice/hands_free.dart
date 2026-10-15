import 'dart:async';
import 'dart:math' as math;

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:record/record.dart';

import '../core/config/app_settings.dart';
import '../features/assistant/assistant_controller.dart';
import 'background_service.dart';
import 'engine.dart';
import 'ort_models.dart';

/// "Hey Switchboard" on the phone, like the web app: the microphone stays open while it's on, the wake
/// word is recognised on the phone, and only the request said after it goes to the server.
///
///   waiting --(wake word)--> listening --(speech)--> hearing --(silence)--> thinking --> speaking
///
/// On Android it can keep listening with the app in the background or the screen off: a foreground
/// service (with its notification) keeps the app alive and allowed to use the microphone.

enum HandsFreeStage { off, starting, waiting, listening, hearing, thinking, speaking, unavailable, denied, error }

@immutable
class HandsFreeState {
  const HandsFreeState({
    this.stage = HandsFreeStage.off,
    this.phrase = 'Hey Switchboard',
    this.available = false,
    this.enabled = false,
    this.background = false,
    this.level = 0,
    this.heard,
    this.reply,
    this.error,
  });

  final HandsFreeStage stage;
  final String phrase;

  /// This build has a wake-word model (otherwise the switch stays hidden).
  final bool available;
  final bool enabled;

  /// Android: keep listening with the app in the background.
  final bool background;
  final double level;
  final String? heard;
  final String? reply;
  final String? error;

  /// A request is in progress: the overlay shows it.
  bool get active => const {
    HandsFreeStage.listening,
    HandsFreeStage.hearing,
    HandsFreeStage.thinking,
    HandsFreeStage.speaking,
  }.contains(stage);

  HandsFreeState copyWith({
    HandsFreeStage? stage,
    String? phrase,
    bool? available,
    bool? enabled,
    bool? background,
    double? level,
    String? heard,
    String? reply,
    String? error,
    bool clearTexts = false,
  }) => HandsFreeState(
    stage: stage ?? this.stage,
    phrase: phrase ?? this.phrase,
    available: available ?? this.available,
    enabled: enabled ?? this.enabled,
    background: background ?? this.background,
    level: level ?? this.level,
    heard: clearTexts ? null : (heard ?? this.heard),
    reply: clearTexts ? null : (reply ?? this.reply),
    error: error,
  );
}

enum _Mode { idle, wake, capture }

class HandsFreeController extends Notifier<HandsFreeState> {
  static const _enabledKey = 'hands_free';
  static const _backgroundKey = 'hands_free_background';

  ({WakeWord wake, Vad vad, String phrase})? _engine;
  AudioRecorder? _recorder;
  StreamSubscription<Uint8List>? _mic;
  AudioPlayer? _voice;
  AudioPlayer? _chimes;
  AppLifecycleListener? _lifecycle;

  _Mode _mode = _Mode.idle;
  Future<void> _queue = Future.value();
  int _pending = 0;
  final _recent = <Float32List>[]; // the last second: a request said in one breath with the wake word
  final _recorded = <Float32List>[];
  Endpointer? _endpointer;
  bool _spoke = false;
  bool _afterWake = false;
  bool _paused = false;
  Timer? _linger;

  @override
  HandsFreeState build() {
    final prefs = ref.read(sharedPrefsProvider);
    ref.onDispose(_shutdown);
    _lifecycle = AppLifecycleListener(onStateChange: _onLifecycle);
    final initial = HandsFreeState(
      enabled: prefs.getBool(_enabledKey) ?? false,
      background: prefs.getBool(_backgroundKey) ?? false,
    );
    // is there a wake-word model in this build? (loads the models once; they are small)
    Future.microtask(() async {
      if (kIsWeb) return; // the web app has its own hands-free
      _engine = await loadVoiceEngine();
      final engine = _engine;
      if (engine == null) {
        state = state.copyWith(available: false, stage: HandsFreeStage.unavailable);
        return;
      }
      state = state.copyWith(available: true, phrase: engine.phrase);
      if (state.enabled) await _start();
    });
    return initial;
  }

  // ---------------------------------------------------------------- the switches

  Future<void> setEnabled(bool on) async {
    await ref.read(sharedPrefsProvider).setBool(_enabledKey, on);
    state = state.copyWith(enabled: on);
    if (on) {
      await _start();
    } else {
      await _stop();
    }
  }

  /// Android only: keep listening when the app is in the background or the screen is off.
  Future<void> setBackground(bool on) async {
    await ref.read(sharedPrefsProvider).setBool(_backgroundKey, on);
    state = state.copyWith(background: on);
    if (on && state.enabled && _mic != null) {
      await BackgroundListening.start(state.phrase, onStop: () => setEnabled(false));
    } else if (!on) {
      await BackgroundListening.stop();
    }
  }

  /// The overlay's close button: stop this exchange, go back to waiting for the wake word.
  void dismiss() {
    _linger?.cancel();
    _voice?.stop();
    _listenForWake();
  }

  /// Tap-to-talk on the Ask screen needs the microphone to itself.
  Future<void> pause() async {
    _paused = true;
    await _closeMic();
  }

  Future<void> resume() async {
    _paused = false;
    if (state.enabled) await _openMic();
  }

  // ---------------------------------------------------------------- microphone

  Future<void> _start() async {
    if (_engine == null) {
      state = state.copyWith(stage: HandsFreeStage.unavailable);
      return;
    }
    state = state.copyWith(stage: HandsFreeStage.starting);
    if (!await _openMic()) return;
    if (state.background) {
      await BackgroundListening.start(state.phrase, onStop: () => setEnabled(false));
    }
  }

  Future<void> _stop() async {
    _linger?.cancel();
    await BackgroundListening.stop();
    await _closeMic();
    await _voice?.stop();
    state = state.copyWith(stage: HandsFreeStage.off, clearTexts: true, level: 0);
  }

  Future<bool> _openMic() async {
    if (_mic != null || _paused) return true;
    _recorder ??= AudioRecorder();
    if (!await _recorder!.hasPermission()) {
      state = state.copyWith(stage: HandsFreeStage.denied);
      return false;
    }
    try {
      final stream = await _recorder!.startStream(
        const RecordConfig(
          encoder: AudioEncoder.pcm16bits,
          sampleRate: sampleRate,
          numChannels: 1,
          echoCancel: true, // its own answers must not wake it
          noiseSuppress: true,
          androidConfig: AndroidRecordConfig(audioSource: AndroidAudioSource.voiceRecognition, manageBluetooth: false),
        ),
      );
      _mic = stream.listen(_onAudio, onError: (Object e) => _fail('The microphone stopped: $e'));
      _listenForWake();
      return true;
    } catch (e) {
      _fail('Couldn’t open the microphone: $e');
      return false;
    }
  }

  Future<void> _closeMic() async {
    await _mic?.cancel();
    _mic = null;
    try {
      await _recorder?.stop();
    } catch (_) {}
    _mode = _Mode.idle;
  }

  void _onLifecycle(AppLifecycleState s) {
    if (!state.enabled || _engine == null) return;
    // without background listening the microphone is released when the app is left
    if (s == AppLifecycleState.paused && !state.background) {
      unawaited(_closeMic());
      state = state.copyWith(stage: HandsFreeStage.off);
    } else if (s == AppLifecycleState.resumed && _mic == null && !_paused) {
      unawaited(_start());
    }
  }

  // ---------------------------------------------------------------- audio -> wake word -> request

  void _onAudio(Uint8List bytes) {
    final samples = pcm16ToFloat(bytes);
    // keep up with the microphone: if the phone falls behind, drop audio rather than lag seconds behind
    if (_pending > 25 && _mode == _Mode.wake) return;
    _pending++;
    _queue = _queue.then((_) => _process(samples)).whenComplete(() => _pending--).catchError((Object e) {
      debugPrint('hands-free: $e');
    });
  }

  Future<void> _process(Float32List samples) async {
    final engine = _engine;
    if (engine == null) return;
    _recent.add(samples);
    var total = 0;
    for (final c in _recent) {
      total += c.length;
    }
    while (total > sampleRate && _recent.length > 1) {
      total -= _recent.removeAt(0).length;
    }

    if (_mode == _Mode.wake) {
      final r = await engine.wake.push(samples);
      if (r != null && r.detected && _mode == _Mode.wake) _onWake();
    } else if (_mode == _Mode.capture) {
      _recorded.add(samples);
      var peak = 0.0;
      for (var i = 0; i < samples.length; i += 4) {
        peak = math.max(peak, samples[i].abs());
      }
      state = state.copyWith(level: math.min(1, peak * 3));
      for (final p in await engine.vad.push(samples)) {
        final s = _endpointer!.feed(p);
        if (s == EndpointState.speaking && !_spoke) {
          _spoke = true;
          state = state.copyWith(stage: HandsFreeStage.hearing);
        }
        if (s == EndpointState.done) return _finish(true);
        if (s == EndpointState.nothing) return _finish(false);
      }
    }
  }

  /// Listen for the wake word again (and show that, unless an answer is still on its way).
  void _listenForWake() {
    _armWake();
    if (state.enabled && _mic != null) {
      state = state.copyWith(stage: HandsFreeStage.waiting, level: 0);
    }
  }

  void _armWake() {
    _engine?.wake.reset();
    _mode = _Mode.wake;
  }

  void _onWake() {
    _linger?.cancel();
    _voice?.stop(); // "Hey Switchboard" interrupts an answer
    unawaited(_chime(up: true));
    state = state.copyWith(stage: HandsFreeStage.listening, clearTexts: true);
    _capture(afterWake: true, preRoll: const Duration(milliseconds: 160));
  }

  Future<void> _capture({required bool afterWake, Duration preRoll = Duration.zero, Duration timeout = const Duration(seconds: 5)}) async {
    final engine = _engine!;
    _afterWake = afterWake;
    engine.vad.reset();
    _endpointer = Endpointer(startTimeout: timeout);
    _spoke = false;
    _recorded.clear();
    final chunks = (preRoll.inMilliseconds / 80).round();
    if (chunks > 0) {
      final pre = _recent.sublist(math.max(0, _recent.length - chunks));
      _recorded.addAll(pre);
      // the pre-roll warms the detector but doesn't count: it holds the wake word itself
      for (final c in pre) {
        await engine.vad.push(c);
      }
    }
    _mode = _Mode.capture;
  }

  Future<void> _finish(bool gotSpeech) async {
    _mode = _Mode.idle;
    if (!gotSpeech) {
      _recorded.clear();
      unawaited(_chime(up: false));
      _listenForWake();
      return;
    }
    var n = 0;
    for (final c in _recorded) {
      n += c.length;
    }
    final all = Float32List(n);
    var o = 0;
    for (final c in _recorded) {
      all.setAll(o, c);
      o += c.length;
    }
    _recorded.clear();
    // while it works and answers, the wake word can interrupt
    _armWake();
    state = state.copyWith(stage: HandsFreeStage.thinking, level: 0);
    unawaited(_ask(toWav(all)));
  }

  Future<void> _ask(Uint8List wav) async {
    final answer = await ref.read(assistantProvider.notifier).askHandsFree(wav, afterWake: _afterWake);
    if (state.stage != HandsFreeStage.thinking) return; // interrupted by a new wake word, or turned off
    if (answer == null) {
      unawaited(_chime(up: false));
      state = state.copyWith(stage: HandsFreeStage.waiting, error: 'The assistant isn’t available right now.');
      return;
    }
    state = state.copyWith(stage: HandsFreeStage.speaking, heard: answer.heard, reply: answer.reply);
    unawaited(BackgroundListening.update(state.phrase, answer.reply));
    if (answer.audio != null) {
      _voice ??= AudioPlayer();
      final done = _voice!.onPlayerComplete.first;
      try {
        await _voice!.play(BytesSource(Uint8List.fromList(answer.audio!), mimeType: 'audio/wav'));
        await done.timeout(const Duration(seconds: 30));
      } catch (_) {}
    }
    if (state.stage != HandsFreeStage.speaking) return;
    if (RegExp(r'[?؟]\s*$').hasMatch(answer.reply)) {
      // it asked something ("which light?"): listen for the answer without the wake word
      unawaited(_chime(up: true));
      state = state.copyWith(stage: HandsFreeStage.listening);
      await _capture(afterWake: false, timeout: const Duration(seconds: 6));
    } else {
      _linger = Timer(const Duration(milliseconds: 2500), () {
        if (state.stage == HandsFreeStage.speaking) _listenForWake();
      });
    }
  }

  void _fail(String message) {
    state = state.copyWith(stage: HandsFreeStage.error, error: message);
  }

  // ---------------------------------------------------------------- sounds

  Future<void> _chime({required bool up}) async {
    if (_chimes == null) {
      _chimes = AudioPlayer();
      await _chimes!.setPlayerMode(PlayerMode.lowLatency);
    }
    try {
      await _chimes!.play(BytesSource(up ? _upTone : _downTone, mimeType: 'audio/wav'));
    } catch (_) {}
  }

  static final _upTone = _tones([660, 990]);
  static final _downTone = _tones([520, 390]);

  static Uint8List _tones(List<double> freqs) {
    const step = 0.09, len = 0.16;
    final total = ((step * (freqs.length - 1) + len) * sampleRate).ceil();
    final out = Float32List(total);
    for (var n = 0; n < freqs.length; n++) {
      final start = (n * step * sampleRate).round();
      for (var i = 0; i < (len * sampleRate).round() && start + i < total; i++) {
        final t = i / sampleRate;
        final env = math.min(1.0, t / 0.015) * math.exp(-t * 28);
        out[start + i] += 0.18 * env * math.sin(2 * math.pi * freqs[n] * t);
      }
    }
    return toWav(out);
  }

  Future<void> _shutdown() async {
    _linger?.cancel();
    _lifecycle?.dispose();
    await _closeMic();
    await _recorder?.dispose();
    await _voice?.dispose();
    await _chimes?.dispose();
    await _engine?.wake.close();
  }
}

final handsFreeProvider = NotifierProvider<HandsFreeController, HandsFreeState>(HandsFreeController.new);
