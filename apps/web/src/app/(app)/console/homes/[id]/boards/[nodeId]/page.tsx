'use client';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { BOARD_TABS, BoardDetail, BoardTab } from '@/components/BoardParts';
import { Loader } from '@/components/Loader';
import { useCrumbs } from '@/components/Shell';
import { useHomeScope } from '@/lib/homeScope';
import { useLoad } from '@/lib/hooks';
import { useLive } from '@/lib/live';
import { useSession } from '@/lib/session';
import type { BoardNode, Catalog, Room, Workspace } from '@/lib/types';

/** Staff: one board of a home — health, devices and wall buttons, pin map, Wi‑Fi, firmware, live log. Support sees it read-only. */
export default function ConsoleBoardPage() {
  const { id, nodeId } = useParams<{ id: string; nodeId: string }>();
  useHomeScope(id);
  const router = useRouter();
  const params = useSearchParams();
  const { staffRole } = useSession();
  const tab = (BOARD_TABS.includes(params.get('tab') as BoardTab) ? params.get('tab') : 'overview') as BoardTab;
  const ws = useLoad<Workspace>(`/platform/homes/${id}`);
  const nodes = useLoad<BoardNode[]>('/nodes');
  const catalog = useLoad<Catalog>('/catalog');
  const rooms = useLoad<Room[]>('/rooms');
  const board = decodeURIComponent(nodeId);
  // same order as the home's Boards tab, so previous / next match the list you came from
  const order = ws.data?.boards.map((b) => b.id) ?? [];
  const rank = (nid: string) => (order.indexOf(nid) + 1 || order.length + 1);
  // installed boards, and faulty ones still in the home (waiting for a replacement)
  const installed = (nodes.data ?? []).filter((n) => n.status === 'ADOPTED' || n.status === 'FAULTY').sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
  const node = installed.find((n) => n.id === board);
  const canSetup = staffRole === 'SUPERADMIN' || staffRole === 'INSTALLER';
  const boardsHref = `/console/homes/${id}?tab=boards`;
  const hrefFor = (nodeId: string, t: BoardTab = tab) => `/console/homes/${id}/boards/${encodeURIComponent(nodeId)}${t === 'overview' ? '' : `?tab=${t}`}`;
  useCrumbs([
    { label: 'Platform', href: staffRole === 'INSTALLER' ? '/console/homes' : '/console' },
    { label: staffRole === 'INSTALLER' ? 'My jobs' : 'Homes', href: '/console/homes' },
    { label: ws.data?.home.name ?? '…', href: `/console/homes/${id}` },
    { label: 'Boards', href: boardsHref },
    { label: node?.name ?? board },
  ]);
  useLive('nodes.changed', () => { void nodes.reload(); void ws.reload(); });
  useLive('firmware.changed', () => void ws.reload());
  useLive('node.status', () => void nodes.reload());
  useLive('node.health', (e: { nodeId: string; health: BoardNode['health']; lastSeenAt: string }) =>
    nodes.setData((list) => list?.map((n) => (n.id === e.nodeId ? { ...n, health: e.health, lastSeenAt: e.lastSeenAt } : n)) ?? list));

  if (!nodes.data || !catalog.data || !rooms.data) {
    const error = nodes.error ?? catalog.error ?? rooms.error;
    return error ? <div className="alert">{error}</div> : <Loader label="Loading board…" />;
  }
  if (!node) return <div className="empty">This board is not installed in this home. <Link href={boardsHref}>Back to its boards</Link></div>;
  return (
    <BoardDetail
      node={node} catalog={catalog.data} rooms={rooms.data} reload={nodes.reload} tab={tab} canSetup={canSetup}
      backHref={boardsHref} backLabel={`${ws.data?.home.name ?? 'Home'} · all boards`}
      siblings={installed} hrefFor={(nodeId) => hrefFor(nodeId)} latestFirmware={ws.data?.currentFirmware ?? null}
      onTab={(t) => router.replace(hrefFor(node.id, t), { scroll: false })}
      onForgotten={() => router.push(boardsHref)}
      onReplaced={(r) => router.replace(hrefFor(r.newId, 'overview'))}
    />
  );
}
