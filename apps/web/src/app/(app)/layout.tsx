'use client';
import { Shell } from '@/components/Shell';
import { LiveProvider } from '@/lib/live';
import { NotificationsProvider } from '@/lib/notifications';
import { SessionProvider } from '@/lib/session';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <LiveProvider>
        <NotificationsProvider>
          <Shell>{children}</Shell>
        </NotificationsProvider>
      </LiveProvider>
    </SessionProvider>
  );
}
