/** Human words for sensor states that are not plain numbers. */
const CONTACT_WORDS: Record<string, [string, string]> = {
  door: ['Open', 'Closed'],
  window: ['Open', 'Closed'],
  motion: ['Motion', 'No motion'],
  leak: ['Water detected!', 'Dry'],
  mains: ['Grid on', 'On UPS'],
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
export function deviceIcon(type: string, settings?: Record<string, unknown>): string {
  if (type === 'switch') return 'lightbulb';
  if (type === 'fan') return 'fan';
  if (type === 'tank') return 'droplet';
  if (type === 'dht') return 'thermometer';
  if (type === 'contact') return ({ motion: 'activity', leak: 'droplet', mains: 'zap' } as Record<string, string>)[String(settings?.kind)] ?? 'door-open';
  if (type === 'analog') return ({ light: 'sun', moisture: 'droplet', water: 'droplet', gas: 'activity' } as Record<string, string>)[String(settings?.kind)] ?? 'activity';
  return 'cpu';
}

/** Every pin a device takes: its own, a fan's other two relays, a tank sensor's echo pin. */
export function devicePins(d: { type: string; pin: number; settings: Record<string, unknown> }): number[] {
  const extra = d.type === 'fan' && Array.isArray(d.settings.pins) ? (d.settings.pins as number[])
    : d.type === 'tank' && typeof d.settings.echoPin === 'number' ? [d.settings.echoPin]
      : [];
  return [d.pin, ...extra];
}

/** What a tank's alarm means, in a few words (empty when there is none). */
export function tankAlarmText(alarm: unknown): string {
  return ({ dry: 'Motor stopped: water not rising', long: 'Motor stopped: ran too long', sensor: 'Motor stopped: no sensor reading' } as Record<string, string>)[String(alarm ?? '')] ?? '';
}
