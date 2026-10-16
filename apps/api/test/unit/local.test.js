// Local control: the pass scheme. The same vector is checked by the firmware's host test, the phone
// app's test and the fake board, so all four agree byte for byte.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { keyId, localTag, makePass, passKey, signRequest, newBoardKey } = require('../../dist/hardware/local-pass.js');
const { supportsLocal } = require('../../dist/hardware/local.service.js');

const KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
const VECTOR = {
  pass: 'eyJuIjoiZXNwLWFiYzEyMyIsImUiOjMsInUiOiJ1c2VyLTciLCJ2IjpbInN3MSIsInN3MiIsImRodCJdLCJjIjpbInN3MSJdfQ',
  passKey: 'c88b5b48920afff849584fb72a718bef85089ad27afced32039ea44c8db7b859',
  nonce: '0123456789abcdef',
  path: '/local/command',
  body: '{"key":"sw1","on":true}',
  sig: 'f6101833442aa1b41c2e12817f35b8e8c5be35e0257cce191811c22701ca7268',
};

test('pass, pass key and request signature match the shared vector', () => {
  const pass = makePass({ n: 'esp-abc123', e: 3, u: 'user-7', v: ['sw1', 'sw2', 'dht'], c: ['sw1'] });
  assert.equal(pass, VECTOR.pass);
  assert.equal(passKey(KEY, pass), VECTOR.passKey);
  assert.equal(signRequest(VECTOR.passKey, VECTOR.nonce, VECTOR.path, VECTOR.body), VECTOR.sig);
  assert.equal(keyId(KEY), '2a8abfa8');
  assert.equal(localTag(KEY, 3), '2a8abfa8:3');
});

test('a changed pass or another board key gives another pass key', () => {
  const other = makePass({ n: 'esp-abc123', e: 3, u: 'user-7', v: ['sw1', 'sw2', 'dht'], c: ['sw1', 'sw2'] });
  assert.notEqual(passKey(KEY, other), VECTOR.passKey);
  assert.notEqual(passKey(newBoardKey(), VECTOR.pass), VECTOR.passKey);
  assert.match(newBoardKey(), /^[0-9a-f]{64}$/);
});

test('local control needs firmware 2.5.0', () => {
  assert.equal(supportsLocal('2.4.0'), false);
  assert.equal(supportsLocal('2.5.0'), true);
  assert.equal(supportsLocal('2.5.0-fake'), true);
  assert.equal(supportsLocal('2.10.1'), true);
  assert.equal(supportsLocal(null), false);
});
