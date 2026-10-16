import 'dart:async';
import 'dart:io';

import 'package:multicast_dns/multicast_dns.dart';

/// A board's addresses from its name on the Wi‑Fi (`<node id>.local`): the phone's own resolver
/// (iPhone, newer Android), else asking the network directly (mDNS).
Future<List<String>> lookupLocalName(String nodeId) async {
  final name = '$nodeId.local';
  try {
    final found = await InternetAddress.lookup(name).timeout(const Duration(seconds: 2));
    if (found.isNotEmpty) return found.map((a) => a.address).toList();
  } catch (_) {}
  final client = MDnsClient();
  try {
    await client.start();
    final out = <String>[];
    await for (final r in client
        .lookup<IPAddressResourceRecord>(ResourceRecordQuery.addressIPv4(name))
        .timeout(const Duration(seconds: 3), onTimeout: (sink) => sink.close())) {
      out.add(r.address.address);
    }
    return out;
  } catch (_) {
    return const [];
  } finally {
    client.stop();
  }
}
