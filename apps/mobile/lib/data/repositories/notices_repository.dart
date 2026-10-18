import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../models/json.dart';
import '../models/notice.dart';
import '../models/presence.dart';

/// My notices (`/notifications`), this phone for push (`/push/phone`), and who's home (`/presence`).
class NoticesRepository {
  const NoticesRepository(this._api);
  final ApiClient _api;

  Future<NoticeList> list() async => NoticeList.fromJson(asJson(await _api.get<Object?>('/notifications')));

  Future<void> markRead(String id) => _api.post<Object?>('/notifications/$id/read');

  Future<void> markAllRead() => _api.post<Object?>('/notifications/read');

  /// Remembers this phone's push token for the signed-in person ([replaces]: the token it had before).
  Future<void> registerPhone({required String token, required String platform, String? appVersion, String? replaces}) =>
      _api.post<Object?>('/push/phone', {
        'token': token,
        'platform': platform,
        'appVersion': ?appVersion,
        'replaces': ?replaces,
      });

  /// Signed out: no more notices to this phone.
  Future<void> unregisterPhone(String token) => _api.post<Object?>('/push/phone/remove', {'token': token});

  Future<WhoIsHome> whoIsHome() async => WhoIsHome.fromJson(asJson(await _api.get<Object?>('/presence')));

  Future<MySharing> sharing() async => MySharing.fromJson(asJson(await _api.get<Object?>('/presence/me')));

  Future<MySharing> setSharing(bool on) async => MySharing.fromJson(asJson(await _api.put<Object?>('/presence/me', {'sharing': on})));

  /// Tells the server whether this phone can reach a board of the open home; returns whether they share.
  Future<bool> report(bool atHome) async =>
      boolean(asJson(await _api.post<Object?>('/presence', {'atHome': atHome}))['sharing']);

  Future<PresenceRuleState> rule() async => PresenceRuleState.fromJson(asJson(await _api.get<Object?>('/presence/rule')));

  Future<PresenceRuleState> setRule(Json body) async =>
      PresenceRuleState.fromJson(asJson(await _api.put<Object?>('/presence/rule', body)));

  Future<void> removeRule() => _api.delete<Object?>('/presence/rule');
}

final noticesRepositoryProvider = Provider<NoticesRepository>((ref) => NoticesRepository(ref.watch(apiClientProvider)));
