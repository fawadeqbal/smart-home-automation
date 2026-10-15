import 'voice_capture_stub.dart' if (dart.library.io) 'voice_capture_io.dart' as impl;

/// Records what someone says (16 kHz mono WAV, what the assistant's speech recognition wants).
abstract class VoiceCapture {
  /// False where the app can't record (the web build: it uses typing; the web app has its own voice).
  bool get supported;

  /// Loudness 0..1 while recording, for the wave.
  Stream<double> get level;

  /// Asks for the microphone if needed. False when it was refused.
  Future<bool> start();

  /// The recording, or null when nothing was captured.
  Future<List<int>?> stop();

  Future<void> cancel();
  void dispose();

  static VoiceCapture create() => impl.createVoiceCapture();
}
