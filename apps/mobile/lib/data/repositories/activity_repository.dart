import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../models/activity.dart';
import '../models/json.dart';

/// Who switched what in the open home (`/events`): switches and contact sensors, newest first.
class ActivityRepository {
  const ActivityRepository(this._api);
  final ApiClient _api;

  /// Up to [limit] events; [before] pages back from the oldest one already shown.
  Future<List<ActivityEvent>> events({
    int limit = 50,
    DateTime? before,
    String? deviceId,
    String? roomId,
  }) async {
    final rows = await _api.get<Object?>(
      '/events',
      query: {
        'limit': limit,
        if (before != null) 'before': before.toUtc().toIso8601String(),
        'deviceId': ?deviceId,
        'roomId': ?roomId,
      },
    );
    return asJsonList(rows).map(ActivityEvent.fromJson).toList();
  }
}

final activityRepositoryProvider = Provider<ActivityRepository>(
  (ref) => ActivityRepository(ref.watch(apiClientProvider)),
);
