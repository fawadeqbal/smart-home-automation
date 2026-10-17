/** Human words for sensor states that are not plain numbers. */
const CONTACT_WORDS: Record<string, [string, string]> = {
  door: ['Open', 'Closed'],
  window: ['Open', 'Closed'],
  motion: ['Motion', 'No motion'],
  leak: ['Water detected!', 'Dry'],
  generic: ['Active', 'Inactive'],
};
const ANALOG_LABEL: Record<string, string> = {
  light: 'light', gas: 'gas', moisture: 'moisture', water: 'water level', generic: 'level',
};

export function contactText(settings: Record<string, unknown> | undefined, active: unknown): string {
  const words = CONTACT_WORDS[String(settings?.kind ?? 'generic')] ?? CONTACT_WORDS.generic!;
  return active === undefined ? '–' : active ? words[0] : words[1];
}

export function analogLabel(settings: Record<string, unknown> | undefined): string {
  return ANALOG_LABEL[String(settings?.kind ?? 'generic')] ?? 'level';
}

/** Icon name for a device, from its type and kind. */
/** A switch's icon from what it powers, read from its name ("Ceiling fan", "Geyser", "TV socket"); lights keep the bulb. */
function switchIcon(name?: string): string {
  const n = (name ?? '').toLowerCase();
  if (/\b(fan|pankha|exhaust)\b/.test(n)) return 'fan';
  if (/\b(ac|a\.c\.|air ?con\w*|cooler)\b/.test(n)) return 'snowflake';
  if (/\b(geyser|heater|iron|kettle|oven|stove)\b/.test(n)) return 'flame';
  if (/\b(motor|pump|tank)\b/.test(n)) return 'droplet';
  if (/\b(socket|plug|tv|charger|ups|fridge|outlet)\b/.test(n)) return 'plug';
  return 'lightbulb';
}

export function deviceIcon(type: string, settings?: Record<string, unknown>, name?: string): string {
  if (type === 'switch') return switchIcon(name);
  if (type === 'dht') return 'thermometer';
  if (type === 'contact') return ({ motion: 'activity', leak: 'droplet' } as Record<string, string>)[String(settings?.kind)] ?? 'door-open';
  if (type === 'analog') return ({ light: 'sun', moisture: 'droplet', water: 'droplet', gas: 'activity' } as Record<string, string>)[String(settings?.kind)] ?? 'activity';
  return 'cpu';
}
