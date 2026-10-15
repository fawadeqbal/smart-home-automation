'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { AskBar } from '@/components/assistant/Assistant';
import { DeviceCard } from '@/components/DeviceCard';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { useCrumbs } from '@/components/Shell';
import { Empty, ErrorBox, Kpi, useAction } from '@/components/ui';
import { post } from '@/lib/api';
import { useDevices, useLoad } from '@/lib/hooks';
import { useLive } from '@/lib/live';
import { landingFor, useSession } from '@/lib/session';
import type { Device, Scene } from '@/lib/types';

function groupByRoom(devices: Device[]) {
  const groups = new Map<string, Device[]>();
  for (const d of devices) {
    const room = d.roomName ?? 'No room';
    groups.set(room, [...(groups.get(room) ?? []), d]);
  }
  return [...groups.entries()];
}

export default function HomePage() {
  const router = useRouter();
  const { me, home, isAdmin } = useSession();
  useEffect(() => { if (!home && me.staff) router.replace(landingFor(me)); }, [home, me, router]);
  useCrumbs(home ? [{ label: home.name, href: '/' }, { label: 'Home' }] : [{ label: 'Home' }]);

  if (!home) {
    return me.staff ? <Loader /> : (
      <Empty>You’re not part of a home yet. Ask the home owner (or your installer) to send you an invite link.</Empty>
    );
  }
  return <HomeDashboard key={home.id} isAdmin={isAdmin} firstName={me.name.split(' ')[0]!} readOnly={home.readOnly} />;
}

function HomeDashboard({ isAdmin, firstName, readOnly }: { isAdmin: boolean; firstName: string; readOnly: boolean }) {
  const { devices, error, replace, reload } = useDevices();
  const scenes = useLoad<Scene[]>(readOnly ? null : '/scenes');
  const [activeScene, setActiveScene] = useState<string | null>(null);
  const { error: sceneError, run } = useAction();
  useLive('schedules.changed', () => void scenes.reload());

  const groups = useMemo(() => (devices ? groupByRoom(devices) : []), [devices]);
  if (!devices) return error ? <div className="alert">{error}</div> : <Loader label="Loading your home…" />;

  const switches = devices.filter((d) => d.controllable);
  const onNow = switches.filter((d) => d.online && d.state?.on).length;
  const offline = devices.filter((d) => !d.online);
  const temps = devices.map((d) => d.state?.temperature).filter((t): t is number => typeof t === 'number');
  const hour = new Date().getHours();
  const greeting = `${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}, ${firstName}`;
  // one banner per offline board (named after its room when the board serves one room)
  const offlineBoards = [...new Map(offline.map((d) => [d.nodeId, d])).values()];
  const runnable = (scenes.data ?? []).filter((s) => s.canRun);

  async function runScene(s: Scene) {
    const res = await run(() => post<{ summary: string }>(`/scenes/${s.id}/run`));
    if (res) { setActiveScene(s.id); void reload(); }
  }

  return (
    <div data-screen-label="Owner home">
      {offlineBoards.map((d) => {
        const rooms = [...new Set(offline.filter((x) => x.nodeId === d.nodeId).map((x) => x.roomName ?? d.nodeName))];
        const place = rooms.length === 1 ? rooms[0] : d.nodeName;
        return (
          <div key={d.nodeId} className="banner bad">
            <span className="banner-led" />
            <div className="banner-text">
              <b>{place} is offline</b>
              <span>The wall switches still work. It reconnects by itself — your installer has been told.</span>
            </div>
            {isAdmin && <Link className="btn" href={`/diagnostics?board=${d.nodeId}`}>See what’s wrong</Link>}
          </div>
        );
      })}

      <div className="ph-text mb20">
        <h1>{greeting}</h1>
        <p>{onNow} on{offline.length ? ` · ${offline.length} offline` : ''}</p>
      </div>

      <div className="kpis k3">
        <Kpi label="On now" value={onNow} chip={{ icon: 'lightbulb', tone: 'on' }} small />
        <Kpi label="Devices" value={devices.length} chip={{ icon: 'cpu', tone: 'ac' }} small />
        <Kpi label="Inside" value={temps.length ? (temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1) : '–'} unit="°C" chip={{ icon: 'thermometer', tone: 'ok' }} small />
      </div>

      {runnable.length > 0 && (
        <div className="scenes" role="group" aria-label="Scenes">
          {runnable.map((s) => (
            <button key={s.id} className={`scene-chip ${activeScene === s.id ? 'active' : ''}`} onClick={() => void runScene(s)}>
              <span className="si"><Icon name={s.icon} size={14} /></span>{s.name}
            </button>
          ))}
          <Link className="scene-chip" href="/automations"><span className="si"><Icon name="plus" size={14} /></span>Scenes & timers</Link>
        </div>
      )}
      <ErrorBox error={sceneError} />

      {!readOnly && <AskBar />}

      {devices.length === 0 && (
        <Empty>
          {isAdmin ? 'No devices yet. Your installer adds lights, sockets and sensors to the boards — they appear here.' : 'No rooms have been shared with you yet. Ask the home owner to give you access.'}
        </Empty>
      )}
      {groups.map(([room, list]) => {
        const on = list.filter((d) => d.controllable && d.online && d.state?.on).length;
        const viewOnly = list.every((d) => d.access === 'VIEW');
        const off = list.some((d) => !d.online);
        return (
          <section className="section" key={room}>
            <div className="section-head">
              <h2>{room}</h2>
              <span className="pill">{list.length} device{list.length === 1 ? '' : 's'}{on ? ` · ${on} on` : ''}{off ? ' · offline' : ''}</span>
              {viewOnly && <span className="row small muted" style={{ gap: 4 }}><Icon name="eye" size={13} />View only</span>}
            </div>
            <div className="tiles">
              {list.map((d) => <DeviceCard key={d.id} device={d} onChange={replace} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}
