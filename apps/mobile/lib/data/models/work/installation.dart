import 'package:flutter/foundation.dart';

import '../json.dart';

/// A check the server made by itself for a checklist item ("2 of 2 boards online").
@immutable
class AutoCheck {
  const AutoCheck({required this.ok, required this.text});
  final bool ok;
  final String text;
}

@immutable
class InstallItem {
  const InstallItem({required this.key, required this.label, this.done = false, this.note, this.check});

  factory InstallItem.fromJson(Json json) {
    final c = asJson(json['check']);
    return InstallItem(
      key: str(json['key']),
      // the API writes "Wi\u2011Fi" with a non-breaking hyphen the app's font doesn't have
      label: str(json['label']).replaceAll('\u2011', '-'),
      done: boolean(json['done']),
      note: strOrNull(json['note']),
      check: c.isEmpty ? null : AutoCheck(ok: boolean(c['ok']), text: str(c['text']).replaceAll('\u2011', '-')),
    );
  }

  final String key;
  final String label;
  final bool done;
  final String? note;
  final AutoCheck? check;

  InstallItem copyWith({bool? done, String? note}) =>
      InstallItem(key: key, label: label, done: done ?? this.done, note: note ?? this.note, check: check);
}

@immutable
class InstallPhoto {
  const InstallPhoto({required this.id, required this.url, this.caption = '', this.createdAt});

  factory InstallPhoto.fromJson(Json json) => InstallPhoto(
    id: str(json['id']),
    url: str(json['url']),
    caption: str(json['caption']),
    createdAt: dateOrNull(json['createdAt']),
  );

  final String id;

  /// A signed link under the API (`/api/installation/photos/…`), good for two hours.
  final String url;
  final String caption;
  final DateTime? createdAt;
}

/// The installation report of a home (`/platform/homes/:id/installation`).
@immutable
class InstallReport {
  const InstallReport({
    required this.homeId,
    this.home = '',
    this.installer,
    this.items = const [],
    this.notes = '',
    this.signed = false,
    this.signedName,
    this.signedAt,
    this.signature,
    this.photos = const [],
    this.canEdit = false,
    this.canReopen = false,
    this.toInstall = const [],
    this.quoteRefs = const [],
    this.raw = const {},
  });

  factory InstallReport.fromJson(Json json) {
    final ti = asJson(json['toInstall']);
    return InstallReport(
      homeId: str(json['homeId']),
      home: str(json['home']),
      installer: strOrNull(json['installer']),
      items: asJsonList(json['items']).map(InstallItem.fromJson).toList(),
      notes: str(json['notes']),
      signed: boolean(json['signed']),
      signedName: strOrNull(json['signedName']),
      signedAt: dateOrNull(json['signedAt']),
      signature: strOrNull(json['signature']),
      photos: asJsonList(json['photos']).map(InstallPhoto.fromJson).toList(),
      canEdit: boolean(json['canEdit']),
      canReopen: boolean(json['canReopen']),
      toInstall: [
        for (final i in asJsonList(ti['items']))
          (qty: str(i['qty'], '1'), name: str(i['name']), unit: str(i['unit'], 'each')),
      ],
      quoteRefs: [for (final q in asJsonList(ti['quotes'])) str(q['ref'])],
      raw: json,
    );
  }

  final String homeId;
  final String home;
  final String? installer;
  final List<InstallItem> items;
  final String notes;
  final bool signed;
  final String? signedName;
  final DateTime? signedAt;

  /// The customer's drawn signature (a PNG data URL).
  final String? signature;
  final List<InstallPhoto> photos;
  final bool canEdit, canReopen;

  /// What the customer accepted in their quotes: the things to put in.
  final List<({String qty, String name, String unit})> toInstall;
  final List<String> quoteRefs;

  /// The JSON it came from (kept on the phone, so the checklist opens without signal).
  final Json raw;

  int get done => items.where((i) => i.done).length;
  int get total => items.length;
  bool get allTicked => total > 0 && done == total;
  bool get locked => signed || !canEdit;

  InstallReport copyWith({List<InstallItem>? items, String? notes}) => InstallReport(
    homeId: homeId,
    home: home,
    installer: installer,
    items: items ?? this.items,
    notes: notes ?? this.notes,
    signed: signed,
    signedName: signedName,
    signedAt: signedAt,
    signature: signature,
    photos: photos,
    canEdit: canEdit,
    canReopen: canReopen,
    toInstall: toInstall,
    quoteRefs: quoteRefs,
    raw: raw,
  );
}

// ---------------------------------------------------------------- the offline queue

/// A tick or a note made on the phone, with when it was made. Sent later when there's no signal; the
/// server keeps the newest change of each item, so a late tick never undoes a newer one.
@immutable
class PendingTick {
  const PendingTick({required this.key, required this.done, this.note, required this.at});

  factory PendingTick.fromJson(Json json) =>
      // an empty note is a note that was cleared, so it stays ''
      PendingTick(
        key: str(json['key']),
        done: boolean(json['done']),
        note: json['note'] is String ? json['note'] as String : null,
        at: str(json['at']),
      );

  final String key;
  final bool done;
  final String? note;

  /// ISO time it was made on the phone.
  final String at;

  Json toJson() => {'key': key, 'done': done, 'note': ?note, 'at': at};
}

/// A photo taken while offline: the file on the phone, waiting to be sent.
@immutable
class PendingPhoto {
  const PendingPhoto({required this.file, this.caption = '', required this.at, this.mime = 'image/jpeg'});

  factory PendingPhoto.fromJson(Json json) => PendingPhoto(
    file: str(json['file']),
    caption: str(json['caption']),
    at: str(json['at']),
    mime: str(json['mime'], 'image/jpeg'),
  );

  final String file;
  final String caption;
  final String at;
  final String mime;

  Json toJson() => {'file': file, 'caption': caption, 'at': at, 'mime': mime};
}

/// The customer's signature, made while offline.
@immutable
class PendingSignature {
  const PendingSignature({required this.name, required this.signature, required this.at});

  factory PendingSignature.fromJson(Json json) =>
      PendingSignature(name: str(json['name']), signature: str(json['signature']), at: str(json['at']));

  final String name;
  final String signature;
  final String at;

  Json toJson() => {'name': name, 'signature': signature, 'at': at};
}

/// Everything about one home's report that is on this phone and not on the server yet.
@immutable
class PendingInstall {
  const PendingInstall({this.ticks = const [], this.notes, this.photos = const [], this.signature});

  factory PendingInstall.fromJson(Json json) => PendingInstall(
    ticks: asJsonList(json['ticks']).map(PendingTick.fromJson).where((t) => t.key.isNotEmpty).toList(),
    notes: json['notes'] is String ? json['notes'] as String : null,
    photos: asJsonList(json['photos']).map(PendingPhoto.fromJson).where((p) => p.file.isNotEmpty).toList(),
    signature: json['signature'] is Map ? PendingSignature.fromJson(asJson(json['signature'])) : null,
  );

  final List<PendingTick> ticks;

  /// The report's notes, changed on the phone.
  final String? notes;
  final List<PendingPhoto> photos;
  final PendingSignature? signature;

  bool get isEmpty => ticks.isEmpty && notes == null && photos.isEmpty && signature == null;

  /// How many changes wait ("3 changes").
  int get count => ticks.length + (notes != null ? 1 : 0) + photos.length + (signature != null ? 1 : 0);

  Json toJson() => {
    'ticks': [for (final t in ticks) t.toJson()],
    'notes': ?notes,
    'photos': [for (final p in photos) p.toJson()],
    if (signature != null) 'signature': signature!.toJson(),
  };

  /// One change per item: the newest replaces one not sent yet (keeping its note when the new one has none).
  PendingInstall withTick(PendingTick tick) {
    final prev = ticks.where((t) => t.key == tick.key).firstOrNull;
    final merged = PendingTick(key: tick.key, done: tick.done, note: tick.note ?? prev?.note, at: tick.at);
    return PendingInstall(
      ticks: [...ticks.where((t) => t.key != tick.key), merged],
      notes: notes,
      photos: photos,
      signature: signature,
    );
  }

  PendingInstall withNotes(String? text) =>
      PendingInstall(ticks: ticks, notes: text, photos: photos, signature: signature);
  PendingInstall withPhoto(PendingPhoto p) =>
      PendingInstall(ticks: ticks, notes: notes, photos: [...photos, p], signature: signature);
  PendingInstall withSignature(PendingSignature? s) =>
      PendingInstall(ticks: ticks, notes: notes, photos: photos, signature: s);

  /// What's left once [sentTicks] (exactly as they were sent) reached the server: a tick made while
  /// sending stays for the next time.
  PendingInstall afterTicks(List<PendingTick> sentTicks, {bool notesSent = false, String? sentNotes}) => PendingInstall(
    ticks: ticks.where((t) => !sentTicks.any((s) => s.key == t.key && s.at == t.at)).toList(),
    notes: notesSent && notes == sentNotes ? null : notes,
    photos: photos,
    signature: signature,
  );

  PendingInstall withoutPhoto(PendingPhoto p) => PendingInstall(
    ticks: ticks,
    notes: notes,
    photos: photos.where((x) => x.file != p.file).toList(),
    signature: signature,
  );

  /// The report as this phone sees it: the server's, with the changes not sent yet on top.
  InstallReport applyTo(InstallReport r) {
    if (ticks.isEmpty && notes == null) return r;
    final items = [
      for (final i in r.items)
        switch (ticks.where((t) => t.key == i.key).firstOrNull) {
          null => i,
          final t => i.copyWith(done: t.done, note: t.note),
        },
    ];
    return r.copyWith(items: items, notes: notes);
  }
}
