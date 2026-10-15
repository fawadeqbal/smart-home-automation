import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../models/json.dart';
import '../models/session.dart';

/// Signing in and out, who I am, and which home is open (`/auth/*`). The session lives in cookies
/// the [ApiClient] keeps; these calls only start, read or end it.
class AuthRepository {
  const AuthRepository(this._api);
  final ApiClient _api;

  /// Is there a Switchboard API at this address? (`/auth/status` answers without signing in.)
  Future<bool> serverReachable() async {
    try {
      final status = await _api.get<Object?>('/auth/status');
      // any web server answers something; only ours says whether setup is needed
      return status is Map && status.containsKey('setupNeeded');
    } catch (_) {
      return false;
    }
  }

  Future<Me> login(String email, String password) async =>
      Me.fromJson(asJson(await _api.post<Object?>('/auth/login', {'email': email, 'password': password})));

  Future<Me> me() async => Me.fromJson(asJson(await _api.get<Object?>('/auth/me')));

  /// Opens another of my homes; the server remembers it for next time.
  Future<Me> openHome(String homeId) async =>
      Me.fromJson(asJson(await _api.post<Object?>('/auth/home', {'homeId': homeId})));

  Future<void> logout() => _api.post<Object?>('/auth/logout');
}

final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => AuthRepository(ref.watch(apiClientProvider)),
);
