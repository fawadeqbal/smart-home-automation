'use client';
/**
 * One Socket.IO connection per browser tab for live updates (device states, boards online/offline).
 * Components subscribe with useLive('device.state', handler).
 */
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { getApiHome, onHomeChange, refreshSession } from './api';

type Handler = (payload: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Live {
  connected: boolean;
  subscribe: (event: string, handler: Handler) => () => void;
}

const LiveContext = createContext<Live>({ connected: false, subscribe: () => () => undefined });

/** Same site in the cloud; during development the web app runs on :3000 and the API on :4000. */
function socketUrl(): string {
  if (process.env.NEXT_PUBLIC_SOCKET_URL) return process.env.NEXT_PUBLIC_SOCKET_URL;
  const { protocol, hostname, port } = window.location;
  return port === '3000' ? `${protocol}//${hostname}:4000` : window.location.origin;
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const handlers = useRef(new Map<string, Set<Handler>>());
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // the socket joins the rooms of the current home; it reconnects when another home is opened
    const socket = io(socketUrl(), { withCredentials: true, transports: ['websocket', 'polling'], auth: (cb) => cb({ home: getApiHome() }) });
    socketRef.current = socket;
    let last = getApiHome();
    const off = onHomeChange((id) => {
      if (id === last) return;
      last = id;
      socket.disconnect();
      setTimeout(() => socket.connect(), 50);
    });
    socket.on('ready', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('auth.error', async (e: { message?: string }) => {
      if (/home/i.test(e?.message ?? '')) return; // that home is not open to me: stay disconnected until another is picked
      if (await refreshSession()) setTimeout(() => socket.connect(), 300);
    });
    // Our rights changed: the server dropped us; reconnect to join the right rooms.
    socket.on('access.changed', () => setTimeout(() => socket.connect(), 500));
    socket.onAny((event, payload) => handlers.current.get(event)?.forEach((h) => h(payload)));
    return () => {
      off();
      socket.close();
    };
  }, []);

  const subscribe = useCallback((event: string, handler: Handler) => {
    if (!handlers.current.has(event)) handlers.current.set(event, new Set());
    handlers.current.get(event)!.add(handler);
    return () => void handlers.current.get(event)?.delete(handler);
  }, []);

  return <LiveContext.Provider value={{ connected, subscribe }}>{children}</LiveContext.Provider>;
}

export const useLiveStatus = () => useContext(LiveContext).connected;

export function useLive(event: string, handler: Handler) {
  const { subscribe } = useContext(LiveContext);
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => subscribe(event, (p) => latest.current(p)), [event, subscribe]);
}
