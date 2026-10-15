import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPin, dhtType, parseTopic, stateFields, switchCommand, topics } from './index';

test('topics round-trip through parseTopic', () => {
  assert.deepEqual(parseTopic(topics.deviceState('esp-1a2b', 'bulb')), {
    kind: 'deviceState', nodeId: 'esp-1a2b', key: 'bulb',
  });
  assert.deepEqual(parseTopic(topics.configApplied('esp-1a2b')), { kind: 'configApplied', nodeId: 'esp-1a2b' });
  assert.equal(parseTopic('other/v1/nodes/x/status'), null);
  assert.deepEqual(parseTopic(topics.log('esp-1a2b')), { kind: 'log', nodeId: 'esp-1a2b' });
  assert.equal(parseTopic('home/v1/nodes/x/devices/bulb/other'), null);
});

test('pin rules', () => {
  assert.equal(checkPin('NODEMCU_V2', 5, 'output'), null);
  assert.match(checkPin('NODEMCU_V2', 16, 'input')!, /D0/);
  assert.match(checkPin('NODEMCU_V2', 7, 'output')!, /GPIO 7 cannot/);
  assert.match(checkPin('NOPE', 5, 'output')!, /Unknown board/);
});

test('settings and commands', () => {
  assert.deepEqual(dhtType.settings.parse({}), { model: 'dht22', intervalSec: 30 });
  assert.ok(switchCommand.safeParse({ on: true }).success);
  assert.ok(!switchCommand.safeParse({ on: 'yes' }).success);
  assert.deepEqual(stateFields({ on: true, cid: 'c1', src: 'remote' }), { on: true });
});
