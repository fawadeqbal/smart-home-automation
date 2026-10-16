import { Injectable } from '@nestjs/common';
import { NodeStatus } from '@prisma/client';
import { GeoService } from '../hardware/geo.service';
import { PrismaService } from '../prisma/prisma.service';
import { cityCoords, CITIES, DEFAULT_COORDS, sunOn } from './sun';
import { localDate } from './time';

export interface HomePlace {
  lat: number;
  lon: number;
  /** where the coordinates come from */
  source: 'set' | 'city' | 'board' | 'default';
  label: string;
}

/**
 * Where a home is, for sunrise and sunset: set by its owner, else its city, else where its board
 * connects from (the internet provider's city), else Islamabad.
 */
@Injectable()
export class PlaceService {
  private readonly cache = new Map<string, { at: number; place: HomePlace }>();

  constructor(private readonly prisma: PrismaService, private readonly geo: GeoService) {}

  async of(homeId: string): Promise<HomePlace> {
    const hit = this.cache.get(homeId);
    if (hit && Date.now() - hit.at < 30 * 60_000) return hit.place;
    const home = await this.prisma.home.findUniqueOrThrow({ where: { id: homeId }, select: { latitude: true, longitude: true, city: true } });
    let place: HomePlace;
    const fromCity = cityCoords(home.city);
    if (home.latitude !== null && home.longitude !== null) {
      place = { lat: home.latitude, lon: home.longitude, source: 'set', label: home.city || `${home.latitude.toFixed(2)}, ${home.longitude.toFixed(2)}` };
    } else if (fromCity) {
      place = { lat: fromCity[0], lon: fromCity[1], source: 'city', label: home.city };
    } else {
      const node = await this.prisma.node.findFirst({
        where: { homeId, status: NodeStatus.ADOPTED, publicIp: { not: null } }, select: { publicIp: true, publicPlace: true }, orderBy: { lastSeenAt: 'desc' },
      });
      const named = cityCoords(node?.publicPlace);
      const looked = !named && node?.publicIp ? await this.geo.coordinates(node.publicIp) : null;
      const c = named ?? looked;
      place = c
        ? { lat: c[0], lon: c[1], source: 'board', label: node?.publicPlace?.split(',')[0] ?? 'the board’s location' }
        : { lat: DEFAULT_COORDS[0], lon: DEFAULT_COORDS[1], source: 'default', label: 'Islamabad (not set)' };
    }
    this.cache.set(homeId, { at: Date.now(), place });
    return place;
  }

  forget(homeId: string) {
    this.cache.delete(homeId);
  }

  /** Today's sunrise and sunset at the home, in its time zone. */
  async today(homeId: string, timeZone: string, now = new Date()) {
    const p = await this.of(homeId);
    const d = localDate(timeZone, now);
    return {
      ...p,
      sunrise: sunOn(timeZone, d.y, d.m, d.d, 'SUNRISE', 0, p.lat, p.lon),
      sunset: sunOn(timeZone, d.y, d.m, d.d, 'SUNSET', 0, p.lat, p.lon),
    };
  }

  /** The owner sets the city (from the list) or exact coordinates; nothing clears it back to automatic. */
  async set(homeId: string, input: { city?: string; lat?: number; lon?: number; auto?: boolean }) {
    let data: { latitude: number | null; longitude: number | null; city?: string };
    if (input.auto) data = { latitude: null, longitude: null };
    else if (typeof input.lat === 'number' && typeof input.lon === 'number') data = { latitude: input.lat, longitude: input.lon, ...(input.city ? { city: input.city } : {}) };
    else {
      const c = cityCoords(input.city);
      if (!c) return null;
      data = { latitude: c[0], longitude: c[1], city: titleCase(input.city!) };
    }
    await this.prisma.home.update({ where: { id: homeId }, data });
    this.forget(homeId);
    return this.of(homeId);
  }

  static cities() {
    return Object.keys(CITIES).map(titleCase);
  }
}

const titleCase = (s: string) => s.trim().replace(/\b\w/g, (c) => c.toUpperCase());
