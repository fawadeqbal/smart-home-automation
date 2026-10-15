import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { AsnResponse, CityResponse, open, Reader } from 'maxmind';
import { Settings, SETTINGS } from '../config';

export interface Place {
  /** "Lahore, Punjab, PK" (or "Local network") */
  place: string | null;
  /** the internet provider, e.g. "PTCL" */
  isp: string | null;
}


const FILES = { city: 'dbip-city-lite.mmdb', asn: 'dbip-asn-lite.mmdb' } as const;
const REFRESH_DAYS = 35;        // DB-IP publishes a new lite edition every month
const IDLE_MS = 10 * 60_000;    // the city file is ~130 MB in memory: let it go when boards are quiet

/** Private, loopback, carrier-grade NAT and link-local addresses: no place to look up. */
export function isLocalIp(ip: string): boolean {
  const v4 = ip.replace(/^::ffff:/i, '');
  const m = v4.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || a === 0;
  }
  const v6 = ip.toLowerCase();
  return v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

/** Tidies provider names: "Pakistan Telecommuication Company Limited" -> "Pakistan Telecommuication Company". */
export function tidyIsp(name: string | undefined | null): string | null {
  if (!name) return null;
  return name
    .replace(/\b(limited|ltd|pvt|private|inc|llc)\b\.?/gi, ' ')
    .replace(/\(\s*\)/g, ' ')
    .replace(/[\s,.-]+$/, '')
    .replace(/\s+/g, ' ')
    .trim() || null;
}

/**
 * Where an IP address is: city and internet provider, from DB-IP's free "lite" databases
 * (CC BY 4.0, https://db-ip.com), downloaded once a month and kept on this server, so customers'
 * addresses are never sent to anyone. Without the files (no internet yet, GEOIP=off) lookups
 * simply return nothing.
 */
@Injectable()
export class GeoService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Geo');
  private readers: { city?: Reader<CityResponse>; asn?: Reader<AsnResponse> } = {};
  private idle?: NodeJS.Timeout;
  private daily?: NodeJS.Timeout;
  private updating?: Promise<void>;
  private readonly cache = new Map<string, Place>();

  constructor(@Inject(SETTINGS) private readonly settings: Settings) {}

  onModuleInit() {
    if (!this.settings.geoDir) return;
    void this.refresh();
    this.daily = setInterval(() => void this.refresh(), 24 * 3600_000);
    this.daily.unref();
  }

  onModuleDestroy() {
    clearInterval(this.daily);
    clearTimeout(this.idle);
  }

  async lookup(ip: string): Promise<Place> {
    if (isLocalIp(ip)) return { place: 'Local network', isp: null };
    const hit = this.cache.get(ip);
    if (hit) return hit;
    const readers = await this.open();
    if (!readers.city && !readers.asn) return { place: null, isp: null };
    let place: string | null = null;
    let isp: string | null = null;
    try {
      const c = readers.city?.get(ip);
      const parts = [c?.city?.names?.en, c?.subdivisions?.[0]?.names?.en, c?.country?.iso_code ?? c?.country?.names?.en].filter((x): x is string => !!x);
      place = [...new Set(parts)].join(', ') || null;
      isp = tidyIsp(readers.asn?.get(ip)?.autonomous_system_organization);
    } catch {
      /* not an IP the databases understand */
    }
    const out = { place, isp };
    if (this.cache.size > 2000) this.cache.clear();
    this.cache.set(ip, out);
    return out;
  }

  /** Opens the databases when needed and closes them again after a quiet spell. */
  private async open() {
    if (this.updating) await this.updating;
    const dir = this.settings.geoDir;
    if (dir && !this.readers.city && !this.readers.asn) {
      for (const kind of ['city', 'asn'] as const) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (this.readers as any)[kind] = await open(join(dir, FILES[kind]), { watchForUpdates: false });
        } catch {
          /* not downloaded (yet) */
        }
      }
    }
    clearTimeout(this.idle);
    this.idle = setTimeout(() => { this.readers = {}; }, IDLE_MS);
    this.idle.unref();
    return this.readers;
  }

  /** Downloads this month's editions when the files are missing or older than a month. */
  private refresh(): Promise<void> {
    if (this.updating) return this.updating;
    this.updating = (async () => {
      const dir = this.settings.geoDir!;
      await mkdir(dir, { recursive: true });
      for (const kind of ['city', 'asn'] as const) {
        const file = join(dir, FILES[kind]);
        const age = await stat(file).then((s) => Date.now() - s.mtimeMs).catch(() => Infinity);
        if (age < REFRESH_DAYS * 86400_000) continue;
        const ok = await this.download(kind, file);
        if (ok) {
          this.readers = {};
          this.cache.clear();
        }
      }
    })().catch((e) => this.log.warn(`IP location databases not updated: ${(e as Error).message}`))
      .finally(() => { this.updating = undefined; });
    return this.updating;
  }

  private async download(kind: 'city' | 'asn', file: string): Promise<boolean> {
    const now = new Date();
    const months = [0, 1].map((back) => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    });
    for (const month of months) {
      const url = `https://download.db-ip.com/free/dbip-${kind}-lite-${month}.mmdb.gz`;
      const res = await fetch(url).catch(() => null);
      if (!res?.ok || !res.body) continue;
      const tmp = `${file}.download`;
      try {
        await pipeline(Readable.fromWeb(res.body as never), createGunzip(), createWriteStream(tmp));
        await open(tmp); // a broken download must not replace a good file
        await rename(tmp, file);
        this.log.log(`IP location: ${kind} database ${month} ready`);
        return true;
      } catch (e) {
        await rm(tmp, { force: true });
        this.log.warn(`IP location: ${url} failed: ${(e as Error).message}`);
      }
    }
    return false;
  }
}
