/**
 * Turns a board's raw log (board lines + server lines, in arrival order) into a short list of events a
 * person can read: "Bulb turned on · Fawad Iqbal (web) · confirmed in 0.9 s".
 *
 * Lines that belong to one thing are folded into one event, so the board's echo of a command, its
 * "Switch states saved", the "Device ready" lines after new settings, etc. stop cluttering the view.
 * Board lines usually reach the server a moment after the server's own lines, so folding goes by
 * device and a short time window, not by strict order. Every folded line stays in `lines` (raw view).
 *
 * Pure and dependency-free: the panel calls it on every render.
 */

export interface RawLine {
  at: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  source: 'board' | 'server';
  uptime?: number;
}

export type Tone = 'ok' | 'info' | 'warn' | 'error' | 'pending' | 'muted';

export type EventKind = 'switch' | 'wall' | 'config' | 'online' | 'offline' | 'start' | 'firmware' | 'wifi' | 'restart' | 'reading' | 'note';

export interface LogEvent {
  id: number;
  kind: EventKind;
  at: string;            // when it started
  tone: Tone;
  title: string;
  detail?: string;       // who / how / why
  meta?: string;         // e.g. "confirmed in 0.9 s"
  count?: number;        // readings folded into one line
  lines: RawLine[];
  /** internal: what this event still accepts */
  open?: { key?: string; name?: string; want?: boolean; until: number; gotCommand?: boolean; gotSwitch?: boolean; rev?: number };
}

export interface DeviceRef { key: string; name: string }

const SWITCH_WINDOW = 15_000;   // board echo of a command arrives within this
const SAVE_WINDOW = 10_000;
const START_WINDOW = 30_000;
const CONFIG_WINDOW = 20_000;
const FIRMWARE_WINDOW = 5 * 60_000;
const WIFI_WINDOW = 90_000;
const PENDING_AFTER = 12_000;   // a command still unconfirmed after this is shown as a problem

const t = (iso: string) => new Date(iso).getTime();

function stateWords(json: string): { word: string; on?: boolean } {
  try {
    const v = JSON.parse(json) as Record<string, unknown>;
    if (v.toggle === true) return { word: 'toggled' };
    if (typeof v.on === 'boolean') return { word: v.on ? 'on' : 'off', on: v.on };
    const entries = Object.entries(v).map(([k, x]) => `${k} ${String(x)}`);
    return { word: entries.join(', ') || json };
  } catch {
    return { word: json };
  }
}

function seconds(ms: number) {
  return ms < 950 ? `${Math.max(ms, 0)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function buildEvents(lines: RawLine[], devices: DeviceRef[], now = Date.now()): LogEvent[] {
  const nameOf = (key: string) => devices.find((d) => d.key === key)?.name ?? key;
  const keyOf = (name: string) => devices.find((d) => d.name === name)?.key;
  const events: LogEvent[] = [];
  let seq = 0;

  const push = (e: Omit<LogEvent, 'id'>) => {
    const full = { ...e, id: ++seq } as LogEvent;
    events.push(full);
    return full;
  };
  /**
   * An event of this kind still open at `at` that passes `test`: the newest by default; the OLDEST for
   * replies, which come back in the order the requests went out (board echoes lag behind the server).
   */
  const findOpen = (kinds: EventKind[], at: number, test: (e: LogEvent) => boolean = () => true, oldest = false) => {
    const ok = (e: LogEvent) => kinds.includes(e.kind) && e.open && at <= e.open.until && at >= t(e.at) - 5_000 && test(e);
    if (oldest) return events.find(ok);
    for (let i = events.length - 1; i >= 0; i--) if (ok(events[i])) return events[i];
    return undefined;
  };
  const sameDevice = (e: LogEvent, key: string) => (e.open?.key ?? e.open?.name?.toLowerCase()) === key;
  const fold = (e: LogEvent, line: RawLine) => {
    e.lines.push(line);
  };
  const note = (line: RawLine, title = line.msg, tone?: Tone) =>
    push({
      kind: 'note', at: line.at, lines: [line], title,
      tone: tone ?? (line.level === 'error' ? 'error' : line.level === 'warn' ? 'warn' : 'muted'),
      detail: line.source === 'board' ? 'from the board' : undefined,
    });

  for (const line of lines) {
    const at = t(line.at);
    const msg = line.msg;
    let m: RegExpMatchArray | null;

    if (line.source === 'server') {
      // ---- commands from people / schedules / voice
      if ((m = msg.match(/^(.+) <- (\{.*\}) from (.+) \(([\w-]+)\)$/))) {
        const [, name, json, who, channel] = m;
        const s = stateWords(json);
        push({
          kind: 'switch', at: line.at, lines: [line], tone: 'pending',
          title: s.on === undefined ? `${name} ${s.word}` : `Turning ${name} ${s.word}…`,
          detail: `${who} · ${channel}`,
          open: { name, key: keyOf(name), want: s.on, until: at + SWITCH_WINDOW },
        });
        continue;
      }
      if ((m = msg.match(/^(.+) confirmed (\{.*\})$/))) {
        const [, name, json] = m;
        const s = stateWords(json);
        const e = findOpen(['switch'], at, (x) => x.open?.name === name && x.tone === 'pending', true);
        if (e) {
          fold(e, line);
          e.tone = 'ok';
          e.title = `${name} turned ${s.word}`;
          e.meta = `confirmed in ${seconds(at - t(e.at))}`;
          e.open!.until = at + SWITCH_WINDOW;
        } else {
          push({ kind: 'switch', at: line.at, lines: [line], tone: 'ok', title: `${name} is ${s.word}`, detail: 'confirmed by the board' });
        }
        continue;
      }
      if (line.level === 'error') {
        const e = findOpen(['switch'], at, (x) => x.tone === 'pending' && msg.startsWith(`${x.open?.name}: `), true);
        if (e) {
          fold(e, line);
          e.tone = 'error';
          e.title = `${e.open!.name} didn't switch`;
          e.meta = msg.slice(e.open!.name!.length + 2);
          continue;
        }
      }
      // ---- settings
      if ((m = msg.match(/^Sent configuration rev (\d+)$/))) {
        push({
          kind: 'config', at: line.at, lines: [line], tone: 'pending', title: 'Sending new settings…',
          detail: `rev ${m[1]}`, open: { rev: Number(m[1]), until: at + CONFIG_WINDOW },
        });
        continue;
      }
      if ((m = msg.match(/^Configuration rev (\d+) (applied by the board|rejected: (.*))$/))) {
        const rev = Number(m[1]);
        const ok = m[2].startsWith('applied');
        const e = findOpen(['config'], at, (x) => x.open?.rev === rev) ?? push({ kind: 'config', at: line.at, lines: [], tone: 'pending', title: '', detail: `rev ${rev}`, open: { rev, until: at + CONFIG_WINDOW } });
        fold(e, line);
        e.tone = ok ? 'ok' : 'error';
        e.title = ok ? 'Settings applied' : 'Settings rejected by the board';
        if (ok && at - t(e.at) >= 50) e.meta = `in ${seconds(at - t(e.at))}`;
        else e.meta = m[3];
        e.open!.until = at + 5_000;   // a few "Device ready" lines may still come
        continue;
      }
      // ---- connection
      if ((m = msg.match(/^Board connected \(firmware ([^,]+), IP ([^)]+)\)$/))) {
        const e = findOpen(['online'], at);
        if (e) { fold(e, line); e.detail = `firmware ${m[1]} · IP ${m[2]}`; continue; }
        push({ kind: 'online', at: line.at, lines: [line], tone: 'ok', title: 'Board online', detail: `firmware ${m[1]} · IP ${m[2]}`, open: { until: at + 10_000 } });
        continue;
      }
      if (msg === 'Online') {
        const e = findOpen(['online'], at);
        if (e) { fold(e, line); continue; }
        push({ kind: 'online', at: line.at, lines: [line], tone: 'ok', title: 'Board online', open: { until: at + 10_000 } });
        continue;
      }
      if (msg.startsWith('Offline')) {
        push({ kind: 'offline', at: line.at, lines: [line], tone: 'warn', title: 'Board went offline', detail: 'the connection to the board was lost' });
        continue;
      }
      // ---- firmware
      if ((m = msg.match(/^Firmware (\S+) sent to the board by (.+?) \(/))) {
        push({ kind: 'firmware', at: line.at, lines: [line], tone: 'pending', title: `Installing firmware ${m[1]}…`, detail: `by ${m[2]}`, open: { until: at + FIRMWARE_WINDOW } });
        continue;
      }
      if (/^(Board is downloading firmware|Firmware )/.test(msg)) {
        const e = findOpen(['firmware'], at) ?? push({ kind: 'firmware', at: line.at, lines: [], tone: 'pending', title: 'Firmware update', open: { until: at + FIRMWARE_WINDOW } });
        fold(e, line);
        if ((m = msg.match(/^Firmware (\S+): now running/))) { e.tone = 'ok'; e.title = `Firmware ${m[1]} installed`; e.meta = `in ${seconds(at - t(e.at))}`; e.open!.until = at + 5_000; }
        else if (line.level === 'error' || line.level === 'warn') { e.tone = line.level; e.title = 'Firmware update failed'; e.meta = msg.replace(/^Firmware update( failed)?: /, ''); }
        continue;
      }
      // ---- wi-fi
      if (/Wi-Fi/.test(msg)) {
        const e = findOpen(['wifi'], at) ?? push({ kind: 'wifi', at: line.at, lines: [], tone: 'pending', title: 'Wi-Fi change', open: { until: at + WIFI_WINDOW } });
        fold(e, line);
        if ((m = msg.match(/^Asked the board to switch to Wi-Fi "(.+)"$/))) e.title = `Switching to Wi-Fi “${m[1]}”…`;
        else if ((m = msg.match(/^Wi-Fi changed to "(.+)"$/))) { e.tone = 'ok'; e.title = `Now on Wi-Fi “${m[1]}”`; }
        else if (line.level !== 'info') { e.tone = line.level === 'error' ? 'error' : 'warn'; e.title = msg; }
        continue;
      }
      if ((m = msg.match(/^Restart requested by (.+)$/))) {
        push({ kind: 'restart', at: line.at, lines: [line], tone: 'info', title: 'Restart requested', detail: m[1], open: { until: at + 60_000 } });
        continue;
      }
      note(line);
      continue;
    }

    // ================================================================ board lines
    if ((m = msg.match(/^Command for (\S+) from the server$/))) {
      const key = m[1];
      const e = findOpen(['switch'], at, (x) => sameDevice(x, key) && !x.open?.gotCommand, true);
      if (e) { fold(e, line); e.open!.gotCommand = true; continue; }
      note(line, `${nameOf(key)}: command reached the board`);
      continue;
    }
    // "bulb -> ON" (the simulated board adds "(remote)", or "[button D5] " in front)
    if ((m = msg.match(/^(?:\[[^\]]*\] )?(\S+) -> (ON|OFF)(?: \(\w+\))?$/))) {
      const [, key, word] = m;
      const on = word === 'ON';
      const e = findOpen(['switch'], at, (x) => sameDevice(x, key) && !x.open?.gotSwitch && (x.open?.want === undefined || x.open.want === on), true);
      if (e) { fold(e, line); e.open!.gotSwitch = true; continue; }
      const start = findOpen(['start'], at);
      if (start) { fold(start, line); continue; }   // states put back after a restart
      push({
        kind: 'wall', at: line.at, lines: [line], tone: 'info',
        title: `${nameOf(key)} turned ${word.toLowerCase()}`, detail: 'on the board · wall button', open: { key, until: at + SAVE_WINDOW },
      });
      continue;
    }
    if (msg === 'Switch states saved') {
      const e = findOpen(['switch', 'wall', 'start'], at);
      if (e) { fold(e, line); continue; }
      continue; // nothing to attach it to: housekeeping, not worth a line of its own
    }
    if ((m = msg.match(/^config(?:uration)? rev (\d+) (applied|rejected)/i)) || /^Device ready: /.test(msg)) {
      const e = findOpen(['config'], at) ?? findOpen(['start'], at);
      if (e) { fold(e, line); continue; }
      if (line.level !== 'info') { note(line); continue; }
      push({ kind: 'config', at: line.at, lines: [line], tone: 'info', title: 'Board loaded its settings', open: { until: at + 5_000 } });
      continue;
    }
    if ((m = msg.match(/^Home node (\S+), firmware (\S+), board (\S+)$/))) {
      const r = findOpen(['restart', 'firmware'], at);
      push({
        kind: 'start', at: line.at, lines: [line], tone: 'info', title: 'Board started',
        detail: `firmware ${m[2]}${r?.kind === 'restart' ? ` · restart asked by ${r.detail}` : ''}`, open: { until: at + START_WINDOW },
      });
      if (r?.kind === 'restart') r.open = undefined;
      continue;
    }
    if (/^(Node id|Connecting to the server|Connected to the server|Saved configuration|No saved configuration|Settings saved|Formatting the file system)/.test(msg)) {
      const e = findOpen(['start'], at);
      if (e) { fold(e, line); continue; }
      if (line.level !== 'info') note(line);
      else note(line, msg, 'muted');
      continue;
    }
    if (/^(Updating firmware|Firmware .* installed|Firmware update failed)/.test(msg)) {
      const e = findOpen(['firmware'], at);
      if (e) { fold(e, line); if (line.level === 'error') { e.tone = 'error'; e.title = 'Firmware update failed'; e.meta = msg.replace(/^Firmware update failed: /, ''); } continue; }
      note(line);
      continue;
    }
    if (/Wi-Fi|Scanning|Found \d+ Wi-Fi/.test(msg)) {
      const e = findOpen(['wifi'], at);
      if (e) { fold(e, line); continue; }
      note(line);
      continue;
    }
    if (msg === 'Restart requested by the server') {
      const e = findOpen(['restart'], at);
      if (e) { fold(e, line); continue; }
      note(line, 'Board is restarting', 'info');
      continue;
    }
    // sensor readings: consecutive readings of one sensor become one line that keeps the latest value
    if (line.level === 'debug' && (m = msg.match(/^(\S+): (-?[\d.]+) C, (-?[\d.]+) %$/))) {
      const [, key, temp, hum] = m;
      const last = events[events.length - 1];
      const title = `${nameOf(key)}: ${Number(temp).toFixed(1)} °C · ${Number(hum).toFixed(0)} %`;
      if (last?.kind === 'reading' && last.open?.key === key) {
        fold(last, line);
        last.title = title;
        last.count = (last.count ?? 1) + 1;
        last.meta = `latest of ${last.count} readings`;
        continue;
      }
      push({ kind: 'reading', at: line.at, lines: [line], tone: 'muted', title, count: 1, open: { key, until: Infinity } });
      continue;
    }
    if ((m = msg.match(/^(\d+) log lines were lost while offline$/))) {
      note(line, `${m[1]} board lines were lost while it was offline`, 'warn');
      continue;
    }
    note(line);
  }

  // a command nobody confirmed for a while is a problem worth seeing
  for (const e of events) {
    if (e.kind === 'switch' && e.tone === 'pending' && now - t(e.at) > PENDING_AFTER) {
      e.tone = 'warn';
      e.title = `${e.open?.name ?? 'Device'}: no answer from the board`;
    }
    if ((e.kind === 'config' || e.kind === 'wifi') && e.tone === 'pending' && now - t(e.at) > (e.kind === 'config' ? CONFIG_WINDOW : WIFI_WINDOW)) {
      e.tone = 'warn';
      e.meta = 'no answer from the board yet';
    }
  }
  return events;
}

/** Raw lines as plain text, for copying or saving. */
export function rawText(lines: RawLine[]) {
  return lines
    .map((l) => `${new Date(l.at).toISOString()}  ${l.source.padEnd(6)}  ${l.level.toUpperCase().padEnd(5)}  ${l.msg}`)
    .join('\n');
}
