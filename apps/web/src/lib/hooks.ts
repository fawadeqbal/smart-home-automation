'use client';
import { useCallback, useEffect, useState } from 'react';
import { errorText, get } from './api';
import { useLive } from './live';
import type { Device } from './types';

/** Loads data once, with reload() and an error message. */
export function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!path) return;
    try {
      setData(await get<T>(path));
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, [path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, setData, error, reload };
}

/** Every device the person may see, kept live: state changes, boards going offline, edits. */
export function useDevices() {
  const { data, setData, error, reload } = useLoad<Device[]>('/devices');

  useLive('device.state', (e: { id: string; state: Record<string, unknown>; source: string; updatedAt: string }) =>
    setData((list) => list && list.map((d) => (d.id === e.id ? { ...d, state: e.state, source: e.source, updatedAt: e.updatedAt } : d))));
  useLive('node.status', (e: { nodeId: string; online: boolean }) =>
    setData((list) => list && list.map((d) => (d.nodeId === e.nodeId ? { ...d, online: e.online } : d))));
  useLive('devices.changed', () => void reload());

  const replace = (device: Device) => setData((list) => list && list.map((d) => (d.id === device.id ? device : d)));
  return { devices: data, error, reload, replace };
}

/** Re-renders every few seconds so "x ago" labels stay current. */
export function useNow(everyMs = 10_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

export function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const sec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}
