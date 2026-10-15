import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// A short message above the tab bar — "All off — 4 things changed  [Undo]".
@immutable
class Toast {
  const Toast(this.text, {this.undo, this.error = false, this.id = 0});
  final String text;
  final Future<void> Function()? undo;
  final bool error;
  final int id;
}

class ToastController extends Notifier<Toast?> {
  Timer? _timer;
  int _seq = 0;

  @override
  Toast? build() {
    ref.onDispose(() => _timer?.cancel());
    return null;
  }

  void show(String text, {Future<void> Function()? undo, bool error = false}) {
    _timer?.cancel();
    state = Toast(text, undo: undo, error: error, id: ++_seq);
    _timer = Timer(Duration(milliseconds: undo != null ? 5000 : 3600), hide);
  }

  void error(Object e) => show(e.toString(), error: true);

  void hide() {
    _timer?.cancel();
    state = null;
  }
}

final toastProvider = NotifierProvider<ToastController, Toast?>(
  ToastController.new,
);
