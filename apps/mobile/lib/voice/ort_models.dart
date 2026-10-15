import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/services.dart';
import 'package:flutter_onnxruntime/flutter_onnxruntime.dart';

import 'engine.dart';

/// The engine's models on ONNX Runtime (native on Android/iOS, through flutter_onnxruntime).
/// Every tensor lives in native memory until disposed: each run frees what it made.
class OrtModel implements OnnxModel {
  OrtModel._(this._session);

  final OrtSession _session;

  static Future<OrtModel> asset(OnnxRuntime ort, String key) async =>
      OrtModel._(await ort.createSessionFromAsset(key, options: _options));

  @override
  List<String> get inputNames => _session.inputNames;

  @override
  Future<Float32List> run(Map<String, ({Float32List data, List<int> shape})> inputs) async {
    final values = <String, OrtValue>{
      for (final e in inputs.entries) e.key: await OrtValue.fromList(e.value.data, e.value.shape),
    };
    Map<String, OrtValue> outputs = const {};
    try {
      outputs = await _session.run(values);
      final first = outputs[_session.outputNames.first]!;
      return _floats(await first.asFlattenedList());
    } finally {
      for (final v in [...values.values, ...outputs.values]) {
        await v.dispose();
      }
    }
  }

  @override
  Future<void> close() => _session.close();
}

class OrtVad implements VadModel {
  OrtVad._(this._session);

  final OrtSession _session;

  static Future<OrtVad> asset(OnnxRuntime ort, String key) async =>
      OrtVad._(await ort.createSessionFromAsset(key, options: _options));

  @override
  Future<(double, Float32List)> run(Float32List input, Float32List state) async {
    final values = <String, OrtValue>{
      'input': await OrtValue.fromList(input, [1, input.length]),
      'state': await OrtValue.fromList(state, [2, 1, 128]),
      // the 16 kHz sample rate is built into our silero_vad.onnx
    };
    Map<String, OrtValue> outputs = const {};
    try {
      outputs = await _session.run(values);
      final prob = _floats(await outputs['output']!.asFlattenedList()).first;
      final next = _floats(await outputs['stateN']!.asFlattenedList());
      return (prob, next);
    } finally {
      for (final v in [...values.values, ...outputs.values]) {
        await v.dispose();
      }
    }
  }

  @override
  Future<void> close() => _session.close();
}

final _options = OrtSessionOptions(intraOpNumThreads: 1, interOpNumThreads: 1);

Float32List _floats(List<dynamic> list) =>
    list is Float32List ? list : Float32List.fromList([for (final x in list) (x as num).toDouble()]);

/// Loads the wake-word models bundled under assets/voice/. Null when the app was built without a
/// wake-word model (the hands-free switch then stays hidden).
Future<({WakeWord wake, Vad vad, String phrase})?> loadVoiceEngine() async {
  final config = await _config();
  if (config == null) return null;
  final ort = OnnxRuntime();
  final models = await Future.wait([
    OrtModel.asset(ort, 'assets/voice/melspectrogram.onnx'),
    OrtModel.asset(ort, 'assets/voice/embedding_model.onnx'),
    OrtModel.asset(ort, 'assets/voice/${config.model}'),
  ]);
  final vad = await OrtVad.asset(ort, 'assets/voice/silero_vad.onnx');
  return (
    wake: WakeWord(models[0], models[1], models[2], threshold: config.threshold),
    vad: Vad(vad),
    phrase: config.phrase,
  );
}

Future<({String phrase, String model, double threshold})?> _config() async {
  try {
    final raw = await rootBundle.loadString('assets/voice/wake.json');
    final json = jsonDecode(raw) as Map<String, dynamic>;
    final model = json['model'] as String?;
    if (model == null) return null;
    await rootBundle.load('assets/voice/$model'); // throws when the model isn't in this build
    return (
      phrase: (json['phrase'] as String?) ?? 'Hey Switchboard',
      model: model,
      threshold: ((json['threshold'] as num?) ?? 0.5).toDouble(),
    );
  } catch (_) {
    return null;
  }
}
