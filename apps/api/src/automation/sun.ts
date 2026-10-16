/**
 * Sunrise and sunset, without a library: the standard sunrise equation (accurate to a minute or two,
 * plenty for "gate light on at sunset"), and where a home is.
 */
import { localDate, zonedToUtc } from './time';

const RAD = Math.PI / 180;
const J1970 = 2440587.5;
const J2000 = 2451545;

const toJulian = (ms: number) => ms / 86_400_000 + J1970;
const fromJulian = (j: number) => new Date((j - J1970) * 86_400_000);

/** Sunrise and sunset (UTC instants) on the local date that contains `noon` (pass local noon). Null in polar day or night. */
export function sunTimes(noon: Date, lat: number, lon: number): { sunrise: Date; sunset: Date } | null {
  const n = Math.round(toJulian(noon.getTime()) - J2000 + 0.0008);
  const jStar = n - lon / 360;
  const m = (357.5291 + 0.98560028 * jStar) % 360;
  const c = 1.9148 * Math.sin(m * RAD) + 0.02 * Math.sin(2 * m * RAD) + 0.0003 * Math.sin(3 * m * RAD);
  const lambda = (m + c + 180 + 102.9372) % 360;
  const transit = J2000 + jStar + 0.0053 * Math.sin(m * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);
  const sinDec = Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosW = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * sinDec) / (Math.cos(lat * RAD) * cosDec);
  if (cosW < -1 || cosW > 1) return null;
  const w = Math.acos(cosW) / RAD;
  return { sunrise: fromJulian(transit - w / 360), sunset: fromJulian(transit + w / 360) };
}

export type SunEvent = 'SUNRISE' | 'SUNSET';

/** The sun event plus `offsetMin` on a given local date, as a UTC instant. */
export function sunOn(timeZone: string, y: number, m: number, d: number, event: SunEvent, offsetMin: number, lat: number, lon: number): Date | null {
  const noon = zonedToUtc(timeZone, y, m, d, 12, 0);
  const t = sunTimes(noon, lat, lon);
  if (!t) return null;
  return new Date((event === 'SUNRISE' ? t.sunrise : t.sunset).getTime() + offsetMin * 60_000);
}

/** Next time a sunrise/sunset schedule fires strictly after `after` (days: 0=Sun..6=Sat, empty = every day). */
export function nextSun(event: SunEvent, offsetMin: number, days: number[], timeZone: string, lat: number, lon: number, after: Date): Date | null {
  for (let i = 0; i <= 8; i++) {
    const day = localDate(timeZone, new Date(after.getTime() + i * 86_400_000));
    if (days.length && !days.includes(day.weekday)) continue;
    const at = sunOn(timeZone, day.y, day.m, day.d, event, offsetMin, lat, lon);
    if (at && at.getTime() > after.getTime()) return at;
  }
  return null;
}

/** Cities people name for their home (Pakistan first), with coordinates. */
export const CITIES: Record<string, [number, number]> = {
  karachi: [24.86, 67.01], lahore: [31.55, 74.34], islamabad: [33.69, 73.05], rawalpindi: [33.6, 73.04],
  faisalabad: [31.42, 73.08], multan: [30.2, 71.47], peshawar: [34.01, 71.58], quetta: [30.18, 66.98],
  hyderabad: [25.4, 68.37], gujranwala: [32.16, 74.19], sialkot: [32.49, 74.53], sargodha: [32.08, 72.67],
  bahawalpur: [29.4, 71.68], sukkur: [27.7, 68.86], abbottabad: [34.17, 73.22], mardan: [34.2, 72.04],
  swabi: [34.12, 72.47], nowshera: [34.02, 71.98], charsadda: [34.15, 71.73], mingora: [34.78, 72.36],
  swat: [34.78, 72.36], 'dera ismail khan': [31.83, 70.9], kohat: [33.58, 71.44], bannu: [32.99, 70.6],
  'mirpur': [33.15, 73.75], muzaffarabad: [34.37, 73.47], gilgit: [35.92, 74.31], gujrat: [32.57, 74.08],
  jhelum: [32.93, 73.73], sheikhupura: [31.71, 73.98], okara: [30.81, 73.45], sahiwal: [30.66, 73.11],
  'rahim yar khan': [28.42, 70.3], larkana: [27.56, 68.21], nawabshah: [26.24, 68.41], 'dera ghazi khan': [30.05, 70.63],
  chitral: [35.85, 71.79], haripur: [33.99, 72.93], attock: [33.77, 72.36], chakwal: [32.93, 72.86],
  dubai: [25.2, 55.27], 'abu dhabi': [24.45, 54.38], riyadh: [24.71, 46.68], jeddah: [21.49, 39.19], doha: [25.29, 51.53],
  london: [51.51, -0.13], delhi: [28.61, 77.21], mumbai: [19.08, 72.88], kabul: [34.53, 69.17],
};

/** Coordinates for a city name ("Swabi", "Lahore, Punjab, PK"), or null. */
export function cityCoords(name: string | null | undefined): [number, number] | null {
  const words = (name ?? '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  for (const w of words) if (CITIES[w]) return CITIES[w]!;
  return null;
}

/** Islamabad: when nothing better is known (the times are then right to within about half an hour across Pakistan). */
export const DEFAULT_COORDS: [number, number] = [33.69, 73.05];
