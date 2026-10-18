import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPin, commandSchemaFor, contactType, dhtType, fanSpeeds, fanType, firmwareAtLeast, parseTopic, stateFields, switchCommand, tankType, topics } from './index';

test('topics round-trip through parseTopic', () => {
  assert.deepEqual(parseTopic(topics.deviceState('esp-1a2b', 'bulb')), {
    kind: 'deviceState', nodeId: 'esp-1a2b', key: 'bulb',
  });
  assert.deepEqual(parseTopic(topics.configApplied('esp-1a2b')), { kind: 'configApplied', nodeId: 'esp-1a2b' });
  assert.equal(parseTopic('other/v1/nodes/x/status'), null);
  assert.deepEqual(parseTopic(topics.log('esp-1a2b')), { kind: 'log', nodeId: 'esp-1a2b' });
  assert.equal(parseTopic('home/v1/nodes/x/devices/bulb/other'), null);
  assert.deepEqual(parseTopic(topics.inputEvent('esp-1a2b', 14)), { kind: 'inputEvent', nodeId: 'esp-1a2b', pin: 14 });
  assert.equal(parseTopic('home/v1/nodes/x/inputs/abc/event'), null);
  assert.deepEqual(parseTopic(topics.otaReq('esp-1a2b')), { kind: 'otaReq', nodeId: 'esp-1a2b' });
  assert.deepEqual(parseTopic(topics.otaData('esp-1a2b')), { kind: 'otaData', nodeId: 'esp-1a2b' });
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

test('fan and tank types', () => {
  const fan = fanType.settings.parse({ pins: [4, 14] });
  assert.equal(fanSpeeds(fan), 4);
  assert.deepEqual(fanType.extraPins!(fan), [{ gpio: 4, use: 'output', label: 'relay 2' }, { gpio: 14, use: 'output', label: 'relay 3' }]);
  assert.ok(!fanType.settings.safeParse({ pins: [4] }).success);
  assert.ok(!fanType.settings.safeParse({ pins: [4, 14], speeds: [[0], [3]] }).success);
  assert.ok(commandSchemaFor('fan')!.safeParse({ speed: 3 }).success);
  assert.ok(!commandSchemaFor('switch')!.safeParse({ speed: 3 }).success);
  assert.equal(commandSchemaFor('tank'), null);
  const tank = tankType.settings.parse({ echoPin: 12 });
  assert.equal(tank.emptyCm, 150);
  assert.deepEqual(tankType.extraPins!(tank), [{ gpio: 12, use: 'input', label: 'echo' }]);
  assert.ok(!tankType.settings.safeParse({ echoPin: 12, emptyCm: 30, fullCm: 25 }).success);
  assert.equal(contactType.settings.parse({ kind: 'mains' }).kind, 'mains');
});

test('firmware versions', () => {
  assert.ok(firmwareAtLeast('2.6.0', '2.6.0'));
  assert.ok(firmwareAtLeast('2.10.1', '2.6.0'));
  assert.ok(!firmwareAtLeast('2.5.9', '2.6.0'));
  assert.ok(!firmwareAtLeast(null, '2.6.0'));
});
