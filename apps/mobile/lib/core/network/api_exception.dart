import 'package:dio/dio.dart';

/// An API call that failed, with the server's own words when it gave any (NestJS `{ message }`).
class ApiException implements Exception {
  const ApiException(this.status, this.message, {this.code});

  /// HTTP status; 0 when the server couldn't be reached at all.
  final int status;
  final String message;

  /// The server's own reason, when it gives one (`ups`: the home is on UPS, ask before a heavy load).
  final String? code;

  bool get isUnauthorized => status == 401;
  bool get isForbidden => status == 403;
  bool get isNotFound => status == 404;
  bool get isOffline => status == 0;

  factory ApiException.from(Object error) {
    if (error is ApiException) return error;
    if (error is DioException) {
      final res = error.response;
      if (res == null) {
        return switch (error.type) {
          DioExceptionType.connectionTimeout ||
          DioExceptionType.receiveTimeout ||
          DioExceptionType.sendTimeout => const ApiException(
            0,
            'The server took too long to answer. Check your connection and try again.',
          ),
          _ => const ApiException(
            0,
            'Can’t reach your Switchboard server. Check your connection.',
          ),
        };
      }
      final data = res.data;
      String? message;
      String? code;
      if (data is Map) {
        final m = data['message'];
        message = m is List ? m.join('; ') : m?.toString();
        if (data['code'] is String) code = data['code'] as String;
      } else if (data is String && data.isNotEmpty && data.length < 200 && !data.trimLeft().startsWith('<')) {
        message = data;
      }
      final status = res.statusCode ?? 0;
      return ApiException(
        status,
        message ?? (status >= 500 ? 'Something went wrong on the server. Try again.' : 'Request failed ($status).'),
        code: code,
      );
    }
    return ApiException(-1, error.toString());
  }

  @override
  String toString() => message;
}

/// A readable message for any error.
String errorText(Object error) => ApiException.from(error).message;
