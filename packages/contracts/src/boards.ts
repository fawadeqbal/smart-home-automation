/**
 * Which pins each board may use, and for what. The UI offers only these pins, the API
 * rejects anything else, and the firmware checks again (firmware/home_node/src/config/BoardPins.h).
 *
 * ESP8266 pins that are NOT offered:
 *   GPIO 1 (TX)          serial output, used for logs and flashing
 *   GPIO 6-11            connected to the flash chip; using them crashes the board
 * Offered with care: D8 (GPIO 15) output only, it must stay LOW at boot; RX (GPIO 3) is free because
 * the firmware runs Serial transmit-only (firmware 2.1+); A0 (17) is the single analog input.
 */
export type PinUse = 'output' | 'input' | 'sensor' | 'analog';

export interface BoardPin {
  gpio: number;
  label: string; // the name printed on the board
  uses: PinUse[];
  note?: string;
}

export interface BoardDefinition {
  type: string;
  name: string;
  pins: BoardPin[];
}

const ESP8266_DEV_BOARD_PINS: BoardPin[] = [
  { gpio: 5, label: 'D1', uses: ['output', 'input', 'sensor'], note: 'Best choice for a relay' },
  { gpio: 4, label: 'D2', uses: ['output', 'input', 'sensor'] },
  { gpio: 14, label: 'D5', uses: ['output', 'input', 'sensor'] },
  { gpio: 12, label: 'D6', uses: ['output', 'input', 'sensor'] },
  { gpio: 13, label: 'D7', uses: ['output', 'input', 'sensor'] },
  { gpio: 16, label: 'D0', uses: ['output'], note: 'Output only (no pull-up)' },
  { gpio: 15, label: 'D8', uses: ['output'], note: 'Output only. LOW at boot: an active-low relay clicks on briefly at power-up' },
  { gpio: 0, label: 'D3', uses: ['input'], note: 'Boot pin: do not hold the button while powering on' },
  { gpio: 2, label: 'D4', uses: ['output', 'input'], note: 'Boot pin and on-board LED (the LED stops blinking)' },
  { gpio: 3, label: 'RX', uses: ['input', 'sensor'], note: 'Unplug the sensor/button when flashing over USB' },
  { gpio: 17, label: 'A0', uses: ['analog'], note: 'The only analog input (light, gas, soil moisture, water level)' },
];

export const BOARDS: Record<string, BoardDefinition> = {
  NODEMCU_V2: { type: 'NODEMCU_V2', name: 'NodeMCU 1.0 (ESP-12E)', pins: ESP8266_DEV_BOARD_PINS },
  NODEMCU_V3: { type: 'NODEMCU_V3', name: 'NodeMCU v3 / LoLin (black, CH340)', pins: ESP8266_DEV_BOARD_PINS },
  WEMOS_D1_MINI: { type: 'WEMOS_D1_MINI', name: 'Wemos / LOLIN D1 mini', pins: ESP8266_DEV_BOARD_PINS },
};

export const BOARD_TYPES = Object.keys(BOARDS);

export function boardPin(board: string, gpio: number): BoardPin | undefined {
  return BOARDS[board]?.pins.find((p) => p.gpio === gpio);
}

/** null when the pin may be used this way, otherwise a sentence for the user. */
export function checkPin(board: string, gpio: number, use: PinUse): string | null {
  const def = BOARDS[board];
  if (!def) return `Unknown board type ${board}`;
  const pin = boardPin(board, gpio);
  if (!pin) return `GPIO ${gpio} cannot be used on a ${def.name}`;
  if (!pin.uses.includes(use)) return `${pin.label} (GPIO ${gpio}) cannot be used as ${use} on a ${def.name}`;
  return null;
}

export function pinLabel(board: string, gpio: number): string {
  const pin = boardPin(board, gpio);
  return pin ? `${pin.label} (GPIO ${gpio})` : `GPIO ${gpio}`;
}
