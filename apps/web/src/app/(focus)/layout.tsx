'use client';
import { LiveProvider } from '@/lib/live';
import { SessionProvider } from '@/lib/session';

/** Full-screen pages for a signed-in person, without the app's menu: the first-run tours. */
export default function FocusLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <LiveProvider>{children}</LiveProvider>
    </SessionProvider>
  );
}
