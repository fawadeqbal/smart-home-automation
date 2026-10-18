import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/realtime/live_client.dart';
import '../data/models/notice.dart';
import '../data/repositories/notices_repository.dart';
import 'session.dart';

/// My notices (the bell), kept live: a new one arrives over the socket (`notification`), reading them
/// elsewhere (the web app) reloads (`notifications.read`).
class NoticesController extends AsyncNotifier<NoticeList> {
  @override
  Future<NoticeList> build() async {
    // signed out: nothing; a different person or home: start again
    final me = ref.watch(sessionProvider.select((s) => s.value?.id));
    if (me == null) return const NoticeList();
    final sub = ref.watch(liveClientProvider).events.listen((e) {
      if (e.name == 'notification') _add(Notice.fromJson(e.map));
      if (e.name == 'notifications.read') unawaited(refresh());
    });
    ref.onDispose(sub.cancel);
    return ref.read(noticesRepositoryProvider).list();
  }

  void _add(Notice n) {
    final now = state.value ?? const NoticeList();
    if (now.items.any((x) => x.id == n.id)) return;
    state = AsyncData(NoticeList(items: [n, ...now.items].take(50).toList(), unread: now.unread + 1));
  }

  Future<void> refresh() async {
    try {
      state = AsyncData(await ref.read(noticesRepositoryProvider).list());
    } catch (e, st) {
      if (state.value == null) state = AsyncError(e, st);
    }
  }

  Future<void> markRead(String id) async {
    final now = state.value;
    if (now == null) return;
    final n = now.items.where((x) => x.id == id).firstOrNull;
    if (n == null || !n.unread) return;
    state = AsyncData(NoticeList(items: [for (final x in now.items) x.id == id ? x.markRead() : x], unread: (now.unread - 1).clamp(0, 1 << 30)));
    try {
      await ref.read(noticesRepositoryProvider).markRead(id);
    } catch (_) {
      state = AsyncData(now);
    }
  }

  Future<void> markAllRead() async {
    final now = state.value;
    if (now == null) return;
    state = AsyncData(NoticeList(items: [for (final x in now.items) x.markRead()]));
    try {
      await ref.read(noticesRepositoryProvider).markAllRead();
    } catch (_) {
      state = AsyncData(now);
    }
  }
}

final noticesProvider = AsyncNotifierProvider<NoticesController, NoticeList>(NoticesController.new);

/// The number on the bell.
final unreadNoticesProvider = Provider<int>((ref) => ref.watch(noticesProvider.select((s) => s.value?.unread ?? 0)));
