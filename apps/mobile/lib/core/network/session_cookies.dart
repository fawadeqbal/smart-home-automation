import 'package:dio/dio.dart';

import 'session_cookies_stub.dart'
    if (dart.library.io) 'session_cookies_io.dart'
    if (dart.library.js_interop) 'session_cookies_web.dart'
    as impl;

/// The sign-in cookies the API sets (`access`, `refresh`). On phones they live in a cookie jar on
/// disk, so the app stays signed in; on the web the browser keeps them.
abstract class SessionCookies {
  /// Makes [dio] send and store the cookies.
  void attach(Dio dio);

  /// The `Cookie` header for [uri] — the live socket needs it on phones. Null on the web (the browser sends it).
  Future<String?> headerFor(Uri uri);

  Future<void> clear();

  static Future<SessionCookies> create() => impl.createSessionCookies();
}
