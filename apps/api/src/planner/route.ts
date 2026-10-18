/**
 * The installer's driving order for a day: nearest stop next, starting from the company's base.
 * Not the shortest possible route (that is a hard problem), but close enough for a handful of stops
 * in one city, and easy to follow. Stops without a location go last, grouped by city.
 */

export interface Point { lat: number; lng: number }
export interface Placed { lat: number | null; lng: number | null; city: string; name: string }

const located = <T extends Placed>(s: T): s is T & Point => typeof s.lat === 'number' && typeof s.lng === 'number' && Number.isFinite(s.lat) && Number.isFinite(s.lng);

/** Straight-line distance in km (haversine). Roads are longer; it is only used to compare. */
export function km(a: Point, b: Point) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Stops in driving order, each with the distance from the stop before (from the base for the first;
 * null when there is nothing to measure from). Without a base, the first located stop starts the day.
 */
export function orderStops<T extends Placed>(base: Point | null, stops: T[]): { ordered: (T & { legKm: number | null })[]; totalKm: number } {
  const todo = stops.filter(located);
  const ordered: (T & { legKm: number | null })[] = [];
  let at: Point | null = base;
  let total = 0;
  while (todo.length) {
    let best = 0;
    if (at) {
      let bestKm = Infinity;
      todo.forEach((s, i) => {
        const d = km(at!, s);
        if (d < bestKm - 1e-9) { bestKm = d; best = i; }
      });
    }
    const next = todo.splice(best, 1)[0]!;
    const leg = at ? km(at, next) : null;
    if (leg !== null) total += leg;
    ordered.push({ ...next, legKm: leg === null ? null : Math.round(leg * 10) / 10 });
    at = { lat: next.lat, lng: next.lng };
  }
  const rest = stops.filter((s) => !located(s))
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const ca = a.s.city.trim().toLowerCase();
      const cb = b.s.city.trim().toLowerCase();
      if (ca !== cb) return !ca ? 1 : !cb ? -1 : ca.localeCompare(cb);
      return a.i - b.i;
    })
    .map(({ s }) => ({ ...s, legKm: null }));
  return { ordered: [...ordered, ...rest], totalKm: Math.round(total * 10) / 10 };
}

const at = (p: Point) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
const MAPS = 'https://www.google.com/maps/dir/?api=1';
/** Google Maps takes up to 9 stops between the start and the end on phones. */
export const MAX_WAYPOINTS = 9;

/**
 * The whole day in Google Maps: from the base (or wherever the phone is) through every located stop.
 * Null when no stop has a location.
 */
export function mapsRoute(base: Point | null, stops: Placed[]): string | null {
  const points = stops.filter(located).map((s) => ({ lat: s.lat, lng: s.lng }));
  if (!points.length) return null;
  const dest = points[points.length - 1]!;
  const middle = points.slice(0, -1).slice(0, MAX_WAYPOINTS);
  const q = new URLSearchParams();
  if (base) q.set('origin', at(base));
  q.set('destination', at(dest));
  if (middle.length) q.set('waypoints', middle.map(at).join('|'));
  q.set('travelmode', 'driving');
  return `${MAPS}&${q.toString()}`;
}

/** Directions to one stop from wherever the phone is: to its location, else to its city. */
export function directionsTo(stop: Placed): string | null {
  const q = new URLSearchParams();
  if (located(stop)) q.set('destination', at(stop));
  else if (stop.city.trim()) q.set('destination', stop.city.trim());
  else return null;
  q.set('travelmode', 'driving');
  return `${MAPS}&${q.toString()}`;
}
