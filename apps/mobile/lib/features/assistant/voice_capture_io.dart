import 'dart:io';
import 'dart:math' as math;

import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';

import 'voice_capture.dart';

VoiceCapture createVoiceCapture() => _Recorder();

class _Recorder implements VoiceCapture {
  final _rec = AudioRecorder();
  String? _path;

  @override
  bool get supported => true;

  @override
  Stream<double> get level => _rec.onAmplitudeChanged(const Duration(milliseconds: 90)).map((a) {
    // dBFS (-60 quiet … 0 loud) → 0..1
    final db = a.current.isFinite ? a.current : -60;
    return math.max(0, math.min(1, (db + 60) / 60)).toDouble();
  });

  @override
  Future<bool> start() async {
    if (!await _rec.hasPermission()) return false;
    final dir = await getTemporaryDirectory();
    _path = '${dir.path}/ask_${DateTime.now().millisecondsSinceEpoch}.wav';
    await _rec.start(
      const RecordConfig(
        encoder: AudioEncoder.wav,
        sampleRate: 16000,
        numChannels: 1,
      ),
      path: _path!,
    );
    return true;
  }

  @override
  Future<List<int>?> stop() async {
    final path = await _rec.stop() ?? _path;
    if (path == null) return null;
    final file = File(path);
    if (!await file.exists()) return null;
    final bytes = await file.readAsBytes();
    await file.delete().catchError((_) => file);
    // a WAV header alone is 44 bytes: under ~0.2 s of sound is a mis-tap
    return bytes.length < 44 + 6400 ? null : bytes;
  }

  @override
  Future<void> cancel() async {
    await _rec.cancel();
  }

  @override
  void dispose() => _rec.dispose();
}
