import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../models/activity.dart';
import '../models/device.dart';
import '../models/device_detail.dart';
import '../models/json.dart';

/// The open home's devices and rooms, as far as this person may see them.
class DevicesRepository {
  const DevicesRepository(this._api);
  final ApiClient _api;

  Future<List<Device>> devices() async => asJsonList(await _api.get<Object?>('/devices')).map(Device.fromJson).toList();

  /// In the home's order.
  Future<List<Room>> rooms() async => asJsonList(await _api.get<Object?>('/rooms')).map(Room.fromJson).toList();

  /// Switches a device and waits for its board to confirm; returns the device as it is now.
  /// Fails with the server's words when the board doesn't answer. [confirm] `ups`: switch a heavy load
  /// on even though the home is on UPS (the person said yes).
  Future<Device> setOn(String id, bool on, {String? confirm}) async => command(id, {'on': on}, confirm: confirm);

  /// Any command the device takes: `{'on': true}`, a fan's `{'speed': 3}`.
  Future<Device> command(String id, Map<String, Object> body, {String? confirm}) async => Device.fromJson(
      asJson(await _api.post<Object?>('/devices/$id/commands${confirm != null ? '?confirm=$confirm' : ''}', body)));

  /// One device with its own page's settings (safety, power, readings).
  Future<DeviceDetail> detail(String id) async => DeviceDetail.fromJson(asJson(await _api.get<Object?>('/devices/$id')));

  /// The raw history rows (`{state, source, at, via, by}`), newest first — for a sensor's chart.
  Future<List<Json>> rawHistory(String id, {int limit = 300}) async =>
      asJsonList(await _api.get<Object?>('/devices/$id/history', query: {'limit': limit}));

  /// Changes a device's settings (owners and admins): `{'roomId': …}`, `{'childLock': true}`, `{'watts': 75}`…
  Future<void> update(String id, Map<String, Object?> body) => _api.patch<Object?>('/devices/$id', body);

  /// Rooms (owners and admins). New rooms go last.
  Future<void> addRoom(String name, int order) => _api.post<Object?>('/rooms', {'name': name, 'order': order});

  Future<void> updateRoom(String id, {String? name, int? order}) => _api.patch<Object?>('/rooms/$id', {'name': ?name, 'order': ?order});

  /// Its devices are kept, without a room.
  Future<void> removeRoom(String id) => _api.delete<Object?>('/rooms/$id');

  /// [device]'s recent changes, newest first. The history rows don't repeat which device they're
  /// about, so they're filled in from [device].
  Future<List<ActivityEvent>> history(Device device, {int limit = 50}) async {
    final rows = asJsonList(await _api.get<Object?>('/devices/${device.id}/history', query: {'limit': limit}));
    return [
      for (final (i, row) in rows.indexed)
        ActivityEvent.fromJson({
          'id': '${device.id}-$i',
          'deviceId': device.id,
          'deviceName': device.name,
          'deviceType': device.type,
          'roomId': device.roomId,
          'roomName': device.roomName,
          ...row,
        }),
    ];
  }
}

final devicesRepositoryProvider = Provider<DevicesRepository>(
  (ref) => DevicesRepository(ref.watch(apiClientProvider)),
);
