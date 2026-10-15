'use client';
import { useEffect, useState } from 'react';
import { onPending } from '@/lib/api';

/** A small spinning ring. Inherits the text colour. */
export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} role="status" aria-label="Loading" />;
}

/** Centred spinner with a label, for a page or section that is still loading. */
export function Loader({ label = 'Loading…', full = false }: { label?: string; full?: boolean }) {
  return (
    <div className={full ? 'loader loader-full' : 'loader'}>
      <Spinner size={22} />
      <span>{label}</span>
    </div>
  );
}

/** Thin bar at the top of the window while any API call is running (shown after 150 ms, so quick calls don't flash). */
export function ApiProgress() {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = onPending((n) => {
      clearTimeout(timer);
      if (n > 0) timer = setTimeout(() => setBusy(true), 150);
      else setBusy(false);
    });
    return () => { clearTimeout(timer); off(); };
  }, []);
  return <div className={`api-progress ${busy ? 'on' : ''}`} aria-hidden />;
}
