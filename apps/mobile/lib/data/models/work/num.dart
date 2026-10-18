/// Numbers from the API's JSON for the staff screens (a missing or odd value never throws).
library;

double? dblOrNull(Object? v) => switch (v) {
  final num n => n.toDouble(),
  final String s => double.tryParse(s),
  _ => null,
};

int? intOrNull(Object? v) => switch (v) {
  final int i => i,
  final num n => n.round(),
  final String s => int.tryParse(s),
  _ => null,
};
