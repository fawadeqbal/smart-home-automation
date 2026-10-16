// Unit tests on the built code (pnpm build first). No database or broker needed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { base32, codeAt, verifyCode, recoveryCodes, hashRecovery, seal, unseal, otpauthUri } = require('../../dist/auth/totp.js');
const { describeAgent } = require('../../dist/auth/auth.service.js');
const { backupName, toPrune } = require('../../dist/backups/backup.service.js');

test('authenticator codes match RFC 6238 (SHA-1 test vectors)', () => {
  const secret = base32(Buffer.from('12345678901234567890'));
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(codeAt(secret, Math.floor(59 / 30)), '287082');
  assert.equal(codeAt(secret, Math.floor(1111111109 / 30)), '081804');
  assert.equal(codeAt(secret, Math.floor(1234567890 / 30)), '005924');
  assert.equal(codeAt(secret, Math.floor(2000000000 / 30)), '279037');
});

test('a code works for its 30 seconds (and one step either side), and only once', () => {
  const secret = base32(Buffer.from('12345678901234567890'));
  const at = 1_700_000_000_000;
  const step = Math.floor(at / 30_000);
  assert.equal(verifyCode(secret, codeAt(secret, step), at), step);
  assert.equal(verifyCode(secret, codeAt(secret, step - 1), at), step - 1);
  assert.equal(verifyCode(secret, codeAt(secret, step - 2), at), null);
  assert.equal(verifyCode(secret, codeAt(secret, step), at, step), null); // already used
  assert.equal(verifyCode(secret, '12345', at), null);
  assert.match(otpauthUri(secret, 'a@b.pk', 'Switchboard'), /^otpauth:\/\/totp\/Switchboard%3Aa%40b\.pk\?secret=GEZD/);
});

test('recovery codes are kept as hashes; the secret is kept encrypted', () => {
  const codes = recoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  assert.match(codes[0], /^[a-z0-9]{4}-[a-z0-9]{4}$/);
  assert.equal(hashRecovery(codes[0].toUpperCase()), hashRecovery(codes[0]));
  const sealed = seal('JBSWY3DPEHPK3PXP', 'a-long-server-secret');
  assert.ok(!sealed.includes('JBSWY3DPEHPK3PXP'));
  assert.equal(unseal(sealed, 'a-long-server-secret'), 'JBSWY3DPEHPK3PXP');
  assert.throws(() => unseal(sealed, 'another-secret'));
});

test('sessions say which device they are', () => {
  assert.equal(describeAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36'), 'Chrome on Windows');
  assert.equal(describeAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'), 'Safari on iPhone');
  assert.equal(describeAgent('Dart/3.9 (dart:io)'), 'Switchboard app');
  assert.equal(describeAgent(null), 'Unknown device');
});

test('backups are named by time and old ones pruned, keeping the newest three', () => {
  assert.equal(backupName(new Date(Date.UTC(2026, 9, 16, 22, 0)), false), 'switchboard-20261016-2200.tar.gz');
  assert.equal(backupName(new Date(Date.UTC(2026, 9, 16, 22, 5)), true), 'switchboard-20261016-2205-manual.tar.gz');
  const now = new Date(Date.UTC(2026, 9, 31));
  const daily = Array.from({ length: 30 }, (_, i) => backupName(new Date(Date.UTC(2026, 9, 1 + i, 22)), false));
  const manual = Array.from({ length: 7 }, (_, i) => backupName(new Date(Date.UTC(2026, 9, 1 + i, 12)), true));
  const gone = toPrune([...daily, ...manual, 'notes.txt'], now);
  assert.ok(gone.includes('switchboard-20261001-2200.tar.gz'));
  assert.ok(!gone.includes('switchboard-20261020-2200.tar.gz'));
  assert.equal(gone.filter((n) => n.includes('manual')).length, 2);
  assert.ok(!gone.includes('notes.txt'));
  // a server that was off for a month still keeps its last three
  assert.deepEqual(toPrune(daily.slice(0, 3), new Date(Date.UTC(2026, 11, 1))), []);
});
