import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config/app_settings.dart';
import 'api_exception.dart';
import 'session_cookies.dart';

/// Provided in `main()` once the cookie store is open.
final sessionCookiesProvider = Provider<SessionCookies>(
  (ref) => throw UnimplementedError('Override sessionCookiesProvider in main()'),
);

/// Called when the session can't be renewed (signed out elsewhere, or the refresh token expired).
typedef SessionExpired = void Function();

/// Talks to the Switchboard API at `<server>/api`.
///
/// * Signs in with the same cookies as the web app (`access` for 15 minutes, `refresh` to renew it).
///   A 401 renews once — several calls failing together share one renewal — then retries.
/// * Every call names the home it's about with `X-Home-Id` ([homeId]).
/// * Errors come back as [ApiException] with the server's message.
class ApiClient {
  ApiClient({required this.server, required this.cookies, this.onExpired}) {
    dio = Dio(
      BaseOptions(
        baseUrl: '$server/api',
        connectTimeout: const Duration(seconds: 10),
        receiveTimeout: const Duration(seconds: 30),
        contentType: Headers.jsonContentType,
        responseType: ResponseType.json,
      ),
    );
    cookies.attach(dio);
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          final home = homeId;
          if (home != null && !options.headers.containsKey(homeHeader)) options.headers[homeHeader] = home;
          handler.next(options);
        },
        onError: (error, handler) async {
          final path = error.requestOptions.path;
          final retried = error.requestOptions.extra['retried'] == true;
          if (error.response?.statusCode == 401 && !path.startsWith('/auth/') && !retried) {
            if (await refresh()) {
              try {
                final options = error.requestOptions..extra['retried'] = true;
                return handler.resolve(await dio.fetch<dynamic>(options));
              } on DioException catch (e) {
                return handler.next(e);
              }
            }
            onExpired?.call();
          }
          handler.next(error);
        },
      ),
    );
  }

  static const homeHeader = 'X-Home-Id';

  final String server;
  final SessionCookies cookies;
  final SessionExpired? onExpired;
  late final Dio dio;

  /// The home every call is about. Set by the session when a home is opened.
  String? homeId;

  Future<bool>? _refreshing;

  /// Renews the 15-minute access cookie with the refresh cookie. One renewal at a time.
  Future<bool> refresh() => _refreshing ??= () async {
    try {
      await dio.post<dynamic>('/auth/refresh', data: <String, dynamic>{});
      return true;
    } catch (_) {
      return false;
    } finally {
      Future<void>.delayed(
        const Duration(milliseconds: 50),
        () => _refreshing = null,
      );
    }
  }();

  Uri get socketUri {
    // the dev web app runs on :3000 and the API on :4000 — the socket lives with the API
    final uri = Uri.parse(server);
    return uri.port == 3000 ? uri.replace(port: 4000) : uri;
  }

  Future<T> get<T>(String path, {Map<String, dynamic>? query}) =>
      _send<T>(() => dio.get<dynamic>(path, queryParameters: query));
  Future<T> post<T>(String path, [Object? body]) => _send<T>(
    () => dio.post<dynamic>(path, data: body ?? <String, dynamic>{}),
  );
  Future<T> patch<T>(String path, Object body) => _send<T>(() => dio.patch<dynamic>(path, data: body));
  Future<T> put<T>(String path, Object body) => _send<T>(() => dio.put<dynamic>(path, data: body));
  Future<T> delete<T>(String path) => _send<T>(() => dio.delete<dynamic>(path));

  /// multipart/form-data upload (voice recordings).
  Future<T> upload<T>(
    String path, {
    required String field,
    required List<int> bytes,
    required String filename,
    required String mimeType,
  }) {
    final form = FormData.fromMap({
      field: MultipartFile.fromBytes(
        bytes,
        filename: filename,
        contentType: DioMediaType.parse(mimeType),
      ),
    });
    return _send<T>(
      () => dio.post<dynamic>(
        path,
        data: form,
        options: Options(
          contentType: 'multipart/form-data',
          receiveTimeout: const Duration(seconds: 90),
        ),
      ),
    );
  }

  Future<T> _send<T>(Future<Response<dynamic>> Function() call) async {
    try {
      final res = await call();
      return res.data as T;
    } catch (e) {
      throw ApiException.from(e);
    }
  }
}

/// The API client for the configured server (rebuilt when the server address changes).
final apiClientProvider = Provider<ApiClient>((ref) {
  final server = ref.watch(serverUrlProvider) ?? 'http://localhost';
  return ApiClient(
    server: server,
    cookies: ref.watch(sessionCookiesProvider),
    onExpired: () => ref.read(sessionExpiredProvider.notifier).fire(),
  );
});

/// Ticks when the session expired; the session listens and signs out.
class SessionExpiredSignal extends Notifier<int> {
  @override
  int build() => 0;
  void fire() => state++;
}

final sessionExpiredProvider = NotifierProvider<SessionExpiredSignal, int>(
  SessionExpiredSignal.new,
);
