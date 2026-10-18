import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/config/app_settings.dart';
import '../core/network/api_client.dart';
import '../core/network/api_exception.dart';
import '../core/realtime/live_client.dart';
import '../data/local/local_link.dart';
import '../data/models/session.dart';
import '../data/repositories/auth_repository.dart';
import '../push/push.dart';

/// The signed-in person and the home the app is showing. `null` = signed out.
///
/// The chosen home is remembered on the phone and sent with every call (X-Home-Id); the live
/// connection follows it.
class SessionController extends AsyncNotifier<Me?> {
  static const _homeKey = 'home_id';

  @override
  Future<Me?> build() async {
    // the API couldn't renew the session: back to sign-in
    ref.listen(sessionExpiredProvider, (_, _) {
      if (state.value != null) state = const AsyncData(null);
    });
    // my rights changed (a guest's hours began or ended, a room was shared): read who I am again
    final changed = ref.read(liveClientProvider).on('access.changed').listen((_) {
      if (state.value != null) unawaited(reload().catchError((Object _) {}));
    });
    ref.onDispose(changed.cancel);
    if (ref.watch(serverUrlProvider) == null) return null;
    return _load(_savedHome());
  }

  Future<Me?> _load(String? homeId) async {
    final api = ref.read(apiClientProvider);
    api.homeId = homeId;
    try {
      return _apply(await ref.read(authRepositoryProvider).me());
    } on ApiException catch (e) {
      if (e.isNotFound && homeId != null) return _load(null); // that home isn't mine any more
      if (e.isUnauthorized) return null;
      rethrow;
    }
  }

  Me _apply(Me me) {
    final homeId = me.home?.id;
    ref.read(apiClientProvider).homeId = homeId;
    final prefs = ref.read(sharedPrefsProvider);
    if (homeId != null) {
      unawaited(prefs.setString(_homeKey, homeId));
    } else {
      unawaited(prefs.remove(_homeKey));
    }
    unawaited(ref.read(liveClientProvider).open(homeId));
    return me;
  }

  String? _savedHome() => ref.read(sharedPrefsProvider).getString(_homeKey);

  /// Returns a ticket when a code is needed next (two-step sign-in); null when signed in.
  Future<String?> signIn(String email, String password) async {
    final repo = ref.read(authRepositoryProvider);
    final ticket = await repo.login(email.trim(), password);
    if (ticket != null) return ticket;
    state = AsyncData(await _load(_savedHome()));
    return null;
  }

  Future<void> signInWithCode(String ticket, String code) async {
    await ref.read(authRepositoryProvider).loginCode(ticket, code);
    state = AsyncData(await _load(_savedHome()));
  }

  Future<void> openHome(String homeId) async {
    final me = await ref.read(authRepositoryProvider).openHome(homeId);
    state = AsyncData(_apply(me));
  }

  /// Re-reads who I am (after my rights changed).
  Future<void> reload() async => state = AsyncData(
    await _load(ref.read(apiClientProvider).homeId ?? _savedHome()),
  );

  Future<void> signOut() async {
    // no more notices to this phone for this person (while still signed in, so the server knows who)
    await ref.read(pushControllerProvider).unregister();
    try {
      await ref.read(authRepositoryProvider).logout();
    } catch (_) {
      // signed out on the phone either way
    }
    await ref.read(sharedPrefsProvider).remove(_homeKey);
    await LocalStore(ref.read(sharedPrefsProvider)).clear(); // no passes for this home stay on the phone
    ref.read(apiClientProvider).homeId = null;
    state = const AsyncData(null);
  }
}

final sessionProvider = AsyncNotifierProvider<SessionController, Me?>(
  SessionController.new,
);

/// The open home's id — providers that load home data watch this, so they reload when it changes.
final currentHomeIdProvider = Provider<String?>(
  (ref) => ref.watch(sessionProvider.select((s) => s.value?.home?.id)),
);

/// The signed-in person (only read where the session is known to be there).
final meProvider = Provider<Me>((ref) => ref.watch(sessionProvider).value!);
