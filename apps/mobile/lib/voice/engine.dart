import 'dart:math' as math;
import 'dart:typed_data';

/// Hands-free voice engine, on the phone: nothing leaves it until the wake word is heard.
///
///  [WakeWord]   openWakeWord's streaming pipeline (a port of openwakeword/utils.py AudioFeatures, the
///               same as the web app's public/voice/engine.mjs): 16 kHz audio in 80 ms chunks ->
///               melspectrogram -> speech embedding -> the wake-word classifier over the last 16
///               embeddings -> score 0..1.
///  [Vad]        Silero VAD (16 kHz, 512-sample windows): is someone speaking right now?
///  [Endpointer] when a spoken request has ended.
///
/// The models run behind [OnnxModel], so this file is plain Dart and testable without a phone.

const sampleRate = 16000;
const chunkSamples = 1280; // 80 ms: one step of openWakeWord

const _melBins = 32;
const _embWindow = 76; // mel frames per embedding
const _features = 16; // embeddings the classifier looks at (1.28 s)
const _melContext = 160 * 3; // extra samples before each chunk, as in openWakeWord

/// One ONNX model: named float inputs in, the first output out (flattened).
abstract class OnnxModel {
  List<String> get inputNames;
  Future<Float32List> run(Map<String, ({Float32List data, List<int> shape})> inputs);
  Future<void> close();
}

/// Silero needs an int64 sample-rate input and returns its state: it gets its own small interface.
abstract class VadModel {
  /// [input] 576 samples (64 of context + 512), [state] 2*1*128. Returns (probability, new state).
  Future<(double, Float32List)> run(Float32List input, Float32List state);
  Future<void> close();
}

class WakeResult {
  const WakeResult(this.score, this.detected);
  final double score;
  final bool detected;
}

class WakeWord {
  WakeWord(this.mel, this.embedding, this.classifier,
      {this.threshold = 0.5, this.patience = 1, this.cooldown = const Duration(seconds: 2)}) {
    reset();
  }

  final OnnxModel mel;
  final OnnxModel embedding;
  final OnnxModel classifier;
  double threshold;
  final int patience; // 80 ms steps in a row above the threshold
  final Duration cooldown;

  late Float32List _raw; // int16-scale samples not yet turned into features
  late Float32List _tail; // the samples before the next chunk
  late List<Float32List> _melFrames;
  late List<Float32List> _embeddings;
  int _hits = 0;
  DateTime _coolUntil = DateTime.fromMillisecondsSinceEpoch(0);
  double lastScore = 0;

  /// Forget everything heard so far (after a detection, or when listening starts again).
  void reset() {
    _raw = Float32List(0);
    _tail = Float32List(_melContext);
    _melFrames = List.generate(_embWindow, (_) => Float32List(_melBins)..fillRange(0, _melBins, 1));
    _embeddings = [];
    _hits = 0;
    lastScore = 0;
  }

  /// Feed audio (-1..1 at 16 kHz, any length). Returns the result of the last full 80 ms step, if any.
  Future<WakeResult?> push(Float32List audio, {DateTime? now}) async {
    final all = Float32List(_raw.length + audio.length)..setAll(0, _raw);
    for (var i = 0; i < audio.length; i++) {
      all[_raw.length + i] = (audio[i] * 32767).roundToDouble().clamp(-32768, 32767);
    }
    var offset = 0;
    WakeResult? result;
    while (all.length - offset >= chunkSamples) {
      final chunk = Float32List.sublistView(all, offset, offset + chunkSamples);
      offset += chunkSamples;
      result = await _step(chunk, now ?? DateTime.now());
    }
    _raw = Float32List.fromList(Float32List.sublistView(all, offset));
    return result;
  }

  Future<WakeResult> _step(Float32List chunk, DateTime now) async {
    // melspectrogram of the chunk plus 480 samples of context: 8 new frames
    final input = Float32List(_melContext + chunkSamples)
      ..setAll(0, _tail)
      ..setAll(_melContext, chunk);
    _tail = Float32List.fromList(Float32List.sublistView(chunk, chunkSamples - _melContext));
    final spec = await mel.run({
      mel.inputNames.first: (data: input, shape: [1, input.length]),
    });
    final frames = spec.length ~/ _melBins;
    for (var t = 0; t < frames; t++) {
      final f = Float32List(_melBins);
      for (var b = 0; b < _melBins; b++) {
        f[b] = spec[t * _melBins + b] / 10 + 2; // openWakeWord's transform
      }
      _melFrames.add(f);
    }
    if (_melFrames.length > 970) _melFrames.removeRange(0, _melFrames.length - 970);

    // one embedding from the last 76 mel frames
    final window = Float32List(_embWindow * _melBins);
    final start = _melFrames.length - _embWindow;
    for (var t = 0; t < _embWindow; t++) {
      window.setAll(t * _melBins, _melFrames[start + t]);
    }
    final emb = await embedding.run({
      embedding.inputNames.first: (data: window, shape: [1, _embWindow, _melBins, 1]),
    });
    _embeddings.add(Float32List.fromList(emb));
    if (_embeddings.length > _features) _embeddings.removeAt(0);
    if (_embeddings.length < _features) return const WakeResult(0, false);

    final feats = Float32List(_features * 96);
    for (var i = 0; i < _features; i++) {
      feats.setAll(i * 96, _embeddings[i]);
    }
    final out = await classifier.run({
      classifier.inputNames.first: (data: feats, shape: [1, _features, 96]),
    });
    final score = out.first;
    lastScore = score;
    if (now.isBefore(_coolUntil)) return WakeResult(score, false);
    _hits = score >= threshold ? _hits + 1 : 0;
    if (_hits >= patience) {
      _hits = 0;
      _coolUntil = now.add(cooldown);
      return WakeResult(score, true);
    }
    return WakeResult(score, false);
  }

  Future<void> close() async {
    await mel.close();
    await embedding.close();
    await classifier.close();
  }
}

class Vad {
  Vad(this.model) {
    reset();
  }

  final VadModel model;
  late Float32List _state;
  late Float32List _context; // Silero v5 expects the previous 64 samples before each window
  late Float32List _pending;

  void reset() {
    _state = Float32List(2 * 128);
    _context = Float32List(64);
    _pending = Float32List(0);
  }

  /// Feed audio; returns the speech probability (0..1) of each 32 ms window completed.
  Future<List<double>> push(Float32List audio) async {
    final all = Float32List(_pending.length + audio.length)
      ..setAll(0, _pending)
      ..setAll(_pending.length, audio);
    final probs = <double>[];
    var offset = 0;
    while (all.length - offset >= 512) {
      final win = Float32List.sublistView(all, offset, offset + 512);
      offset += 512;
      final input = Float32List(576)
        ..setAll(0, _context)
        ..setAll(64, win);
      _context = Float32List.fromList(Float32List.sublistView(win, 448));
      final (p, state) = await model.run(input, _state);
      _state = state;
      probs.add(p);
    }
    _pending = Float32List.fromList(Float32List.sublistView(all, offset));
    return probs;
  }
}

enum EndpointState { waiting, speaking, done, nothing }

/// Decides when a spoken request has ended: speech must start within [startTimeout], and it ends after
/// [endSilence] of silence (or at [maxLength]). Fed with [Vad] probabilities, one per 32 ms.
class Endpointer {
  Endpointer({
    this.startTimeout = const Duration(seconds: 5),
    this.endSilence = const Duration(milliseconds: 800),
    this.maxLength = const Duration(seconds: 12),
    this.minSpeech = const Duration(milliseconds: 250),
  });

  final Duration startTimeout;
  final Duration endSilence;
  final Duration maxLength;
  final Duration minSpeech;
  int _elapsed = 0;
  int _speech = 0;
  int _silence = 0;
  bool started = false;

  EndpointState feed(double prob) {
    const ms = 32;
    _elapsed += ms;
    // hysteresis: start at 0.5, keep going down to 0.35, like Silero's own helper
    final voiced = prob >= (started ? 0.35 : 0.5);
    if (voiced) {
      _speech += ms;
      _silence = 0;
      if (_speech >= minSpeech.inMilliseconds) started = true;
    } else {
      _silence += ms;
      if (!started) _speech = math.max(0, _speech - ms);
    }
    if (started && (_silence >= endSilence.inMilliseconds || _elapsed >= maxLength.inMilliseconds)) {
      return EndpointState.done;
    }
    if (!started && _elapsed >= startTimeout.inMilliseconds) return EndpointState.nothing;
    return started ? EndpointState.speaking : EndpointState.waiting;
  }
}

/// 16 kHz mono samples -> a WAV file (what /api/assistant/voice accepts).
Uint8List toWav(Float32List samples, {int rate = sampleRate}) {
  final bytes = ByteData(44 + samples.length * 2);
  void str(int o, String s) {
    for (var i = 0; i < s.length; i++) {
      bytes.setUint8(o + i, s.codeUnitAt(i));
    }
  }

  str(0, 'RIFF');
  bytes.setUint32(4, 36 + samples.length * 2, Endian.little);
  str(8, 'WAVE');
  str(12, 'fmt ');
  bytes.setUint32(16, 16, Endian.little);
  bytes.setUint16(20, 1, Endian.little);
  bytes.setUint16(22, 1, Endian.little);
  bytes.setUint32(24, rate, Endian.little);
  bytes.setUint32(28, rate * 2, Endian.little);
  bytes.setUint16(32, 2, Endian.little);
  bytes.setUint16(34, 16, Endian.little);
  str(36, 'data');
  bytes.setUint32(40, samples.length * 2, Endian.little);
  for (var i = 0; i < samples.length; i++) {
    bytes.setInt16(44 + i * 2, (samples[i].clamp(-1.0, 1.0) * 32767).round(), Endian.little);
  }
  return bytes.buffer.asUint8List();
}

/// PCM16 little-endian bytes (what the microphone stream gives) -> -1..1 floats.
Float32List pcm16ToFloat(Uint8List bytes) {
  final data = ByteData.sublistView(bytes);
  final out = Float32List(bytes.length ~/ 2);
  for (var i = 0; i < out.length; i++) {
    out[i] = data.getInt16(i * 2, Endian.little) / 32768;
  }
  return out;
}
