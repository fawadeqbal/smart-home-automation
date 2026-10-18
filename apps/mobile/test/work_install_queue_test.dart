import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:switchboard_home/core/network/api_exception.dart';
import 'package:switchboard_home/data/local/install_queue.dart';
import 'package:switchboard_home/data/models/work/installation.dart';

InstallReport report({List<bool> done = const [false, false, false], bool signed = false, int photos = 0}) =>
    InstallReport.fromJson({
      'homeId': 'h1',
      'items': [
        for (final (i, d) in done.indexed) {'key': 'k$i', 'label': 'Item $i', 'done': d},
      ],
      'notes': '',
      'signed': signed,
      'photos': [
        for (var i = 0; i < photos; i++) {'id': 'p$i', 'url': '/api/installation/photos/p$i'},
      ],
      'canEdit': true,
    });

/// Records what reached the "server"; fails with [fail] while it's set.
class FakeSender implements InstallSender {
  final calls = <String>[];
  ApiException? fail;
  ApiException? failPhoto;

  @override
  Future<InstallReport> save(List<PendingTick>? ticks, String? notes) async {
    if (fail != null) throw fail!;
    calls.add(
      'save ${ticks?.map((t) => '${t.key}=${t.done}${t.note != null ? '(${t.note})' : ''}').join(',')} notes=$notes',
    );
    return report(done: [true, true, true]);
  }

  @override
  Future<InstallReport> photo(PendingPhoto photo) async {
    if (fail != null) throw fail!;
    if (failPhoto != null) throw failPhoto!;
    calls.add('photo ${photo.caption}');
    return report(done: [true, true, true], photos: 1);
  }

  @override
  Future<InstallReport> sign(PendingSignature signature) async {
    if (fail != null) throw fail!;
    calls.add('sign ${signature.name}');
    return report(done: [true, true, true], signed: true);
  }
}

Future<InstallQueueStore> store() async {
  SharedPreferences.setMockInitialValues({});
  return InstallQueueStore(await SharedPreferences.getInstance());
}

void main() {
  test('one waiting change per item: the newest wins and keeps a note it didn’t change', () {
    var p = const PendingInstall();
    p = p.withTick(const PendingTick(key: 'k0', done: true, note: 'Used 2.5 mm wire', at: '2026-10-19T10:00:00Z'));
    p = p.withTick(const PendingTick(key: 'k0', done: false, at: '2026-10-19T10:01:00Z'));
    p = p.withTick(const PendingTick(key: 'k1', done: true, at: '2026-10-19T10:02:00Z'));
    expect(p.ticks.length, 2);
    final k0 = p.ticks.firstWhere((t) => t.key == 'k0');
    expect(k0.done, isFalse);
    expect(k0.note, 'Used 2.5 mm wire');
    expect(p.count, 2);
  });

  test('the phone shows the server’s report with its own changes on top', () {
    final p = const PendingInstall()
        .withTick(const PendingTick(key: 'k1', done: true, note: 'checked', at: 'x'))
        .withNotes('Router moved to the hall');
    final shown = p.applyTo(report());
    expect(shown.done, 1);
    expect(shown.items[1].note, 'checked');
    expect(shown.notes, 'Router moved to the hall');
    expect(const PendingInstall().applyTo(report()).done, 0);
  });

  test('a tick made while sending stays for the next time', () {
    const sent = PendingTick(key: 'k0', done: true, at: 'a');
    final later = const PendingInstall().withTick(sent).withTick(const PendingTick(key: 'k0', done: false, at: 'b'));
    final left = later.afterTicks([sent]);
    expect(left.ticks.single.at, 'b');
    expect(const PendingInstall().withTick(sent).afterTicks([sent]).isEmpty, isTrue);
  });

  test('what waits survives a restart of the app (saved as JSON on the phone)', () async {
    final s = await store();
    await s.save(
      'h1',
      const PendingInstall()
          .withTick(const PendingTick(key: 'k0', done: true, note: '', at: 'a'))
          .withNotes('n')
          .withPhoto(const PendingPhoto(file: '/x/1.jpg', caption: 'DB', at: 'b'))
          .withSignature(const PendingSignature(name: 'Ayesha', signature: 'data:image/png;base64,AA', at: 'c')),
    );
    final back = s.load('h1');
    expect(back.ticks.single.note, ''); // a cleared note stays cleared
    expect(back.notes, 'n');
    expect(back.photos.single.caption, 'DB');
    expect(back.signature!.name, 'Ayesha');
    expect(back.count, 4);
    expect(s.load('other').isEmpty, isTrue);
    await s.save('h1', const PendingInstall());
    expect(s.load('h1').isEmpty, isTrue);
  });

  test('without signal nothing is lost; back online it goes in order: ticks, photos, signature', () async {
    final s = await store();
    await s.save(
      'h1',
      const PendingInstall()
          .withTick(const PendingTick(key: 'k0', done: true, at: 'a'))
          .withPhoto(const PendingPhoto(file: '/x/1.jpg', caption: 'DB', at: 'b'))
          .withSignature(const PendingSignature(name: 'Ayesha', signature: 'sig', at: 'c')),
    );
    final send = FakeSender()..fail = const ApiException(0, 'offline');
    final deleted = <String>[];
    var r = await flushInstall(homeId: 'h1', store: s, sender: send, deleteFile: (f) async => deleted.add(f));
    expect(r.offline, isTrue);
    expect(s.load('h1').count, 3);
    expect(send.calls, isEmpty);

    send.fail = null;
    r = await flushInstall(homeId: 'h1', store: s, sender: send, deleteFile: (f) async => deleted.add(f));
    expect(r.offline, isFalse);
    expect(r.refused, isNull);
    expect(r.report!.signed, isTrue);
    expect(send.calls, ['save k0=true notes=null', 'photo DB', 'sign Ayesha']);
    expect(deleted, ['/x/1.jpg']); // the copy on the phone goes once it's sent
    expect(s.load('h1').isEmpty, isTrue);
  });

  test('a change the server refuses for good is dropped and the reason kept; a busy server is tried later', () async {
    final s = await store();
    await s.save('h1', const PendingInstall().withPhoto(const PendingPhoto(file: '/x/2.jpg', at: 'b')));
    final send = FakeSender()..failPhoto = const ApiException(400, 'The report is signed.');
    final r = await flushInstall(homeId: 'h1', store: s, sender: send);
    expect(r.refused, 'The report is signed.');
    expect(s.load('h1').isEmpty, isTrue);

    await s.save('h1', const PendingInstall().withTick(const PendingTick(key: 'k1', done: true, at: 'z')));
    final busy = FakeSender()..fail = const ApiException(503, 'Something went wrong on the server. Try again.');
    final r2 = await flushInstall(homeId: 'h1', store: s, sender: busy);
    expect(r2.offline, isTrue);
    expect(s.load('h1').ticks.single.key, 'k1');
  });

  test('which failures are worth another try', () {
    expect(tryAgainLater(const ApiException(0, 'offline')), isTrue);
    expect(tryAgainLater(const ApiException(502, 'bad gateway')), isTrue);
    expect(tryAgainLater(const ApiException(401, 'expired')), isTrue);
    expect(tryAgainLater(const ApiException(429, 'slow down')), isTrue);
    expect(tryAgainLater(const ApiException(400, 'signed')), isFalse);
    expect(tryAgainLater(const ApiException(403, 'not yours')), isFalse);
    expect(tryAgainLater(const ApiException(404, 'gone')), isFalse);
  });

  test('the report remembers what the server sent, to open without signal', () async {
    final s = await store();
    final r = report(done: [true, false, false]);
    await s.cacheReport('h1', r.raw);
    final back = s.cachedReport('h1')!;
    expect(back.done, 1);
    expect(back.allTicked, isFalse);
    expect(s.cachedReport('nope'), isNull);
  });
}
