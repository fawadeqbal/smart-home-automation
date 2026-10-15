import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio/dio.dart';
import 'package:dio_cookie_manager/dio_cookie_manager.dart';
import 'package:path_provider/path_provider.dart';

import 'session_cookies.dart';

Future<SessionCookies> createSessionCookies() async {
  final dir = await getApplicationSupportDirectory();
  return _JarCookies(
    PersistCookieJar(storage: FileStorage('${dir.path}/cookies/')),
  );
}

class _JarCookies implements SessionCookies {
  _JarCookies(this.jar);
  final PersistCookieJar jar;

  @override
  void attach(Dio dio) => dio.interceptors.add(CookieManager(jar));

  @override
  Future<String?> headerFor(Uri uri) async {
    final cookies = await jar.loadForRequest(uri);
    return cookies.isEmpty ? null : cookies.map((c) => '${c.name}=${c.value}').join('; ');
  }

  @override
  Future<void> clear() => jar.deleteAll();
}
