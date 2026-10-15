/**
 * Reads Mosquitto's log lines about clients connecting and leaving. Handles both wordings:
 *
 *   2.1   1792104662: New client connected from 39.45.1.2:52208 as esp-7b8278 (p4, c1, k15, u'node').
 *         1792104662: Client esp-7b8278 [39.45.1.2:52208] disconnected.                          clean
 *         1792104664: Client esp-7b8278 [39.45.1.2:52210] disconnected: connection closed by client.
 *         1792104667: Client esp-7b8278 [39.45.1.2:52220] disconnected: session taken over.
 *         1792104672: Client esp-7b8278 [39.45.1.2:48988] disconnected: exceeded timeout.
 *   2.0   1700000000: Client esp-7b8278 has exceeded timeout, disconnecting.
 *         1700000000: Client esp-7b8278 closed its connection.
 *         1700000000: Client esp-7b8278 already connected, closing old connection.
 *         1700000000: Socket error on client esp-7b8278, disconnecting.
 */

/**
 * How a connection ended:
 *  clean     the board said goodbye (it restarted on purpose: update, Wi-Fi change, restart button)
 *  closed    the connection was cut without a goodbye (board reset, router restarted, network dropped it)
 *  timeout   the board stopped answering: power cut, Wi-Fi or internet down
 *  replaced  the board came back on a new connection before the old one timed out (a short drop)
 *  error     the broker closed it (note says why)
 */
export type EndReason = 'clean' | 'closed' | 'timeout' | 'replaced' | 'error';

export type BrokerEvent =
  | { kind: 'connected'; at: Date; clientId: string; ip: string; port: number }
  | { kind: 'ended'; at: Date; clientId: string; ip?: string; port?: number; reason: EndReason; note?: string };

const plainIp = (ip: string) => ip.replace(/^::ffff:/i, '');
const time = (s: string) => new Date(Number(s) * 1000);

const CONNECTED = /^(\d+): New client connected from (\S+?):(\d+) as (\S+) \(/;
const ENDED = /^(\d+): Client (\S+) \[(\S+?):(\d+)\] disconnected(?:: (.+?))?\.?\s*$/;
const OLD = [
  { re: /^(\d+): Client (\S+) has exceeded timeout, disconnecting\.?\s*$/, reason: 'timeout' as const },
  { re: /^(\d+): Client (\S+) closed its connection\.?\s*$/, reason: 'closed' as const },
  { re: /^(\d+): Client (\S+) already connected, closing old connection\.?\s*$/, reason: 'replaced' as const },
  { re: /^(\d+): Socket error on client (\S+), disconnecting\.?\s*$/, reason: 'closed' as const },
  { re: /^(\d+): Client (\S+) disconnected\.?\s*$/, reason: 'clean' as const },
];
const OLD_WITH_NOTE = /^(\d+): Client (\S+) disconnected, (.+?)\.?\s*$/;

function reasonOf(text: string | undefined): { reason: EndReason; note?: string } {
  if (!text) return { reason: 'clean' };
  const t = text.toLowerCase();
  if (t.includes('timeout')) return { reason: 'timeout' };
  if (t.includes('taken over')) return { reason: 'replaced' };
  if (t.includes('closed by client') || t.includes('connection reset') || t.includes('broken pipe')) return { reason: 'closed' };
  return { reason: 'error', note: text };
}

/** One log line -> a connect / disconnect event, or null for everything else. */
export function parseBrokerLine(line: string): BrokerEvent | null {
  let m = line.match(CONNECTED);
  if (m) return { kind: 'connected', at: time(m[1]), ip: plainIp(m[2]), port: Number(m[3]), clientId: m[4] };
  m = line.match(ENDED);
  if (m) return { kind: 'ended', at: time(m[1]), clientId: m[2], ip: plainIp(m[3]), port: Number(m[4]), ...reasonOf(m[5]) };
  for (const { re, reason } of OLD) {
    m = line.match(re);
    if (m) return { kind: 'ended', at: time(m[1]), clientId: m[2], reason };
  }
  m = line.match(OLD_WITH_NOTE);
  if (m) return { kind: 'ended', at: time(m[1]), clientId: m[2], ...reasonOf(m[3]) };
  return null;
}

/** What the people in the app read, for each way a connection ends. */
export const END_TEXT: Record<EndReason, { title: string; why: string }> = {
  clean: { title: 'Restarted on purpose', why: 'the board said goodbye first (an update, a Wi-Fi change or a restart)' },
  closed: { title: 'Connection cut', why: 'it dropped without a goodbye: the board reset, or the router or network cut it' },
  timeout: { title: 'Lost contact', why: 'the board stopped answering: power cut, or Wi-Fi / internet down' },
  replaced: { title: 'Short drop', why: 'it came straight back on a new connection' },
  error: { title: 'Closed by the server', why: 'the broker ended it' },
};
