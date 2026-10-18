import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../models/automation.dart';
import '../models/json.dart';

/// Scenes and schedules. Everyone may automate the devices they control; the server checks.
class AutomationRepository {
  const AutomationRepository(this._api);
  final ApiClient _api;

  Future<List<Scene>> scenes() async => asJsonList(await _api.get<Object?>('/scenes')).map(Scene.fromJson).toList();

  /// A new scene: [actions] switch these devices on or off (the server checks each is mine to switch).
  Future<Scene> createScene(String name, String icon, List<DeviceAction> actions) async => Scene.fromJson(asJson(
      await _api.post<Object?>('/scenes', {'name': name.trim(), 'icon': icon, 'actions': [for (final a in actions) a.toJson()]})));

  Future<void> deleteScene(String id) => _api.delete<Object?>('/scenes/$id');

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

  /// A new rule, or a change to one ([id]); the server checks the rights and words the summary.
  Future<Rule> saveRule(RuleInput rule, {String? id}) async => Rule.fromJson(asJson(
      id == null ? await _api.post<Object?>('/rules', rule.toJson()) : await _api.patch<Object?>('/rules/$id', rule.toJson())));

  Future<void> deleteRule(String id) => _api.delete<Object?>('/rules/$id');

  Future<AwayState> away() async => AwayState.fromJson(asJson(await _api.get<Object?>('/home/away')));

  Future<AwayState> setAway(bool on) async => AwayState.fromJson(asJson(await _api.put<Object?>('/home/away', {'on': on})));
}

final automationRepositoryProvider = Provider<AutomationRepository>(
  (ref) => AutomationRepository(ref.watch(apiClientProvider)),
);
