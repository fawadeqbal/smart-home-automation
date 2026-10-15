import 'voice_capture.dart';

VoiceCapture createVoiceCapture() => _NoVoice();

class _NoVoice implements VoiceCapture {
  @override
  bool get supported => false;
  @override
  Stream<double> get level => const Stream.empty();
  @override
  Future<bool> start() async => false;
  @override
  Future<List<int>?> stop() async => null;
  @override
  Future<void> cancel() async {}
  @override
  void dispose() {}
}
