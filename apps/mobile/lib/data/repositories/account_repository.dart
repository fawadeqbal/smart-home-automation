import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../models/json.dart';

/// Two-step sign-in (`/auth/2fa`).
@immutable
class TwoStepStatus {
  const TwoStepStatus({this.enabled = false, this.since, this.recoveryLeft = 0});

  factory TwoStepStatus.fromJson(Json j) => TwoStepStatus(enabled: boolean(j['enabled']), since: dateOrNull(j['since']), recoveryLeft: integer(j['recoveryLeft']));

  final bool enabled;
  final DateTime? since;
  final int recoveryLeft;
}

/// What turning two-step sign-in on starts with: the key to type into an authenticator app, its link,
/// and a QR code of it (PNG).
@immutable
class TwoStepSetup {
  const TwoStepSetup({required this.secret, required this.uri, this.qrPng});

  factory TwoStepSetup.fromJson(Json j) {
    final qr = str(j['qr']);
    final comma = qr.indexOf(',');
    Uint8List? png;
    if (qr.startsWith('data:image/png;base64,') && comma > 0) {
      try {
        png = base64Decode(qr.substring(comma + 1));
      } catch (_) {}
    }
    return TwoStepSetup(secret: str(j['secret']), uri: str(j['uri']), qrPng: png);
  }

  /// "ABCD EFGH …" (grouped by four, as the web shows it).
  final String secret;

  /// `otpauth://totp/…`
  final String uri;
  final Uint8List? qrPng;
}

/// One place this person is signed in (a browser, this phone…).
@immutable
class SignInSession {
  const SignInSession({required this.id, required this.device, this.ip, this.createdAt, this.lastUsedAt, this.current = false});

  factory SignInSession.fromJson(Json j) => SignInSession(
        id: str(j['id']),
        device: str(j['device'], 'A device'),
        ip: strOrNull(j['ip']),
        createdAt: dateOrNull(j['createdAt']),
        lastUsedAt: dateOrNull(j['lastUsedAt']),
        current: boolean(j['current']),
      );

  final String id, device;
  final String? ip;
  final DateTime? createdAt, lastUsedAt;
  final bool current;

  /// A phone or the app (else a computer), for its icon.
  bool get phone => RegExp('app|Android|iPhone|iPad', caseSensitive: false).hasMatch(device);
}

/// Something this person asked the assistant to remember in this home.
@immutable
class Memory {
  const Memory({required this.id, required this.text, this.createdAt});

  factory Memory.fromJson(Json j) => Memory(id: str(j['id']), text: str(j['text']), createdAt: dateOrNull(j['createdAt']));

  final String id, text;
  final DateTime? createdAt;
}

/// The signed-in person's own account, like the web's /account: mobile number, two-step sign-in,
/// where they're signed in, and what the assistant remembers.
class AccountRepository {
  const AccountRepository(this._api);
  final ApiClient _api;

  /// The mobile number saved for WhatsApp messages (null: none).
  Future<String?> phone() async => strOrNull(asJson(await _api.get<Object?>('/auth/me'))['phone']);

  Future<String?> setPhone(String? phone) async =>
      strOrNull(asJson(await _api.patch<Object?>('/account/phone', {'phone': phone == null || phone.trim().isEmpty ? null : phone.trim()}))['phone']);

  Future<TwoStepStatus> twoStep() async => TwoStepStatus.fromJson(asJson(await _api.get<Object?>('/auth/2fa')));

  Future<TwoStepSetup> startTwoStep() async => TwoStepSetup.fromJson(asJson(await _api.post<Object?>('/auth/2fa/setup')));

  /// Turns it on with the first code from the app; answers the recovery codes (shown once).
  Future<List<String>> enableTwoStep(String code) async => strList(asJson(await _api.post<Object?>('/auth/2fa/enable', {'code': code.replaceAll(' ', '')}))['codes']);

  Future<void> disableTwoStep(String password) => _api.post<Object?>('/auth/2fa/disable', {'password': password});

  Future<List<String>> newRecoveryCodes(String password) async => strList(asJson(await _api.post<Object?>('/auth/2fa/codes', {'password': password}))['codes']);

  Future<List<SignInSession>> sessions() async => asJsonList(await _api.get<Object?>('/auth/sessions')).map(SignInSession.fromJson).toList();

  Future<void> signOutSession(String id) => _api.delete<Object?>('/auth/sessions/$id');

  Future<void> signOutOthers() => _api.post<Object?>('/auth/sessions/others');

  Future<List<Memory>> memories() async => asJsonList(await _api.get<Object?>('/assistant/memory')).map(Memory.fromJson).toList();

  Future<void> remember(String text) => _api.post<Object?>('/assistant/memory', {'text': text.trim()});

  Future<void> forget(String id) => _api.delete<Object?>('/assistant/memory/$id');
}

final accountRepositoryProvider = Provider<AccountRepository>((ref) => AccountRepository(ref.watch(apiClientProvider)));

final phoneNumberProvider = FutureProvider.autoDispose<String?>((ref) => ref.read(accountRepositoryProvider).phone());
final twoStepProvider = FutureProvider.autoDispose<TwoStepStatus>((ref) => ref.read(accountRepositoryProvider).twoStep());
final signInSessionsProvider = FutureProvider.autoDispose<List<SignInSession>>((ref) => ref.read(accountRepositoryProvider).sessions());
final memoriesProvider = FutureProvider.autoDispose<List<Memory>>((ref) => ref.read(accountRepositoryProvider).memories());
