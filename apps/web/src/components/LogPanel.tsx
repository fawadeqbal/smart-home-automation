'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { errorText, get } from '@/lib/api';
import { useLive } from '@/lib/live';
import { buildEvents, DeviceRef, EventKind, LogEvent, RawLine, rawText } from '@/lib/logStory';

export type LogEntry = RawLine;

const MAX_LINES = 500;
const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type View = 'clean' | 'raw';
const VIEW_KEY = 'sb.logView';

const ICON: Record<EventKind, string> = {
  switch: 'zap', wall: 'toggle-right', config: 'settings', online: 'wifi', offline: 'wifi-off', start: 'rotate',
  firmware: 'package', wifi: 'router', restart: 'rotate', reading: 'thermometer', note: 'list',
};

function time(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour12: false });
}

function savedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'raw' ? 'raw' : 'clean';
  } catch {
    return 'clean';
  }
}

/**
 * Live log of one board, two ways:
 *  * Clean — what happened, one line per event (a command, its confirmation and the board's echo together);
 *    click an event to see the raw lines behind it.
 *  * Raw — every line exactly as the board and the server wrote it, with copy and download.
 */
export function LogPanel({ nodeId, online, devices = [] }: { nodeId: string; online: boolean; devices?: DeviceRef[] }) {
  const [lines, setLines] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [view, setViewState] = useState<View>('clean');
  const [minLevel, setMinLevel] = useState<(typeof LEVELS)[number]>('info');
  const [onlyBoard, setOnlyBoard] = useState(false);
  const [readings, setReadings] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const boxRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const held = useRef<LogEntry[]>([]);

  useEffect(() => setViewState(savedView()), []);
  const setView = (v: View) => {
    setViewState(v);
    stickToBottom.current = true;
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* private window */ }
  };

  useEffect(() => {
    get<LogEntry[]>(`/nodes/${nodeId}/logs`).then(setLines).catch((e) => setError(errorText(e)));
  }, [nodeId]);

  // re-check unanswered commands now and then ("no answer from the board")
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  useLive('node.log', (e: { nodeId: string; entry: LogEntry }) => {
    if (e.nodeId !== nodeId) return;
    if (pausedRef.current) {
      held.current.push(e.entry);
      return;
    }
    setLines((l) => [...l, e.entry].slice(-MAX_LINES));
  });

  useEffect(() => {
    if (!paused && held.current.length) {
      const waiting = held.current;
      held.current = [];
      setLines((l) => [...l, ...waiting].slice(-MAX_LINES));
    }
  }, [paused]);

  const rawVisible = lines.filter(
    (l) => LEVELS.indexOf(l.level) >= LEVELS.indexOf(minLevel) && (!onlyBoard || l.source === 'board'),
  );
  const events = useMemo(() => buildEvents(lines, devices, now), [lines, devices, now]);
  const cleanVisible = readings ? events : events.filter((e) => e.kind !== 'reading');
  const problems = cleanVisible.filter((e) => e.tone === 'warn' || e.tone === 'error').length;
  const count = view === 'clean' ? cleanVisible.length : rawVisible.length;

  useEffect(() => {
    const box = boxRef.current;
    if (box && stickToBottom.current) box.scrollTop = box.scrollHeight;
  }, [count, view, events]);

  const copy = async () => {
    const text = rawText(rawVisible);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([rawText(lines) + '\n'], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${nodeId}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.log`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="spread log-bar">
        <div className="row small">
          <span className={`dot ${online ? 'on' : 'off'}`} />
          <span className="muted">{online ? 'Live' : 'Board offline: new lines arrive when it reconnects'}</span>
          {view === 'clean' && problems > 0 && <span className="badge warn">{problems} to look at</span>}
        </div>
        <div className="row log-tools">
          <div className="seg" role="radiogroup" aria-label="Log view">
            <button type="button" role="radio" aria-checked={view === 'clean'} className={view === 'clean' ? 'on' : undefined}
              onClick={() => setView('clean')} title="What happened, one line per event">Clean</button>
            <button type="button" role="radio" aria-checked={view === 'raw'} className={view === 'raw' ? 'on' : undefined}
              onClick={() => setView('raw')} title="Every line exactly as written">Raw</button>
          </div>
          {view === 'clean' ? (
            <label className="row small" style={{ gap: 6 }}>
              <input type="checkbox" checked={readings} onChange={(e) => setReadings(e.target.checked)} /> Sensor readings
            </label>
          ) : (
            <>
              <select value={minLevel} onChange={(e) => setMinLevel(e.target.value as typeof minLevel)}
                      style={{ width: 'auto', padding: '4px 8px', fontSize: 13 }} aria-label="Lowest level shown">
                <option value="debug">All (with sensor readings)</option>
                <option value="info">Info and above</option>
                <option value="warn">Warnings and errors</option>
                <option value="error">Errors only</option>
              </select>
              <label className="row small" style={{ gap: 6 }}>
                <input type="checkbox" checked={onlyBoard} onChange={(e) => setOnlyBoard(e.target.checked)} /> Board only
              </label>
              <button className="btn btn-small" onClick={copy} disabled={rawVisible.length === 0} title="Copy the lines shown">
                <Icon name={copied ? 'check' : 'copy'} size={14} />{copied ? 'Copied' : 'Copy'}
              </button>
              <button className="btn btn-small" onClick={download} disabled={lines.length === 0} title="Save every line as a .log file">
                <Icon name="download" size={14} />Download
              </button>
            </>
          )}
          <button className="btn btn-small" onClick={() => setPaused((p) => !p)}>
            {paused ? `Resume${held.current.length ? ` (${held.current.length})` : ''}` : 'Pause'}
          </button>
          <button className="btn btn-small" onClick={() => { setLines([]); setOpenId(null); }}>Clear</button>
        </div>
      </div>

      <div
        className={view === 'clean' ? 'logclean' : 'logbox'}
        ref={boxRef}
        onScroll={(e) => {
          const b = e.currentTarget;
          stickToBottom.current = b.scrollHeight - b.scrollTop - b.clientHeight < 24;
        }}
        role="log"
        aria-live="polite"
      >
        {count === 0 && <div className="log-empty">{error ?? (lines.length ? 'Nothing to show with these filters.' : 'Nothing yet. Switch something and it shows up here.')}</div>}
        {view === 'clean'
          ? cleanVisible.map((e) => <EventRow key={e.id} event={e} open={openId === e.id} onToggle={() => setOpenId(openId === e.id ? null : e.id)} />)
          : rawVisible.map((l, i) => (
              <div key={i} className={`log-line lvl-${l.level}`}>
                <span className="log-time">{time(l.at)}</span>
                <span className={`log-src ${l.source}`}>{l.source}</span>
                <span className="log-lvl">{l.level}</span>
                <span className="log-msg">{l.msg}</span>
              </div>
            ))}
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {view === 'clean'
          ? 'Each line is one event: a command with its confirmation and the board’s reply. Click a line for the raw lines behind it.'
          : 'Exactly what the board printed and what the server did. Board lines can reach the server a moment after the server’s own lines.'}
      </p>
    </div>
  );
}

function EventRow({ event: e, open, onToggle }: { event: LogEvent; open: boolean; onToggle: () => void }) {
  const icon = e.tone === 'error' || e.tone === 'warn' ? 'alert-triangle' : ICON[e.kind];
  return (
    <div className={`lev lev-${e.tone}${open ? ' open' : ''}`}>
      <button type="button" className="lev-row" onClick={onToggle} aria-expanded={open}
        title={open ? 'Hide the raw lines' : `Show the ${e.lines.length} raw line${e.lines.length === 1 ? '' : 's'}`}>
        <span className="lev-time">{time(e.at)}</span>
        <span className="lev-icon">{e.tone === 'pending' ? <span className="spinner sm" aria-hidden /> : <Icon name={icon} size={15} />}</span>
        <span className="lev-text">
          <b>{e.title}</b>
          {e.detail && <span className="muted"> · {e.detail}</span>}
        </span>
        {e.meta && <span className="lev-meta">{e.meta}</span>}
        <span className="lev-chev"><Icon name="chevron-down" size={14} /></span>
      </button>
      {open && (
        <div className="lev-raw">
          {e.lines.map((l, i) => (
            <div key={i} className={`log-line lvl-${l.level}`}>
              <span className="log-time">{time(l.at)}</span>
              <span className={`log-src ${l.source}`}>{l.source}</span>
              <span className="log-msg">{l.msg}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
