import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../models/automation.dart';
import '../models/json.dart';

/// Scenes and schedules. Everyone may automate the devices they control; the server checks.
class AutomationRepository {
  const AutomationRepository(this._api);
  final ApiClient _api;

  Future<List<Scene>> scenes() async => asJsonList(await _api.get<Object?>('/scenes')).map(Scene.fromJson).toList();

  /// Runs every action of the scene; some may fail while others work (see [SceneRun]).
  Future<SceneRun> runScene(String id) async => SceneRun.fromJson(asJson(await _api.post<Object?>('/scenes/$id/run')));

  /// Mine, or everyone's for owners and admins — enabled first, soonest first.
  Future<List<Schedule>> schedules() async =>
      asJsonList(await _api.get<Object?>('/schedules')).map(Schedule.fromJson).toList();

  Future<Schedule> createSchedule(NewSchedule schedule) async =>
      Schedule.fromJson(asJson(await _api.post<Object?>('/schedules', schedule.toJson())));

  Future<void> setEnabled(String id, bool enabled) => _api.patch<Object?>('/schedules/$id', {'enabled': enabled});

  Future<void> deleteSchedule(String id) => _api.delete<Object?>('/schedules/$id');

  Future<List<Rule>> rules() async => asJsonList(await _api.get<Object?>('/rules')).map(Rule.fromJson).toList();

  Future<void> setRuleEnabled(String id, bool enabled) => _api.patch<Object?>('/rules/$id', {'enabled': enabled});

  Future<void> deleteRule(String id) => _api.delete<Object?>('/rules/$id');

  Future<AwayState> away() async => AwayState.fromJson(asJson(await _api.get<Object?>('/home/away')));

  Future<AwayState> setAway(bool on) async => AwayState.fromJson(asJson(await _api.put<Object?>('/home/away', {'on': on})));
}

final automationRepositoryProvider = Provider<AutomationRepository>(
  (ref) => AutomationRepository(ref.watch(apiClientProvider)),
);
