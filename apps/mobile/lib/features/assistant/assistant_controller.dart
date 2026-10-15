import 'dart:async';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/config/app_settings.dart';
import '../../core/network/api_exception.dart';
import '../../data/repositories/assistant_repository.dart';
import '../../state/devices.dart';
import '../../state/session.dart';

@immutable
class ChatMessage {
  const ChatMessage(this.text, {required this.mine, this.error = false});
  final String text;
  final bool mine;
  final bool error;
}

enum AskPhase { idle, listening, thinking }

@immutable
class AskState {
  const AskState({
    this.messages = const [],
    this.phase = AskPhase.idle,
    this.speak = true,
  });
  final List<ChatMessage> messages;
  final AskPhase phase;

  /// Read answers out loud.
  final bool speak;

  AskState copyWith({
    List<ChatMessage>? messages,
    AskPhase? phase,
    bool? speak,
  }) => AskState(
    messages: messages ?? this.messages,
    phase: phase ?? this.phase,
    speak: speak ?? this.speak,
  );
}

/// The conversation with the assistant: typed or spoken, in Urdu or English. What it switches
/// shows up in the app by itself (the live connection), so this only keeps the conversation.
///
/// It is the signed-in person's own conversation in the open home: switching home or account starts
/// an empty one, and the first message of an empty chat also clears the assistant's memory on the
/// server, so the AI remembers exactly what is on the screen.
class AssistantController extends Notifier<AskState> {
  static const _speakKey = 'assistant_speak';
  AudioPlayer? _player;
  bool _fresh = true;

  @override
  AskState build() {
    // a new person or a new home is a new conversation (this rebuilds with no messages)
    ref.watch(sessionProvider.select((s) => s.value?.id));
    ref.watch(currentHomeIdProvider);
    _fresh = true;
    ref.onDispose(() {
      _player?.dispose();
      _player = null;
    });
    return AskState(
      speak: ref.read(sharedPrefsProvider).getBool(_speakKey) ?? !kIsWeb,
    );
  }

  void _add(ChatMessage m) => state = state.copyWith(messages: [...state.messages, m]);

  /// First message of an empty chat: make the assistant forget anything from before.
  Future<void> _startIfFresh() async {
    if (!_fresh) return;
    _fresh = false;
    try {
      await ref.read(assistantRepositoryProvider).reset();
    } catch (_) {
      // the question itself will report if the assistant is down
    }
  }

  void setListening(bool on) => state = state.copyWith(phase: on ? AskPhase.listening : AskPhase.idle);

  Future<void> toggleSpeak() async {
    state = state.copyWith(speak: !state.speak);
    await ref.read(sharedPrefsProvider).setBool(_speakKey, state.speak);
    if (!state.speak) await _player?.stop();
  }

  Future<void> ask(String text) async {
    final q = text.trim();
    if (q.isEmpty || state.phase == AskPhase.thinking) return;
    _add(ChatMessage(q, mine: true));
    state = state.copyWith(phase: AskPhase.thinking);
    try {
      await _startIfFresh();
      final reply = await ref.read(assistantRepositoryProvider).chat(q, speak: state.speak);
      _answer(reply.reply, reply.audioBase64);
    } catch (e) {
      _fail(e);
    }
  }

  Future<void> askByVoice(List<int> audio) async {
    state = state.copyWith(phase: AskPhase.thinking);
    try {
      await _startIfFresh();
      final reply = await ref.read(assistantRepositoryProvider).voice(audio);
      if (reply.heard != null && reply.heard!.trim().isNotEmpty) _add(ChatMessage(reply.heard!.trim(), mine: true));
      _answer(reply.reply, reply.audioBase64);
    } catch (e) {
      _fail(e);
    }
  }

  /// "Hey Switchboard": the request recorded after the wake word. The exchange goes into this
  /// conversation like any other, but the hands-free controller speaks the answer itself (it has to
  /// know when the answer ends). Null when the assistant couldn't be reached.
  Future<({String? heard, String reply, List<int>? audio})?> askHandsFree(
    List<int> wav, {
    bool afterWake = true,
  }) async {
    unawaited(_player?.stop());
    state = state.copyWith(phase: AskPhase.thinking);
    try {
      await _startIfFresh();
      final r = await ref.read(assistantRepositoryProvider).voice(wav, afterWake: afterWake);
      final heard = r.heard?.trim();
      if (heard != null && heard.isNotEmpty) _add(ChatMessage(heard, mine: true));
      final text = r.reply.isEmpty ? 'Done.' : r.reply;
      _add(ChatMessage(text, mine: false));
      state = state.copyWith(phase: AskPhase.idle);
      unawaited(ref.read(devicesProvider.notifier).refresh());
      return (heard: heard, reply: text, audio: AssistantRepository.decodeAudio(r.audioBase64));
    } catch (e) {
      _fail(e);
      return null;
    }
  }

  void _answer(String text, String? audio) {
    _add(ChatMessage(text.isEmpty ? 'Done.' : text, mine: false));
    state = state.copyWith(phase: AskPhase.idle);
    // its device changes arrive live; refresh anyway in case the socket is reconnecting
    ref.read(devicesProvider.notifier).refresh();
    final bytes = AssistantRepository.decodeAudio(audio);
    if (state.speak && bytes != null) {
      _player ??= AudioPlayer();
      _player!.play(BytesSource(Uint8List.fromList(bytes), mimeType: 'audio/wav')).catchError((_) {});
    }
  }

  void _fail(Object e) {
    final ex = ApiException.from(e);
    final text = ex.status == 503 || ex.status == 502
        ? 'The assistant isn’t available right now. You can still switch things from the app.'
        : ex.message;
    _add(ChatMessage(text, mine: false, error: true));
    state = state.copyWith(phase: AskPhase.idle);
  }

  Future<void> reset() async {
    state = state.copyWith(messages: const []);
    _fresh = false; // cleared on the server right here
    try {
      await ref.read(assistantRepositoryProvider).reset();
    } catch (_) {}
  }
}

final assistantProvider = NotifierProvider<AssistantController, AskState>(
  AssistantController.new,
);
