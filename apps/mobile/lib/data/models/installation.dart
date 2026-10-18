import 'dart:convert';

import 'package:flutter/foundation.dart';

import 'json.dart';

/// One line of the installer's checklist.
@immutable
class InstallItem {
  const InstallItem({required this.key, required this.label, this.done = false, this.note, this.checkOk, this.checkText});

  factory InstallItem.fromJson(Json j) {
    final check = asJson(j['check']);
    return InstallItem(
      key: str(j['key']),
      label: str(j['label']),
      done: boolean(j['done']),
      note: strOrNull(j['note']),
      checkOk: check.isEmpty ? null : boolean(check['ok']),
      checkText: strOrNull(check['text']),
    );
  }

  final String key, label;
  final bool done;
  final String? note;

  /// What the server checked by itself ("2 of 2 boards online"), when it can.
  final bool? checkOk;
  final String? checkText;
}

@immutable
class InstallPhoto {
  const InstallPhoto({required this.id, required this.url, this.caption = ''});

  factory InstallPhoto.fromJson(Json j) => InstallPhoto(id: str(j['id']), url: str(j['url']), caption: str(j['caption']));

  final String id;

  /// A signed link under the API ("/api/installation/photos/…?exp=…&sig=…"); no cookie needed.
  final String url;
  final String caption;

  /// The full address on [server] ("https://home.example.com").
  String on(String server) => url.startsWith('http') ? url : '${server.replaceAll(RegExp(r'/+$'), '')}$url';
}

/// The home's copy of its installation report (`/home/installation`; null until the installer starts it).
@immutable
class InstallReport {
  const InstallReport({
    this.installer,
    this.items = const [],
    this.notes = '',
    this.done = 0,
    this.total = 0,
    this.signed = false,
    this.signedName,
    this.signedAt,
    this.signature,
    this.photos = const [],
    this.canSign = false,
  });

  factory InstallReport.fromJson(Json j) => InstallReport(
        installer: strOrNull(j['installer']),
        items: asJsonList(j['items']).map(InstallItem.fromJson).toList(),
        notes: str(j['notes']),
        done: integer(j['done']),
        total: integer(j['total']),
        signed: boolean(j['signed']),
        signedName: strOrNull(j['signedName']),
        signedAt: dateOrNull(j['signedAt']),
        signature: strOrNull(j['signature']),
        photos: asJsonList(j['photos']).map(InstallPhoto.fromJson).toList(),
        canSign: boolean(j['canSign']),
      );

  final String? installer;
  final List<InstallItem> items;
  final String notes;
  final int done, total;
  final bool signed;
  final String? signedName;
  final DateTime? signedAt;

  /// The drawn signature as a PNG data URL.
  final String? signature;
  final List<InstallPhoto> photos;

  /// This person (the owner) may sign it now.
  final bool canSign;

  bool get complete => total > 0 && done >= total;

  /// The signature's PNG bytes (null without one, or if it isn't a PNG data URL).
  Uint8List? get signaturePng => pngFromDataUrl(signature);
}

/// "data:image/png;base64,…" -> the bytes.
Uint8List? pngFromDataUrl(String? url) {
  if (url == null || !url.startsWith('data:image/png;base64,')) return null;
  try {
    return base64Decode(url.substring(url.indexOf(',') + 1));
  } catch (_) {
    return null;
  }
}

/// The bytes -> "data:image/png;base64,…", as the server takes a signature.
String pngDataUrl(Uint8List png) => 'data:image/png;base64,${base64Encode(png)}';
