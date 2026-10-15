import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../models/json.dart';
import '../models/people.dart';

/// The open home as a whole: who looks after it, and asking them for help (`/home/*`).
class HomeRepository {
  const HomeRepository(this._api);
  final ApiClient _api;

  Future<HomeWelcome> welcome() async => HomeWelcome.fromJson(asJson(await _api.get<Object?>('/home/welcome')));

  /// A message to the installer and the company's support (owners and admins).
  Future<void> askForHelp(String message) => _api.post<Object?>('/home/support', {'message': message});
}

final homeRepositoryProvider = Provider<HomeRepository>(
  (ref) => HomeRepository(ref.watch(apiClientProvider)),
);
