import { createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * Local control: how the phone app proves to a board, with no server in between, who it is and what
 * it may do. The same rules are in the firmware (src/net/LocalAuth.h), the phone app
 * (lib/data/local/local_pass.dart) and tools/fake-node; the test vector in local-pass.test.ts is
 * checked by all of them.
 *
 *   board key   64 hex characters, random per board and home; the board keeps it in flash
 *   pass        base64url (no padding) of {"n": board, "e": epoch, "u": user, "v": [...], "c": [...]}
 *               v = device keys they may see, c = device keys they may switch; time-limited people's
 *               passes also carry "x": when it stops working (unix seconds; boards that know the time
 *               check it, and the server raises the epoch then for those that don't)
 *   pass key    hex HMAC-SHA256(key = board key, "pass:" + pass): only the server and the board can
 *               make it, so a pass can't be edited or made up
 *   request     headers X-Pass, X-Nonce (from GET /local/hello, used once), X-Sig =
 *               hex HMAC-SHA256(key = pass key, nonce + "\n" + path + "\n" + body)
 *
 * Bumping the home's epoch (someone removed, rights reduced) makes every older pass useless as soon
 * as the boards hear the new epoch.
 */
export interface PassBody {
  n: string;
  e: number;
  u: string;
  v: string[];
  c: string[];
  /** unix seconds the pass stops working (time-limited access only) */
  x?: number;
}

export const newBoardKey = () => randomBytes(32).toString('hex');

/** Short, public fingerprint of a key: lets the board say which key it holds without revealing it. */
export const keyId = (key: string) => createHash('sha256').update(key).digest('hex').slice(0, 8);

export const localTag = (key: string, epoch: number) => `${keyId(key)}:${epoch}`;

export function makePass(body: PassBody): string {
  return Buffer.from(JSON.stringify(body)).toString('base64url');
}

export function passKey(boardKey: string, pass: string): string {
  return createHmac('sha256', boardKey).update(`pass:${pass}`).digest('hex');
}

export function signRequest(key: string, nonce: string, path: string, body: string): string {
  return createHmac('sha256', key).update(`${nonce}\n${path}\n${body}`).digest('hex');
}
