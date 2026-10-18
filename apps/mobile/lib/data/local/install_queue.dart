import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../../core/network/api_exception.dart';
import '../models/json.dart';
import '../models/work/installation.dart';

/// Installation report changes kept on the phone until they reach the server (like the web console's
/// offline checklist): ticks and notes, the report's notes, photos and the customer's signature.
///
/// Everything is saved first and sent after. Without signal it waits; it goes when the phone is back
/// online. The server keeps the newest change of each item, so ticks sent late never undo a newer one.
class InstallQueueStore {
  InstallQueueStore(this._prefs);
  final SharedPreferences _prefs;

  static String _key(String homeId) => 'sb.install.pending.$homeId';
  static String _reportKey(String homeId) => 'sb.install.report.$homeId';

  PendingInstall load(String homeId) {
    try {
      final raw = _prefs.getString(_key(homeId));
      return raw == null ? const PendingInstall() : PendingInstall.fromJson(asJson(jsonDecode(raw)));
    } catch (_) {
      return const PendingInstall();
    }
  }

  Future<void> save(String homeId, PendingInstall p) async {
    if (p.isEmpty) {
      await _prefs.remove(_key(homeId));
    } else {
      await _prefs.setString(_key(homeId), jsonEncode(p.toJson()));
    }
  }

  /// The last report the server sent, so the checklist opens without signal.
  InstallReport? cachedReport(String homeId) {
    try {
      final raw = _prefs.getString(_reportKey(homeId));
      return raw == null ? null : InstallReport.fromJson(asJson(jsonDecode(raw)));
    } catch (_) {
      return null;
    }
  }

  Future<void> cacheReport(String homeId, Json raw) => _prefs.setString(_reportKey(homeId), jsonEncode(raw));
}

/// How the queue reaches the server (the repository; a fake in tests).
abstract interface class InstallSender {
  Future<InstallReport> save(List<PendingTick>? ticks, String? notes);
  Future<InstallReport> photo(PendingPhoto photo);
  Future<InstallReport> sign(PendingSignature signature);
}

/// A failure worth trying again later (no signal, the server busy or restarting, the session being
/// renewed). Anything else is the server saying no — signed already, not their home — and can never
/// go through, so that change is dropped and the person told why.
bool tryAgainLater(Object error) {
  final e = ApiException.from(error);
  return e.isOffline || e.status < 0 || e.status >= 500 || e.status == 401 || e.status == 408 || e.status == 429;
}

/// The outcome of sending what waited: the newest report, and the server's reason if it refused something.
typedef FlushResult = ({InstallReport? report, String? refused, bool offline});

/// Sends a home's waiting changes in order: ticks and notes, then photos one by one, then the signature
/// (the server only takes a signature once every item is ticked). Stops at the first "try again later".
Future<FlushResult> flushInstall({
  required String homeId,
  required InstallQueueStore store,
  required InstallSender sender,
  Future<void> Function(String file)? deleteFile,
}) async {
  InstallReport? report;
  String? refused;
  var p = store.load(homeId);

  // 1. ticks and notes, in one call
  if (p.ticks.isNotEmpty || p.notes != null) {
    final ticks = p.ticks;
    final notes = p.notes;
    try {
      report = await sender.save(ticks.isEmpty ? null : ticks, notes);
      // only forget what was sent: a tick made while sending stays for the next time
      p = store.load(homeId).afterTicks(ticks, notesSent: notes != null, sentNotes: notes);
      await store.save(homeId, p);
    } catch (e) {
      if (tryAgainLater(e)) return (report: report, refused: null, offline: true);
      refused = ApiException.from(e).message;
      p = store.load(homeId).afterTicks(ticks, notesSent: true, sentNotes: notes);
      await store.save(homeId, p);
    }
  }

  // 2. photos
  for (final photo in [...p.photos]) {
    try {
      report = await sender.photo(photo);
    } catch (e) {
      if (tryAgainLater(e)) return (report: report, refused: refused, offline: true);
      refused ??= ApiException.from(e).message;
    }
    // sent, or refused for good (too many photos, a signed report): the copy on the phone goes
    await deleteFile?.call(photo.file);
    p = store.load(homeId).withoutPhoto(photo);
    await store.save(homeId, p);
  }

  // 3. the customer's signature
  final sig = p.signature;
  if (sig != null) {
    try {
      report = await sender.sign(sig);
    } catch (e) {
      if (tryAgainLater(e)) return (report: report, refused: refused, offline: true);
      refused ??= ApiException.from(e).message;
    }
    p = store.load(homeId).withSignature(null);
    await store.save(homeId, p);
  }
  return (report: report, refused: refused, offline: false);
}
