import type { Request } from 'express';

/** Loopback and private networks: where our own proxies (Caddy, the web app's /api rewrite, Traefik) connect from. */
export function isPrivateAddress(ip: string): boolean {
  return ip === '::1' || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|fc|fd|fe80:)/i.test(ip);
}

const strip = (ip: string) => ip.trim().replace(/^::ffff:/, '');

/**
 * The visitor's address. Behind our own proxy it is in X-Forwarded-For; the header is believed only when
 * the request comes from a private address (a proxy of ours), never from someone reaching the API directly.
 * Proxies append the address they saw on the right, and anything to its left was typed by the client, so
 * the address is taken `hops` from the right: one proxy in front (Caddy in production, or the web app's
 * /api rewrite) is 1. Set TRUST_PROXY_HOPS when there are two (e.g. a load balancer before Caddy).
 */
export function clientIp(req: Pick<Request, 'headers' | 'socket'>, hops = Number(process.env.TRUST_PROXY_HOPS || 1)): string {
  const peer = strip(req.socket?.remoteAddress ?? '');
  const header = req.headers['x-forwarded-for'];
  const chain = (Array.isArray(header) ? header.join(',') : String(header ?? '')).split(',').map(strip).filter(Boolean);
  if (!peer || !isPrivateAddress(peer) || !chain.length || hops < 1) return peer || 'unknown';
  return chain[Math.max(0, chain.length - hops)]!.slice(0, 64);
}
