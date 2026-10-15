/// Forgiving readers for the API's JSON.
///
/// The server and the app are updated at different times, so a field can be missing, null or of
/// another type than expected. Every reader here answers with a sensible default instead of
/// throwing — a screen shows "—" rather than crashing.
library;

typedef Json = Map<String, dynamic>;

/// An object, or an empty one.
Json asJson(Object? value) => value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};

/// A list of objects; anything in it that isn't an object is skipped.
List<Json> asJsonList(Object? value) => value is List
    ? [
        for (final item in value)
          if (item is Map) Map<String, dynamic>.from(item),
      ]
    : const [];

/// Text, or [fallback] when there's none. Numbers and the like are written out.
String str(Object? value, [String fallback = '']) => switch (value) {
  null => fallback,
  final String s => s,
  _ => '$value',
};

/// Text, or null when it's missing or empty.
String? strOrNull(Object? value) {
  final s = str(value);
  return s.isEmpty ? null : s;
}

/// A list of texts (aliases, scene results); nulls are skipped.
List<String> strList(Object? value) => value is List
    ? [
        for (final item in value)
          if (item != null) str(item),
      ]
    : const [];

bool boolean(Object? value, [bool fallback = false]) => boolOrNull(value) ?? fallback;

/// true/false, also from "true"/"false" (form fields) — null for anything else.
bool? boolOrNull(Object? value) => switch (value) {
  final bool b => b,
  'true' => true,
  'false' => false,
  _ => null,
};

int integer(Object? value, [int fallback = 0]) => switch (value) {
  final int i => i,
  final num n => n.round(),
  final String s => int.tryParse(s) ?? fallback,
  _ => fallback,
};

List<int> intList(Object? value) => value is List
    ? [
        for (final item in value)
          if (item is num) item.round(),
      ]
    : const [];

/// An ISO 8601 time from the server, in the phone's time zone (the screens show local times).
DateTime? dateOrNull(Object? value) => value is String ? DateTime.tryParse(value)?.toLocal() : null;

/// The enum value named [value] (any case: `"OWNER"`, `"voice"`), or [fallback] for a value this
/// version of the app doesn't know yet.
T enumOf<T extends Enum>(List<T> values, Object? value, T fallback) {
  final name = str(value).toLowerCase();
  for (final v in values) {
    if (v.name.toLowerCase() == name) return v;
  }
  return fallback;
}
