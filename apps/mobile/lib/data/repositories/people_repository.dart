import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../models/json.dart';
import '../models/people.dart';
import '../models/session.dart';

/// The home's people and invites (owners and admins), and my own notification settings.
class PeopleRepository {
  const PeopleRepository(this._api);
  final ApiClient _api;

  /// The home's people, owners first. The API also lists the installer who looks after the home —
  /// with no role in it; the app shows them as the home expert instead, so they're left out here.
  Future<List<Member>> members() async {
    final rows = asJsonList(await _api.get<Object?>('/users'));
    return [
      for (final row in rows)
        if (row['role'] != null) Member.fromJson(row),
    ];
  }

  /// A one-time link (7 days) for [email] to join as [role], with [rooms] shared with them, and
  /// [limits] (`AccessLimits.body`) when their access is only for a while or at certain hours.
  Future<InviteLink> invite({
    required String email,
    String? name,
    HomeRole role = HomeRole.member,
    Map<String, Access> rooms = const {},
    Json? limits,
  }) async {
    final body = {
      'email': email,
      if (name != null && name.isNotEmpty) 'name': name,
      'role': role.json,
      'rooms': [
        for (final e in rooms.entries) {'roomId': e.key, 'access': e.value.json},
      ],
      ...?limits,
    };
    return InviteLink.fromJson(asJson(await _api.post<Object?>('/invites', body)));
  }

  /// Changes, extends or lifts someone's time limits (`AccessLimits.body`).
  Future<void> setLimits(String userId, Json limits) => _api.patch<Object?>('/users/$userId', limits);

  /// Takes someone out of the home.
  Future<void> remove(String userId) => _api.delete<Object?>('/users/$userId');

  /// The notifications this person may get (board alerts only for owners and admins).
  Future<List<NotificationPref>> prefs() async =>
      asJsonList(await _api.get<Object?>('/notifications/prefs')).map(NotificationPref.fromJson).toList();

  /// Saves [changes] (key → on/off) and returns all settings as they are now.
  Future<List<NotificationPref>> setPrefs(Map<String, bool> changes) async =>
      asJsonList(await _api.put<Object?>('/notifications/prefs', changes)).map(NotificationPref.fromJson).toList();
}

final peopleRepositoryProvider = Provider<PeopleRepository>(
  (ref) => PeopleRepository(ref.watch(apiClientProvider)),
);
