import 'package:dio/dio.dart';

import 'session_cookies.dart';

Future<SessionCookies> createSessionCookies() async => _BrowserCookies();

/// The browser keeps the cookies; requests only need to be sent "with credentials".
class _BrowserCookies implements SessionCookies {
  @override
  void attach(Dio dio) => dio.options.extra['withCredentials'] = true;

  @override
  Future<String?> headerFor(Uri uri) async => null;

  @override
  Future<void> clear() async {}
}
