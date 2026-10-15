'use client';
import { useEffect, useRef, useState } from 'react';
import { errorText, get } from '@/lib/api';
import { useLive } from '@/lib/live';

export interface LogEntry {
  at: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  source: 'board' | 'server';
  uptime?: number;
}

const MAX_LINES = 500;
const LEVELS = ['debug', 'info', 'warn', 'error'] as const;

function time(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour12: false });
}

/** Live log of one board: what the board printed, plus what the server did for it. */
export function LogPanel({ nodeId, online }: { nodeId: string; online: boolean }) {
  const [lines, setLines] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [minLevel, setMinLevel] = useState<(typeof LEVELS)[number]>('info');
  const [onlyBoard, setOnlyBoard] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const held = useRef<LogEntry[]>([]);

  useEffect(() => {
    get<LogEntry[]>(`/nodes/${nodeId}/logs`).then(setLines).catch((e) => setError(errorText(e)));
  }, [nodeId]);

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

  const visible = lines.filter(
    (l) => LEVELS.indexOf(l.level) >= LEVELS.indexOf(minLevel) && (!onlyBoard || l.source === 'board'),
  );

  useEffect(() => {
    const box = boxRef.current;
    if (box && stickToBottom.current) box.scrollTop = box.scrollHeight;
  }, [visible.length]);

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="spread">
        <div className="row small">
          <span className={`dot ${online ? 'on' : 'off'}`} />
          <span className="muted">{online ? 'Live' : 'Board offline: new lines arrive when it reconnects'}</span>
        </div>
        <div className="row">
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
          <button className="btn btn-small" onClick={() => setPaused((p) => !p)}>
            {paused ? `Resume${held.current.length ? ` (${held.current.length})` : ''}` : 'Pause'}
          </button>
          <button className="btn btn-small" onClick={() => setLines([])}>Clear</button>
        </div>
      </div>
      <div
        className="logbox"
        ref={boxRef}
        onScroll={(e) => {
          const b = e.currentTarget;
          stickToBottom.current = b.scrollHeight - b.scrollTop - b.clientHeight < 24;
        }}
        role="log"
        aria-live="polite"
      >
        {visible.length === 0 && <div className="log-empty">{error ?? 'No log lines yet.'}</div>}
        {visible.map((l, i) => (
          <div key={i} className={`log-line lvl-${l.level}`}>
            <span className="log-time">{time(l.at)}</span>
            <span className={`log-src ${l.source}`}>{l.source === 'board' ? 'board' : 'server'}</span>
            <span className="log-lvl">{l.level}</span>
            <span className="log-msg">{l.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
