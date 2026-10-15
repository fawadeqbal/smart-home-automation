import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:switchboard_home/voice/engine.dart';

/// Stands in for an ONNX model: checks the shapes it is given and answers with fixed values.
class FakeModel implements OnnxModel {
  FakeModel(this.name, this.answer);
  final String name;
  final Float32List Function(Float32List input, List<int> shape) answer;
  final shapes = <List<int>>[];
  final inputs = <Float32List>[];

  @override
  List<String> get inputNames => [name];

  @override
  Future<Float32List> run(Map<String, ({Float32List data, List<int> shape})> inputs) async {
    final i = inputs[name]!;
    expect(i.data.length, i.shape.reduce((a, b) => a * b), reason: '$name: data and shape disagree');
    shapes.add(i.shape);
    this.inputs.add(i.data);
    return answer(i.data, i.shape);
  }

  @override
  Future<void> close() async {}
}

class FakeVad implements VadModel {
  FakeVad(this.probs);
  final List<double> probs;
  int calls = 0;

  @override
  Future<(double, Float32List)> run(Float32List input, Float32List state) async {
    expect(input.length, 576);
    expect(state.length, 256);
    final p = calls < probs.length ? probs[calls] : 0.0;
    calls++;
    return (p, Float32List(256)..[0] = calls.toDouble());
  }

  @override
  Future<void> close() async {}
}

void main() {
  late FakeModel mel, emb, cls;
  var score = 0.0;

  WakeWord make({double threshold = .5, int patience = 1}) {
    mel = FakeModel('input', (x, s) => Float32List(8 * 32)..fillRange(0, 256, 10)); // 8 frames of 10 -> 3 after /10+2
    emb = FakeModel('input_1', (x, s) => Float32List(96)..fillRange(0, 96, .5));
    cls = FakeModel('x.1', (x, s) => Float32List.fromList([score]));
    return WakeWord(mel, emb, cls, threshold: threshold, patience: patience);
  }

  test('80 ms steps: mel gets 480 samples of context, embeddings 76 frames, the classifier 16 embeddings', () async {
    score = 0;
    final w = make();
    // 15 chunks: not enough embeddings yet, the classifier is not asked
    for (var i = 0; i < 15; i++) {
      await w.push(Float32List(chunkSamples));
    }
    expect(cls.shapes, isEmpty);
    expect(mel.shapes.first, [1, 1760]);
    expect(emb.shapes.first, [1, 76, 32, 1]);
    await w.push(Float32List(chunkSamples));
    expect(cls.shapes.single, [1, 16, 96]);
    // the embedding window ends with the newest mel frames, transformed as openWakeWord does (x/10 + 2)
    expect(emb.inputs.last.last, closeTo(3.0, 1e-6));
  });

  test('audio is scaled to int16 values and leftovers wait for the next push', () async {
    score = 0;
    final w = make();
    await w.push(Float32List(1000)..fillRange(0, 1000, .5));
    expect(mel.shapes, isEmpty); // under 1280 samples: nothing yet
    await w.push(Float32List(280)..fillRange(0, 280, .5));
    expect(mel.inputs.single[480], closeTo(16384, 1)); // 0.5 * 32767, after the 480 samples of context
  });

  test('the wake word fires once above the threshold, then cools down', () async {
    final w = make(threshold: .5);
    score = .1;
    for (var i = 0; i < 16; i++) {
      await w.push(Float32List(chunkSamples));
    }
    score = .9;
    final now = DateTime(2026);
    expect((await w.push(Float32List(chunkSamples), now: now))!.detected, isTrue);
    expect((await w.push(Float32List(chunkSamples), now: now.add(const Duration(milliseconds: 80))))!.detected, isFalse);
    expect((await w.push(Float32List(chunkSamples), now: now.add(const Duration(seconds: 3))))!.detected, isTrue);
  });

  test('patience: two steps in a row are needed when asked', () async {
    final w = make(patience: 2);
    score = .9;
    final results = <bool>[];
    for (var i = 0; i < 18; i++) {
      results.add((await w.push(Float32List(chunkSamples), now: DateTime(2026)))!.detected);
    }
    expect(results.indexOf(true), 16); // the 16th and 17th steps (0-based 15, 16)
  });

  test('VAD: 512-sample windows with 64 samples of context, state carried over', () async {
    final vad = Vad(FakeVad([.1, .9, .8]));
    final probs = await vad.push(Float32List(1300));
    expect(probs, [.1, .9]); // 1300 samples = two windows, 276 left over
    expect((await vad.push(Float32List(300))), [.8]);
  });

  test('end of speech: waits for speech, ends after the silence, or gives up', () {
    final ep = Endpointer();
    final silence = List.filled(10, 0.0);
    expect(silence.map(ep.feed).toList().last, EndpointState.waiting);
    final speech = List.filled(12, .9).map(ep.feed).toList();
    expect(speech.last, EndpointState.speaking);
    final after = List.filled(30, 0.0).map(ep.feed).toList();
    expect(after.contains(EndpointState.done), isTrue);
    expect(after.indexOf(EndpointState.done), 24); // 25 * 32 ms = 800 ms of silence

    final nothing = Endpointer(startTimeout: const Duration(seconds: 1));
    expect(List.filled(40, .1).map(nothing.feed).toList().last, EndpointState.nothing);
  });

  test('a cough is not a request: speech must last a quarter second', () {
    final ep = Endpointer();
    for (final p in [.9, .9, .9, .1, .1]) {
      ep.feed(p);
    }
    expect(ep.started, isFalse);
  });

  test('WAV and PCM conversions', () {
    final wav = toWav(Float32List.fromList([0, .5, -1]));
    expect(String.fromCharCodes(wav.sublist(0, 4)), 'RIFF');
    expect(ByteData.sublistView(wav).getUint32(24, Endian.little), 16000);
    expect(wav.length, 44 + 6);
    final back = pcm16ToFloat(Uint8List.sublistView(wav, 44));
    expect(back[1], closeTo(.5, 1e-3));
    expect(back[2], closeTo(-1, 1e-3));
  });
}
