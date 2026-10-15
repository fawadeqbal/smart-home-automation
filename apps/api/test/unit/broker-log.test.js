// The broker log parser, on real Mosquitto 2.1 lines (recorded) and the 2.0 wording.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseBrokerLine } = require('../../dist/hardware/broker-log.js');
const { isLocalIp, tidyIsp } = require('../../dist/hardware/geo.service.js');
const { duration } = require('../../dist/hardware/connections.service.js');

const reason = (line) => parseBrokerLine(line)?.reason;

test('a board connecting: public IP, port, id', () => {
  const ev = parseBrokerLine("1792066545: New client connected from 103.204.32.214:63072 as esp-7b8278 (p4, c1, k15, u'node').");
  assert.deepEqual(ev, { kind: 'connected', at: new Date(1792066545000), ip: '103.204.32.214', port: 63072, clientId: 'esp-7b8278' });
  assert.equal(parseBrokerLine('1: New client connected from ::ffff:1.2.3.4:5 as esp-a (p4, c1, k60).').ip, '1.2.3.4');
  assert.equal(parseBrokerLine('1: New client connected from 2001:db8::1:51234 as esp-a (p4, c1, k60).').ip, '2001:db8::1');
});

test('how a connection ended (Mosquitto 2.1)', () => {
  assert.equal(reason('1792104662: Client esp-clean [127.0.0.1:52208] disconnected.'), 'clean');
  assert.equal(reason('1792104664: Client esp-killed [127.0.0.1:52210] disconnected: connection closed by client.'), 'closed');
  assert.equal(reason('1792104667: Client esp-dup [127.0.0.1:52220] disconnected: session taken over.'), 'replaced');
  assert.equal(reason('1792104672: Client esp-silent [172.17.0.1:48988] disconnected: exceeded timeout.'), 'timeout');
  const odd = parseBrokerLine('1: Client esp-x [1.2.3.4:5] disconnected: not authorised.');
  assert.equal(odd.reason, 'error');
  assert.equal(odd.note, 'not authorised');
  assert.equal(parseBrokerLine('1: Client esp-x [1.2.3.4:5] disconnected.').port, 5);
});

test('how a connection ended (Mosquitto 2.0 wording)', () => {
  assert.equal(reason('1: Client esp-x has exceeded timeout, disconnecting.'), 'timeout');
  assert.equal(reason('1: Client esp-x closed its connection.'), 'closed');
  assert.equal(reason('1: Client esp-x already connected, closing old connection.'), 'replaced');
  assert.equal(reason('1: Socket error on client esp-x, disconnecting.'), 'closed');
  assert.equal(reason('1: Client esp-x disconnected.'), 'clean');
});

test('other broker lines are ignored', () => {
  for (const line of [
    '1792104732: New connection from 127.0.0.1:56164 on port 8883.',
    '1792104732: Client esp-7b8278 negotiated TLSv1.3 cipher TLS_AES_256_GCM_SHA384',
    '1792104661: Warning: Address family not supported by protocol',
    'nt connected from 127.0.0.1:51470 as esp-y', // half a line after a trim
    '',
  ]) assert.equal(parseBrokerLine(line), null, line);
});

test('local addresses are not looked up; provider names are tidied', () => {
  for (const ip of ['192.168.1.5', '10.0.0.2', '172.20.1.1', '100.70.1.1', '127.0.0.1', '::1', 'fd00::5', '::ffff:192.168.0.9']) assert.ok(isLocalIp(ip), ip);
  for (const ip of ['103.204.32.210', '223.123.94.82', '172.32.0.1', '8.8.8.8']) assert.ok(!isLocalIp(ip), ip);
  assert.equal(tidyIsp('Pakistan Telecommunication Company Limited'), 'Pakistan Telecommunication Company');
  assert.equal(tidyIsp('CMPak Limited'), 'CMPak');
  assert.equal(tidyIsp('Google LLC'), 'Google');
  assert.equal(tidyIsp('Pace Telecom and Brodcasting (Pvt.) Ltd.'), 'Pace Telecom and Brodcasting');
});

test('durations read naturally', () => {
  assert.equal(duration(42_000), '42 s');
  assert.equal(duration(5 * 60_000), '5 min');
  assert.equal(duration((3 * 60 + 12) * 60_000), '3 h 12 min');
  assert.equal(duration(5 * 86400_000), '5 days');
  assert.equal(duration(86400_000), '1 day');
  assert.equal(duration((47 * 60 + 58) * 60_000), '1 day 23 h');
});
