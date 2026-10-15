'use client';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { ApiError, get, post, setApiHome } from './api';
import type { CurrentHome, Me, StaffRole } from './types';
import { Loader } from '@/components/Loader';

interface Session {
  me: Me;
  /** The home the home pages show (null: none picked / none available). */
  home: CurrentHome | null;
  /** Owner or admin of the current home (or staff acting as one). */
  isAdmin: boolean;
  staffRole: StaffRole | null;
  reload: () => Promise<void>;
  /** Opens another home (members: remembered; staff: any home they may see). */
  switchHome: (homeId: string) => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);
const HOME_KEY = 'home';

function savedHome(): string | null {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('home');
    return fromUrl || localStorage.getItem(HOME_KEY);
  } catch {
    return null;
  }
}

function remember(id: string | null) {
  try {
    if (id) localStorage.setItem(HOME_KEY, id);
    else localStorage.removeItem(HOME_KEY);
  } catch { /* private mode */ }
}

/** Where someone lands after signing in. */
export function landingFor(me: Pick<Me, 'staff' | 'home'>): string {
  if (me.staff?.role === 'INSTALLER') return '/console/homes';
  if (me.staff) return '/console';
  return '/';
}

/**
 * Loads the signed-in person and the home they are looking at; sends them to /login, /setup or
 * /signup when needed. The current home goes into every API call (X-Home-Id).
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [me, setMe] = useState<Me | null>(null);

  const load = useCallback(async (homeId: string | null) => {
    setApiHome(homeId);
    try {
      const next = await get<Me>('/auth/me');
      setApiHome(next.home?.id ?? null);
      remember(next.home?.id ?? null);
      setMe(next);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404 && homeId) {
        remember(null);
        return load(null); // that home is not mine (any more): open my default one
      }
      if (err instanceof ApiError && err.status === 401) {
        const { setupNeeded } = await get<{ setupNeeded: boolean }>('/auth/status');
        router.replace(setupNeeded ? '/setup' : `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }
      throw err;
    }
  }, [router]);

  useEffect(() => {
    load(savedHome()).catch(() => router.replace('/login'));
  }, [load, router]);

  const reload = useCallback(() => load(me?.home?.id ?? savedHome()), [load, me?.home?.id]);

  const switchHome = useCallback(async (homeId: string) => {
    const isMine = me?.homes.some((h) => h.id === homeId);
    setApiHome(homeId);
    // a home I belong to is remembered on the server too; staff just look at it
    const next = isMine ? await post<Me>('/auth/home', { homeId }) : await get<Me>('/auth/me');
    setApiHome(next.home?.id ?? null);
    remember(next.home?.id ?? null);
    setMe(next);
  }, [me?.homes]);

  const logout = useCallback(async () => {
    await post('/auth/logout').catch(() => undefined);
    remember(null);
    setApiHome(null);
    router.replace('/login');
  }, [router]);

  if (!me) return <Loader full />;
  const home = me.home;
  const isAdmin = !!home && (home.role === 'OWNER' || home.role === 'ADMIN');
  void path;
  return (
    <SessionContext.Provider value={{ me, home, isAdmin, staffRole: me.staff?.role ?? null, reload, switchHome, logout }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession outside SessionProvider');
  return session;
}
