import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../../core/network/api_exception.dart';
import '../models/json.dart';

/// The assistant's answer: what it says, the same read aloud (base64 WAV), and — for a voice
/// question — what it heard.
@immutable
class AssistantReply {
  const AssistantReply({required this.reply, this.audioBase64, this.heard});

  factory AssistantReply.fromJson(Json json) => AssistantReply(
    reply: str(json['reply']),
    audioBase64: strOrNull(json['audio']),
    heard: strOrNull(json['heard']),
  );

  final String reply;
  final String? audioBase64;
  final String? heard;
}

/// Ask Switchboard, typed or spoken (Urdu, English or both). It acts with this person's own rights
/// in the open home; what it switches arrives over the live connection like any other change.
///
/// [fresh] tells the server the app's chat is empty, so the assistant starts a new conversation and
/// remembers only what the person sees on screen.
class AssistantRepository {
  const AssistantRepository(this._api);
  final ApiClient _api;

  /// [speak]: also send the answer as audio.
  Future<AssistantReply> chat(String text, {bool speak = true, bool fresh = false}) async => AssistantReply.fromJson(
    asJson(await _api.post<Object?>('/assistant/chat', {'text': text, 'speak': speak, 'fresh': fresh})),
  );

  /// A spoken question as a WAV recording. [afterWake]: recorded straight after "Hey Switchboard"
  /// (hands-free), so the wake words may still be at its start.
  Future<AssistantReply> voice(List<int> wavBytes, {bool fresh = false, bool afterWake = false}) async {
    // ApiClient.upload sends only the file; the voice endpoint also takes plain form fields, so the
    // form is built here and sent through the same client (cookies, X-Home-Id and renewal included).
    final form = FormData.fromMap({
      'audio': MultipartFile.fromBytes(wavBytes, filename: 'speech.wav', contentType: DioMediaType('audio', 'wav')),
      'fresh': '$fresh',
      'afterWake': '$afterWake',
    });
    try {
      final res = await _api.dio.post<Object?>(
        '/assistant/voice',
        data: form,
        options: Options(
          contentType: 'multipart/form-data',
          // speech to text, the answer and text to speech take a while
          receiveTimeout: const Duration(seconds: 90),
        ),
      );
      return AssistantReply.fromJson(asJson(res.data));
    } catch (e) {
      throw ApiException.from(e);
    }
  }

  /// Forgets the conversation so far.
  Future<void> reset() => _api.post<Object?>('/assistant/reset');

  /// The reply's audio as bytes; null when there's none or it isn't valid base64.
  static List<int>? decodeAudio(String? base64Audio) {
    if (base64Audio == null || base64Audio.isEmpty) return null;
    // tolerate a data URL ("data:audio/wav;base64,…")
    final data = base64Audio.startsWith('data:') ? base64Audio.substring(base64Audio.indexOf(',') + 1) : base64Audio;
    try {
      final bytes = base64Decode(data.trim());
      return bytes.isEmpty ? null : bytes;
    } on FormatException {
      return null;
    }
  }
}

final assistantRepositoryProvider = Provider<AssistantRepository>(
  (ref) => AssistantRepository(ref.watch(apiClientProvider)),
);
