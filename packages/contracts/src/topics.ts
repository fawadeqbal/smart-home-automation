/**
 * MQTT topic scheme. The firmware (firmware/home_node/src/net/Topics.h) and the fake
 * node (tools/fake-node) use the same strings: change all three together.
 *
 *   home/v1/nodes/{nodeId}/status                 board -> all     retained   online / Last Will
 *   home/v1/nodes/{nodeId}/announce               board -> server  retained   chip, board, firmware
 *   home/v1/nodes/{nodeId}/config                 server -> board  retained   devices + inputs
 *   home/v1/nodes/{nodeId}/config/applied         board -> server             {rev, ok, error?}
 *   home/v1/nodes/{nodeId}/devices/{key}/set      server -> board  NOT retained  command
 *   home/v1/nodes/{nodeId}/devices/{key}/state    board -> all     retained   state
 *   home/v1/nodes/{nodeId}/telemetry              board -> server             rssi, heap, uptime
 *   home/v1/nodes/{nodeId}/cmd                    server -> board             reboot ...
 *   home/v1/nodes/{nodeId}/log                    board -> server             one log line (live logs)
 *   home/v1/nodes/{nodeId}/network                board -> server             Wi-Fi scan results / Wi-Fi change result
 *   home/v1/nodes/{nodeId}/inputs/{pin}/event     board -> server             a button press or wall switch flip
 *   home/v1/nodes/{nodeId}/ota/req                board -> server             {from, count}: send me these firmware chunks (2.6.3+)
 *   home/v1/nodes/{nodeId}/ota/data               server -> board  binary     4 bytes offset (LE) + the chunk
 */
export const ROOT = 'home/v1';

export const topics = {
  status: (nodeId: string) => `${ROOT}/nodes/${nodeId}/status`,
  announce: (nodeId: string) => `${ROOT}/nodes/${nodeId}/announce`,
  config: (nodeId: string) => `${ROOT}/nodes/${nodeId}/config`,
  configApplied: (nodeId: string) => `${ROOT}/nodes/${nodeId}/config/applied`,
  deviceSet: (nodeId: string, key: string) => `${ROOT}/nodes/${nodeId}/devices/${key}/set`,
  deviceState: (nodeId: string, key: string) => `${ROOT}/nodes/${nodeId}/devices/${key}/state`,
  telemetry: (nodeId: string) => `${ROOT}/nodes/${nodeId}/telemetry`,
  cmd: (nodeId: string) => `${ROOT}/nodes/${nodeId}/cmd`,
  log: (nodeId: string) => `${ROOT}/nodes/${nodeId}/log`,
  network: (nodeId: string) => `${ROOT}/nodes/${nodeId}/network`,
  inputEvent: (nodeId: string, pin: number) => `${ROOT}/nodes/${nodeId}/inputs/${pin}/event`,
  otaReq: (nodeId: string) => `${ROOT}/nodes/${nodeId}/ota/req`,
  otaData: (nodeId: string) => `${ROOT}/nodes/${nodeId}/ota/data`,
  /** What the server subscribes to. */
  allFromNodes: `${ROOT}/nodes/+/#`,
};

export type ParsedTopic =
  | { kind: 'status' | 'announce' | 'config' | 'configApplied' | 'telemetry' | 'cmd' | 'log' | 'network' | 'otaReq' | 'otaData'; nodeId: string }
  | { kind: 'deviceSet' | 'deviceState'; nodeId: string; key: string }
  | { kind: 'inputEvent'; nodeId: string; pin: number };

const SAFE = /^[a-z0-9][a-z0-9_-]{0,47}$/;

/** Ids and keys are lowercase letters, digits, '-' and '_' so they are always safe in a topic. */
export function isSafeId(value: string): boolean {
  return SAFE.test(value);
}

export function parseTopic(topic: string): ParsedTopic | null {
  const parts = topic.split('/');
  if (parts.length < 5 || `${parts[0]}/${parts[1]}` !== ROOT || parts[2] !== 'nodes') return null;
  const nodeId = parts[3];
  const rest = parts.slice(4).join('/');
  switch (rest) {
    case 'status':
    case 'announce':
    case 'config':
    case 'telemetry':
    case 'cmd':
    case 'log':
    case 'network':
      return { kind: rest, nodeId };
    case 'config/applied':
      return { kind: 'configApplied', nodeId };
    case 'ota/req':
      return { kind: 'otaReq', nodeId };
    case 'ota/data':
      return { kind: 'otaData', nodeId };
  }
  if (parts.length === 7 && parts[4] === 'devices' && (parts[6] === 'set' || parts[6] === 'state')) {
    return { kind: parts[6] === 'set' ? 'deviceSet' : 'deviceState', nodeId, key: parts[5] };
  }
  if (parts.length === 7 && parts[4] === 'inputs' && parts[6] === 'event' && /^\d{1,2}$/.test(parts[5]!)) {
    return { kind: 'inputEvent', nodeId, pin: Number(parts[5]) };
  }
  return null;
}
