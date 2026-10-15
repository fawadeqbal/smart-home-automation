import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The time, ticking every 30 seconds (greetings, "in 25 min", "2 min ago").
final nowProvider = StreamProvider<DateTime>((ref) async* {
  yield DateTime.now();
  yield* Stream.periodic(const Duration(seconds: 30), (_) => DateTime.now());
});
