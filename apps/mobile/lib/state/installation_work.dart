import 'dart:async';
import 'dart:io';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';

import '../core/config/app_settings.dart';
import '../core/network/api_exception.dart';
import '../data/local/install_queue.dart';
import '../data/models/work/installation.dart';
import '../data/repositories/work_repository.dart';

/// The installation report as the phone shows it: the server's copy (or the one saved on the phone
/// when there's no signal), with the changes that haven't been sent yet on top.
@immutable
class InstallView {
  const InstallView({
    required this.report,
    this.pending = const PendingInstall(),
    this.fromCache = false,
    this.sending = false,
    this.refused,
  });

  final InstallReport report;
  final PendingInstall pending;

  /// Opened without signal: the last copy the server sent this phone.
  final bool fromCache;
  final bool sending;

  /// The server refused a change that waited on the phone, and why.
  final String? refused;

  InstallReport get shown => pending.applyTo(report);
  bool get waiting => !pending.isEmpty;

  InstallView copyWith({
    InstallReport? report,
    PendingInstall? pending,
    bool? fromCache,
    bool? sending,
    String? refused,
    bool clearRefused = false,
  }) => InstallView(
    report: report ?? this.report,
    pending: pending ?? this.pending,
    fromCache: fromCache ?? this.fromCache,
    sending: sending ?? this.sending,
    refused: clearRefused ? null : refused ?? this.refused,
  );
}

class _Sender implements InstallSender {
  _Sender(this.repo, this.homeId);
  final WorkRepository repo;
  final String homeId;

  @override
  Future<InstallReport> save(List<PendingTick>? ticks, String? notes) =>
      repo.saveInstallation(homeId, items: ticks, notes: notes);

  @override
  Future<InstallReport> photo(PendingPhoto photo) async {
    final file = File(photo.file);
    if (!await file.exists()) {
      throw const ApiException(400, 'A photo saved on this phone was lost before it could be sent. Take it again.');
    }
    return repo.addPhoto(
      homeId,
      bytes: await file.readAsBytes(),
      filename: file.uri.pathSegments.last,
      mime: photo.mime,
      caption: photo.caption,
    );
  }

  @override
  Future<InstallReport> sign(PendingSignature s) => repo.sign(homeId, name: s.name, signature: s.signature);
}

/// The checklist, photos and sign-off of one home, working without signal: every change is saved on
/// the phone first, then sent — at once when online, else when the phone is back online (it checks on
/// network changes, when the app comes back, and every 20 seconds while something waits).
class InstallController extends AsyncNotifier<InstallView> {
  InstallController(this.homeId);
  final String homeId;

  late InstallQueueStore _store;
  bool _syncing = false;

  WorkRepository get _repo => ref.read(workRepositoryProvider);

  @override
  Future<InstallView> build() async {
    _store = InstallQueueStore(ref.read(sharedPrefsProvider));
    final timer = Timer.periodic(const Duration(seconds: 20), (_) {
      if (!_store.load(homeId).isEmpty) unawaited(sync());
    });
    ref.onDispose(timer.cancel);
    StreamSubscription<List<ConnectivityResult>>? net;
    try {
      net = Connectivity().onConnectivityChanged.listen((r) {
        if (!r.contains(ConnectivityResult.none)) Future<void>.delayed(const Duration(seconds: 2), sync);
      }, onError: (Object _) {});
    } catch (_) {
      // no connectivity plugin (tests): the timer still runs
    }
    ref.onDispose(() => net?.cancel());
    final life = AppLifecycleListener(onResume: () => unawaited(sync()));
    ref.onDispose(life.dispose);

    final pending = _store.load(homeId);
    try {
      final report = await _repo.installation(homeId);
      unawaited(_store.cacheReport(homeId, report.raw));
      if (!pending.isEmpty) unawaited(Future<void>.delayed(const Duration(milliseconds: 400), sync));
      return InstallView(report: report, pending: pending);
    } catch (e) {
      final cached = _store.cachedReport(homeId);
      if (cached != null && tryAgainLater(e)) return InstallView(report: cached, pending: pending, fromCache: true);
      rethrow;
    }
  }

  InstallView? get _view => state.value;

  Future<void> _remember(PendingInstall Function(PendingInstall) change) async {
    final next = change(_store.load(homeId));
    await _store.save(homeId, next);
    final v = _view;
    if (v != null) state = AsyncData(v.copyWith(pending: next, clearRefused: true));
    unawaited(sync());
  }

  String get _now => DateTime.now().toUtc().toIso8601String();

  Future<void> tick(String key, bool done) => _remember((p) => p.withTick(PendingTick(key: key, done: done, at: _now)));

  Future<void> note(String key, String note) async {
    final item = _view?.shown.items.where((i) => i.key == key).firstOrNull;
    await _remember((p) => p.withTick(PendingTick(key: key, done: item?.done ?? false, note: note.trim(), at: _now)));
  }

  Future<void> setNotes(String notes) => _remember((p) => p.withNotes(notes));

  /// A photo from the camera or the gallery: kept as a file on the phone until it's sent.
  Future<void> addPhoto(List<int> bytes, {required String mime, String caption = ''}) async {
    final dir = Directory('${(await getApplicationSupportDirectory()).path}/install-photos');
    await dir.create(recursive: true);
    final ext = mime == 'image/png'
        ? 'png'
        : mime == 'image/webp'
        ? 'webp'
        : 'jpg';
    final file = File('${dir.path}/$homeId-${DateTime.now().millisecondsSinceEpoch}.$ext');
    await file.writeAsBytes(bytes, flush: true);
    await _remember((p) => p.withPhoto(PendingPhoto(file: file.path, caption: caption.trim(), at: _now, mime: mime)));
  }

  /// Taking a photo back (needs signal; one waiting on the phone is simply dropped).
  Future<void> removePhoto(String photoId) async {
    final r = await _repo.removePhoto(homeId, photoId);
    _put(r);
  }

  Future<void> dropWaitingPhoto(PendingPhoto photo) async {
    await _deleteFile(photo.file);
    await _remember((p) => p.withoutPhoto(photo));
  }

  /// The customer signs: kept on the phone and sent after the ticks (the server wants every item ticked).
  Future<void> sign(String name, String signature) =>
      _remember((p) => p.withSignature(PendingSignature(name: name.trim(), signature: signature, at: _now)));

  Future<void> reopen() async => _put(await _repo.reopen(homeId));

  void _put(InstallReport r) {
    unawaited(_store.cacheReport(homeId, r.raw));
    final v = _view;
    state = AsyncData(v == null ? InstallView(report: r) : v.copyWith(report: r, fromCache: false));
  }

  Future<void> _deleteFile(String path) async {
    try {
      await File(path).delete();
    } catch (_) {
      // already gone
    }
  }

  /// Sends what waits on the phone (one run at a time).
  Future<void> sync() async {
    if (_syncing || _store.load(homeId).isEmpty) return;
    _syncing = true;
    final v = _view;
    if (v != null) state = AsyncData(v.copyWith(sending: true));
    try {
      final r = await flushInstall(
        homeId: homeId,
        store: _store,
        sender: _Sender(_repo, homeId),
        deleteFile: _deleteFile,
      );
      final now = _view;
      if (now == null) return;
      final next = now.copyWith(
        report: r.report ?? now.report,
        pending: _store.load(homeId),
        sending: false,
        fromCache: r.report == null ? now.fromCache : false,
        refused: r.refused,
      );
      if (r.report != null) unawaited(_store.cacheReport(homeId, r.report!.raw));
      state = AsyncData(next);
    } finally {
      _syncing = false;
      final now = _view;
      if (now != null && now.sending) state = AsyncData(now.copyWith(sending: false));
    }
  }
}

final installProvider = AsyncNotifierProvider.autoDispose.family<InstallController, InstallView, String>(
  InstallController.new,
);
