import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../../core/network/api_exception.dart';
import '../models/device.dart';
import '../models/json.dart';
import '../models/work/board.dart';
import '../models/work/day.dart';
import '../models/work/homes.dart';
import '../models/work/installation.dart';
import '../models/work/office.dart';
import '../models/work/tickets.dart';

/// The staff side of the API: the day, the homes, boards and devices, installation reports, tickets
/// and the office lists. The only code of the work screens that knows URLs.
///
/// Calls about one customer's home name it with `X-Home-Id` (the API then gives the staff view of
/// that home); the console calls (`/platform/…`) send an empty one, so they never depend on whichever
/// home the session last opened.
class WorkRepository {
  const WorkRepository(this._api);
  final ApiClient _api;

  Future<T> _call<T>(String method, String path, {String? home, Object? body, Map<String, dynamic>? query}) async {
    try {
      final res = await _api.dio.request<dynamic>(
        path,
        data: body ?? (method == 'GET' || method == 'DELETE' ? null : <String, dynamic>{}),
        queryParameters: query,
        options: Options(method: method, headers: {ApiClient.homeHeader: home ?? ''}),
      );
      return res.data as T;
    } catch (e) {
      throw ApiException.from(e);
    }
  }

  Future<Json> _json(String method, String path, {String? home, Object? body, Map<String, dynamic>? query}) async =>
      asJson(await _call<Object?>(method, path, home: home, body: body, query: query));
  Future<List<Json>> _list(String path, {String? home, Map<String, dynamic>? query}) async =>
      asJsonList(await _call<Object?>('GET', path, home: home, query: query));

  // ---------------------------------------------------------------- the day and the homes
  Future<InstallerDay> day({required String date, String? installerId}) async =>
      InstallerDay.fromJson(await _json('GET', '/platform/day', query: {'date': date, 'installerId': ?installerId}));

  Future<List<HomeRow>> homes() async => (await _list('/platform/homes')).map(HomeRow.fromJson).toList();

  Future<Workspace> workspace(String homeId) async => Workspace.fromJson(await _json('GET', '/platform/homes/$homeId'));

  // ---------------------------------------------------------------- boards and devices (in one home)
  Future<Catalog> catalog() async => Catalog.fromJson(await _json('GET', '/catalog'));

  Future<List<BoardNode>> nodes(String homeId) async =>
      (await _list('/nodes', home: homeId)).map(BoardNode.fromJson).toList();

  Future<List<Room>> rooms(String homeId) async => (await _list('/rooms', home: homeId)).map(Room.fromJson).toList();

  Future<List<Device>> devices(String homeId) async =>
      (await _list('/devices', home: homeId)).map(Device.fromJson).toList();

  Future<List<SceneRef>> scenes(String homeId) async =>
      (await _list('/scenes', home: homeId)).map(SceneRef.fromJson).toList();

  /// The installer, on site: the assigned board is powered and online — name it after where it is.
  Future<void> adopt(String homeId, String nodeId, {required String name, required String board}) =>
      _call<Object?>('POST', '/nodes/$nodeId/adopt', home: homeId, body: {'name': name, 'board': board});

  Future<void> updateNode(String homeId, String nodeId, {String? name, String? board}) =>
      _call<Object?>('PATCH', '/nodes/$nodeId', home: homeId, body: {'name': ?name, 'board': ?board});

  Future<void> reboot(String homeId, String nodeId) => _call<Object?>('POST', '/nodes/$nodeId/reboot', home: homeId);

  Future<void> resetLogin(String homeId, String nodeId) =>
      _call<Object?>('POST', '/nodes/$nodeId/reset-login', home: homeId);

  Future<void> markFaulty(String homeId, String nodeId, String note) =>
      _call<Object?>('POST', '/nodes/$nodeId/faulty', home: homeId, body: {'note': note});

  Future<void> markWorking(String homeId, String nodeId) =>
      _call<Object?>('POST', '/nodes/$nodeId/working', home: homeId);

  /// Out of the home: its devices are deleted and the board goes back to stock.
  Future<void> removeNode(String homeId, String nodeId) => _call<Object?>('DELETE', '/nodes/$nodeId', home: homeId);

  Future<void> addDevice(String homeId, String nodeId, Json body) =>
      _call<Object?>('POST', '/nodes/$nodeId/devices', home: homeId, body: body);

  Future<void> updateDevice(String homeId, String deviceId, Json body) =>
      _call<Object?>('PATCH', '/devices/$deviceId', home: homeId, body: body);

  Future<void> removeDevice(String homeId, String deviceId) =>
      _call<Object?>('DELETE', '/devices/$deviceId', home: homeId);

  Future<void> addInput(String homeId, String nodeId, Json body) =>
      _call<Object?>('POST', '/nodes/$nodeId/inputs', home: homeId, body: body);

  Future<void> updateInput(String homeId, String inputId, Json body) =>
      _call<Object?>('PATCH', '/inputs/$inputId', home: homeId, body: body);

  Future<void> removeInput(String homeId, String inputId) => _call<Object?>('DELETE', '/inputs/$inputId', home: homeId);

  /// The board's recent log lines (newer ones arrive live as `node.log`).
  Future<List<LogLine>> logs(String homeId, String nodeId) async =>
      (await _list('/nodes/$nodeId/logs', home: homeId)).map(LogLine.fromJson).toList();

  Future<List<FirmwareImage>> firmware() async => (await _list('/firmware')).map(FirmwareImage.fromJson).toList();

  /// Sends a build to the board; it answers over the socket (`node.network` with `ota`), then restarts.
  Future<String> installFirmware(String homeId, String nodeId, String firmwareId) async =>
      str((await _json('POST', '/nodes/$nodeId/update', home: homeId, body: {'firmwareId': firmwareId}))['version']);

  /// Boards that could take over from this one, each with its pin plan.
  Future<List<SwapCandidate>> replacements(String homeId, String nodeId) async =>
      asJsonList((await _json('GET', '/nodes/$nodeId/replacements', home: homeId))['candidates'])
          .map(SwapCandidate.fromJson)
          .toList();

  Future<SwapResult> replace(
    String homeId,
    String nodeId, {
    required String newId,
    required bool backToStock,
    String? note,
  }) async => SwapResult.fromJson(
    await _json(
      'POST',
      '/nodes/$nodeId/replace',
      home: homeId,
      body: {
        'newId': newId,
        'oldTo': backToStock ? 'stock' : 'faulty',
        if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
      },
    ),
  );

  // ---------------------------------------------------------------- installation report
  Future<InstallReport> installation(String homeId) async =>
      InstallReport.fromJson(await _json('GET', '/platform/homes/$homeId/installation'));

  Future<InstallReport> saveInstallation(String homeId, {List<PendingTick>? items, String? notes}) async =>
      InstallReport.fromJson(
        await _json(
          'PUT',
          '/platform/homes/$homeId/installation',
          body: {
            if (items != null) 'items': [for (final t in items) t.toJson()],
            'notes': ?notes,
          },
        ),
      );

  Future<InstallReport> addPhoto(
    String homeId, {
    required List<int> bytes,
    required String filename,
    required String mime,
    String caption = '',
  }) async {
    final form = FormData.fromMap({
      'photo': MultipartFile.fromBytes(bytes, filename: filename, contentType: DioMediaType.parse(mime)),
      'caption': caption,
    });
    try {
      final res = await _api.dio.post<dynamic>(
        '/platform/homes/$homeId/installation/photos',
        data: form,
        options: Options(
          contentType: 'multipart/form-data',
          headers: {ApiClient.homeHeader: ''},
          sendTimeout: const Duration(seconds: 90),
          receiveTimeout: const Duration(seconds: 90),
        ),
      );
      return InstallReport.fromJson(asJson(res.data));
    } catch (e) {
      throw ApiException.from(e);
    }
  }

  Future<InstallReport> removePhoto(String homeId, String photoId) async =>
      InstallReport.fromJson(await _json('DELETE', '/platform/homes/$homeId/installation/photos/$photoId'));

  Future<InstallReport> sign(String homeId, {required String name, required String signature}) async =>
      InstallReport.fromJson(
        await _json('POST', '/platform/homes/$homeId/installation/sign', body: {'name': name, 'signature': signature}),
      );

  Future<InstallReport> reopen(String homeId) async =>
      InstallReport.fromJson(await _json('POST', '/platform/homes/$homeId/installation/reopen'));

  // ---------------------------------------------------------------- tickets
  /// [status]: `open`, `done` or null (all); [mine]: only tickets handed to me.
  Future<TicketQueue> tickets({String? status, bool mine = false, String? homeId}) async => TicketQueue.fromJson(
    await _json(
      'GET',
      '/platform/tickets',
      query: {'status': ?status, if (mine) 'mine': 'true', 'homeId': ?homeId},
    ),
  );

  Future<StaffTicket> ticket(String id) async => StaffTicket.fromJson(await _json('GET', '/platform/tickets/$id'));

  /// A reply (or a team-only note), and/or a new status.
  Future<StaffTicket> reply(String id, {String body = '', bool internal = false, TicketState? status}) async =>
      StaffTicket.fromJson(
        await _json(
          'POST',
          '/platform/tickets/$id/reply',
          body: {'body': body, if (internal) 'internal': true, 'status': ?status?.json},
        ),
      );

  Future<StaffTicket> updateTicket(
    String id, {
    TicketPriority? priority,
    String? assigneeId,
    bool unassign = false,
  }) async => StaffTicket.fromJson(
    await _json(
      'PATCH',
      '/platform/tickets/$id',
      body: {
        'priority': ?priority?.json,
        if (unassign) 'assigneeId': null else 'assigneeId': ?assigneeId,
      },
    ),
  );

  // ---------------------------------------------------------------- the office
  Future<Inventory> inventory() async => Inventory.fromJson(await _json('GET', '/platform/inventory'));

  Future<void> assignBoard(String boardId, String homeId) =>
      _call<Object?>('POST', '/platform/inventory/$boardId/assign', body: {'homeId': homeId});

  Future<List<VisitRequest>> visitRequests() async =>
      asJsonList((await _json('GET', '/platform/visit-requests'))['requests']).map(VisitRequest.fromJson).toList();

  Future<List<QuoteRow>> quotes() async =>
      asJsonList((await _json('GET', '/platform/quotes'))['quotes']).map(QuoteRow.fromJson).toList();

  Future<StaffOutages> outages({int days = 7}) async =>
      StaffOutages.fromJson(await _json('GET', '/platform/outages', query: {'days': days}));
}

final workRepositoryProvider = Provider<WorkRepository>((ref) => WorkRepository(ref.watch(apiClientProvider)));
