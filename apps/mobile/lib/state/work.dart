import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/config/app_settings.dart';
import '../core/network/api_client.dart';
import '../core/realtime/live_client.dart';
import '../data/models/device.dart';
import '../data/models/json.dart';
import '../data/models/work/board.dart';
import '../data/models/work/day.dart';
import '../data/models/work/homes.dart';
import '../data/models/work/office.dart';
import '../data/models/work/rights.dart';
import '../data/models/work/tickets.dart';
import '../data/repositories/work_repository.dart';
import 'session.dart';

// ---------------------------------------------------------------- work or my home

/// "Work" (the staff screens) or "My home", as the person last chose it on this phone; null: never chosen.
class WorkChoice extends Notifier<bool?> {
  static const _key = 'work_mode';

  @override
  bool? build() => switch (ref.read(sharedPrefsProvider).getString(_key)) {
    'work' => true,
    'home' => false,
    _ => null,
  };

  Future<void> set(bool atWork) async {
    state = atWork;
    await ref.read(sharedPrefsProvider).setString(_key, atWork ? 'work' : 'home');
  }
}

final workChoiceProvider = NotifierProvider<WorkChoice, bool?>(WorkChoice.new);

/// What the signed-in staff member may do; null for someone who isn't on the company's team.
final workRightsProvider = Provider<WorkRights?>((ref) {
  final me = ref.watch(sessionProvider.select((s) => s.value));
  final staff = me?.staff;
  if (me == null || staff == null) return null;
  return WorkRights(role: StaffRole.fromJson(staff.code), userId: me.id);
});

/// The app shows the staff screens. Staff without a home of their own always work; staff who also
/// belong to a home (the owner of the company with his own home) get what they chose last, else
/// their home.
final atWorkProvider = Provider<bool>((ref) {
  final me = ref.watch(sessionProvider.select((s) => s.value));
  if (me?.staff == null) return false;
  if (me!.homes.isEmpty) return true;
  return ref.watch(workChoiceProvider) ?? false;
});

/// A customer's home opened "as the customer sees it" from the staff screens (the home app shows it,
/// with a bar back to work); null when not.
class CustomerView extends Notifier<String?> {
  @override
  String? build() => null;
  void open(String homeId) => state = homeId;
  void close() => state = null;
}

final customerViewProvider = NotifierProvider<CustomerView, String?>(CustomerView.new);

/// Who is signed in: the work lists reload when that changes.
final _workUserProvider = Provider<String?>((ref) => ref.watch(sessionProvider.select((s) => s.value?.id)));

// ---------------------------------------------------------------- live updates

/// A live connection joined to one customer's home (board logs, health, devices), while a work screen
/// of that home is open. The session's own connection follows the person's home; this one follows the job.
final workLiveProvider = Provider.autoDispose.family<LiveClient, String>((ref, homeId) {
  final live = LiveClient(ref.watch(apiClientProvider));
  unawaited(live.open(homeId));
  ref.onDispose(live.close);
  return live;
});

/// Reloads [ref]'s provider when any of [events] arrives on the session's connection (the company's
/// `org:` events reach every staff member: homes, stock, visits, firmware).
void _reloadOn(Ref ref, List<String> events) {
  final sub = ref
      .watch(liveClientProvider)
      .events
      .where((e) => events.contains(e.name))
      .listen((_) => ref.invalidateSelf());
  ref.onDispose(sub.cancel);
}

// ---------------------------------------------------------------- the day

class WorkDayDate extends Notifier<String> {
  @override
  String build() => WorkDays.today();
  void set(String day) => state = day;
}

final workDayDateProvider = NotifierProvider<WorkDayDate, String>(WorkDayDate.new);

/// The installer whose day is shown (null: my own, or the API's pick for support).
class WorkDayWho extends Notifier<String?> {
  @override
  String? build() {
    ref.watch(_workUserProvider);
    return null;
  }

  void set(String? id) => state = id;
}

final workDayWhoProvider = NotifierProvider<WorkDayWho, String?>(WorkDayWho.new);

final workDayProvider = FutureProvider<InstallerDay>((ref) async {
  if (ref.watch(_workUserProvider) == null) return const InstallerDay(date: '');
  final date = ref.watch(workDayDateProvider);
  final who = ref.watch(workDayWhoProvider);
  _reloadOn(ref, ['visits.changed', 'homes.changed', 'inventory.changed']);
  return ref.read(workRepositoryProvider).day(date: date, installerId: who);
});

// ---------------------------------------------------------------- homes

final workHomesProvider = FutureProvider<List<HomeRow>>((ref) async {
  if (ref.watch(_workUserProvider) == null) return const [];
  _reloadOn(ref, ['homes.changed', 'inventory.changed']);
  return ref.read(workRepositoryProvider).homes();
});

/// One home's staff view, kept fresh by that home's live events.
final workspaceProvider = FutureProvider.autoDispose.family<Workspace, String>((ref, homeId) async {
  ref.watch(_workUserProvider);
  final live = ref.watch(workLiveProvider(homeId));
  const reload = {
    'nodes.changed',
    'node.status',
    'devices.changed',
    'inventory.changed',
    'firmware.changed',
    'homes.changed',
  };
  final sub = live.events.where((e) => reload.contains(e.name)).listen((_) => ref.invalidateSelf());
  ref.onDispose(sub.cancel);
  return ref.read(workRepositoryProvider).workspace(homeId);
});

/// Board models and device types (they only change with a new server version).
final catalogProvider = FutureProvider<Catalog>((ref) => ref.read(workRepositoryProvider).catalog());

/// The home's boards with their devices and wall buttons, kept live:
/// `node.health` and `node.status` patch a board, `nodes.changed` / `devices.changed` reload,
/// `device.state` patches what a device is doing.
class WorkNodes extends AsyncNotifier<List<BoardNode>> {
  WorkNodes(this.homeId);
  final String homeId;

  @override
  Future<List<BoardNode>> build() async {
    ref.watch(_workUserProvider);
    final live = ref.watch(workLiveProvider(homeId));
    final sub = live.events.listen(_onLive);
    ref.onDispose(sub.cancel);
    return ref.read(workRepositoryProvider).nodes(homeId);
  }

  void _onLive(LiveEvent e) {
    final list = state.value;
    if (list == null) return;
    final nodeId = str(e.map['nodeId']);
    switch (e.name) {
      case 'nodes.changed' || 'devices.changed':
        unawaited(refresh());
      case 'node.status':
        state = AsyncData([for (final n in list) n.id == nodeId ? n.copyWith(online: boolean(e.map['online'])) : n]);
        unawaited(refresh());
      case 'node.health':
        state = AsyncData([
          for (final n in list)
            n.id == nodeId
                ? n.copyWith(
                    health: BoardHealth.fromJson(asJson(e.map['health'])),
                    lastSeenAt: dateOrNull(e.map['lastSeenAt']),
                  )
                : n,
        ]);
      case 'device.state':
        final id = str(e.map['id']);
        final fields = asJson(e.map['state']);
        if (fields.isEmpty) return;
        state = AsyncData([
          for (final n in list)
            if (n.devices.any((d) => d.id == id))
              n.copyWith(devices: [for (final d in n.devices) d.id == id ? d.withState(fields) : d])
            else
              n,
        ]);
    }
  }

  Future<void> refresh() async {
    try {
      state = AsyncData(await ref.read(workRepositoryProvider).nodes(homeId));
    } catch (e, st) {
      if (state.value == null) state = AsyncError(e, st);
    }
  }
}

final workNodesProvider = AsyncNotifierProvider.autoDispose.family<WorkNodes, List<BoardNode>, String>(WorkNodes.new);

/// One board of a home (null while loading, or when it isn't in the home any more).
final workNodeProvider = Provider.autoDispose.family<BoardNode?, ({String homeId, String nodeId})>(
  (ref, k) => ref.watch(workNodesProvider(k.homeId)).value?.where((n) => n.id == k.nodeId).firstOrNull,
);

final workRoomsProvider = FutureProvider.autoDispose.family<List<Room>, String>((ref, homeId) async {
  ref.watch(_workUserProvider);
  return ref.read(workRepositoryProvider).rooms(homeId);
});

/// Every device of the home (for a tank's motor and a button's "toggle a switch").
final workDevicesProvider = FutureProvider.autoDispose.family<List<Device>, String>((ref, homeId) async {
  ref.watch(_workUserProvider);
  return ref.read(workRepositoryProvider).devices(homeId);
});

final workScenesProvider = FutureProvider.autoDispose.family<List<SceneRef>, String>((ref, homeId) async {
  ref.watch(_workUserProvider);
  try {
    return await ref.read(workRepositoryProvider).scenes(homeId);
  } catch (_) {
    return const [];
  }
});

final firmwareProvider = FutureProvider.autoDispose<List<FirmwareImage>>((ref) async {
  ref.watch(_workUserProvider);
  _reloadOn(ref, ['firmware.changed']);
  final list = await ref.read(workRepositoryProvider).firmware();
  return list..sort((a, b) => compareVersions(b.version, a.version));
});

// ---------------------------------------------------------------- tickets

/// Which tickets the list shows: mine or all, and open, solved or all.
class TicketFilter extends Notifier<({bool mine, String status})> {
  @override
  ({bool mine, String status}) build() {
    ref.watch(_workUserProvider);
    return (mine: ref.read(workRightsProvider)?.isInstaller ?? false, status: 'open');
  }

  void set({bool? mine, String? status}) => state = (mine: mine ?? state.mine, status: status ?? state.status);
}

final ticketFilterProvider = NotifierProvider<TicketFilter, ({bool mine, String status})>(TicketFilter.new);

final workTicketsProvider = FutureProvider<TicketQueue>((ref) async {
  if (ref.watch(_workUserProvider) == null) return const TicketQueue();
  final f = ref.watch(ticketFilterProvider);
  _reloadOn(ref, ['notification']);
  return ref.read(workRepositoryProvider).tickets(status: f.status == 'all' ? null : f.status, mine: f.mine);
});

final homeTicketsProvider = FutureProvider.autoDispose.family<List<StaffTicket>, String>((ref, homeId) async {
  ref.watch(_workUserProvider);
  return (await ref.read(workRepositoryProvider).tickets(status: 'open', homeId: homeId)).tickets;
});

final workTicketProvider = FutureProvider.autoDispose.family<StaffTicket, String>((ref, id) async {
  ref.watch(_workUserProvider);
  _reloadOn(ref, ['notification']);
  return ref.read(workRepositoryProvider).ticket(id);
});

// ---------------------------------------------------------------- the office

final inventoryProvider = FutureProvider.autoDispose<Inventory>((ref) async {
  ref.watch(_workUserProvider);
  _reloadOn(ref, ['inventory.changed']);
  return ref.read(workRepositoryProvider).inventory();
});

final visitRequestsProvider = FutureProvider.autoDispose<List<VisitRequest>>((ref) async {
  ref.watch(_workUserProvider);
  _reloadOn(ref, ['visits.changed']);
  return ref.read(workRepositoryProvider).visitRequests();
});

final quotesProvider = FutureProvider.autoDispose<List<QuoteRow>>((ref) async {
  ref.watch(_workUserProvider);
  return ref.read(workRepositoryProvider).quotes();
});

final staffOutagesProvider = FutureProvider.autoDispose<StaffOutages>((ref) async {
  ref.watch(_workUserProvider);
  return ref.read(workRepositoryProvider).outages(days: 7);
});
