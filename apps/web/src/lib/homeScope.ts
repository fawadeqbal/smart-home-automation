'use client';
import { useEffect, useRef } from 'react';
import { setApiHome } from './api';
import { useSession } from './session';

let scopes = 0;

/**
 * While a console page about one home is open, every home-scoped API call and the live connection
 * are about that home (X-Home-Id). Leaving it goes back to the person's own current home.
 * Set during render, so the page's children already fetch with it.
 */
export function useHomeScope(id: string) {
  const { home } = useSession();
  const back = useRef(home?.id ?? null);
  back.current = home?.id ?? null;
  setApiHome(id);
  useEffect(() => {
    scopes++;
    setApiHome(id);
    return () => {
      scopes--;
      const restore = back.current;
      // deferred: a quick unmount/mount (React strict mode, moving between workspace pages) keeps the scope
      setTimeout(() => { if (scopes === 0) setApiHome(restore); }, 0);
    };
  }, [id]);
}
