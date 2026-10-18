'use client';
import { InstallationView } from '@/components/installation/InstallationView';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { ConnectGuide } from '@/components/console/ConnectGuide';
import { CustomerCard } from '@/components/service/CustomerCard';
import { EditHomeDialog, InvitePersonDialog } from '@/components/console/Dialogs';
import { ActivityView } from '@/components/home/ActivityView';
import { DiagnosticsView } from '@/components/home/DiagnosticsView';
import { PeopleView } from '@/components/home/PeopleView';
import { RoomsView } from '@/components/home/RoomsView';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { useCrumbs } from '@/components/Shell';
import { Badge, Confirm, Dot, Empty, FirmwareCell, FormModal, Kpi } from '@/components/ui';
import { post } from '@/lib/api';
import { useHomeScope } from '@/lib/homeScope';
import { useLoad } from '@/lib/hooks';
import { useLive } from '@/lib/live';
import { useSession } from '@/lib/session';
import type { Catalog, Workspace, WorkspaceBoard } from '@/lib/types';

const TABS = ['overview', 'boards', 'rooms', 'people', 'diagnostics', 'installation', 'activity'] as const;
type Tab = (typeof TABS)[number];

export default function HomeWorkspace() {
  const { id } = useParams<{ id: string }>();
  useHomeScope(id);
  const router = useRouter();
  const params = useSearchParams();
  const { me, staffRole, switchHome } = useSession();
  const tab: Tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'overview';
  const { data: ws, error, reload } = useLoad<Workspace>(`/platform/homes/${id}`);
  const [dialog, setDialog] = useState<null | 'edit' | 'owner'>(null);
  const [installing, setInstalling] = useState<WorkspaceBoard | null>(null);
  const [removing, setRemoving] = useState<WorkspaceBoard | null>(null);
  const isSuper = staffRole === 'SUPERADMIN';
  const canSetup = isSuper || staffRole === 'INSTALLER';
  const readOnly = staffRole === 'SUPPORT';
  useCrumbs([
    { label: 'Platform', href: staffRole === 'INSTALLER' ? '/console/homes' : '/console' },
    { label: staffRole === 'INSTALLER' ? 'My jobs' : 'Homes', href: '/console/homes' },
    { label: ws?.home.name ?? '…' },
  ]);
  useLive('nodes.changed', () => void reload());
  useLive('node.status', () => void reload());
  useLive('devices.changed', () => void reload());
  useLive('inventory.changed', () => void reload());
  useLive('firmware.changed', () => void reload());

  const boardHref = (nodeId: string, t?: string) => `/console/homes/${id}/boards/${encodeURIComponent(nodeId)}${t ? `?tab=${t}` : ''}`;
  const go = (t: Tab) => router.replace(`/console/homes/${id}${t === 'overview' ? '' : `?tab=${t}`}`, { scroll: false });

  if (!ws) return error ? <div className="alert">{error} <Link href="/console/homes">Back to homes</Link></div> : <Loader label="Opening the home…" />;
  const h = ws.home;
  const installedOffline = ws.boards.filter((b) => b.status === 'ADOPTED' && !b.online).length;

  async function viewAsOwner() {
    await switchHome(id);
    router.push('/');
  }

  function stepAction(n: number) {
    if (n === 2) router.push(`/console/inventory?home=${id}`);
    if (n === 3 || n === 4) go('boards');
    if (n === 5) go('rooms');
    if (n === 6) setDialog('owner');
  }

  const ownerGets = [
    ['house', 'Home', 'Switch everything, scenes, voice', 'Full', 'check', 'info'],
    ['activity', 'Diagnostics', 'Board health and what’s wired where', 'Read-only', 'eye', 'mute'],
    ['users', 'People', 'Invite family, set access per room', 'Full', 'check', 'info'],
    ['cpu', 'Boards and pins', 'Managed by the installer', 'Locked', 'lock', 'mute'],
  ] as const;

  return (
    <div data-screen-label="Home workspace">
      <Link href="/console/homes" className="back"><Icon name="arrow-left" size={14} />{staffRole === 'INSTALLER' ? 'My jobs' : 'Homes'}</Link>
      <div className="ws-head">
        <div className="ws-title">
          <span className="ws-icon"><Icon name="house" size={22} /></span>
          <div className="stack-tight" style={{ gap: 4 }}>
            <div className="row" style={{ gap: 10 }}><h1>{h.name}</h1><Badge tone={h.tone}>{h.statusLabel}</Badge></div>
            <span className="small muted">
              Owner {h.owner?.name ?? (h.ownerInvite ? `${h.ownerInvite.name || h.ownerInvite.email} (invited)` : '—')} · {h.city || 'No city'} · {h.timezone} · Installer {h.installer?.name ?? '—'}
            </span>
          </div>
        </div>
        <div className="ph-actions">
          {readOnly && <span className="badge mute plain" style={{ height: 34, padding: '0 12px', borderRadius: 8 }}><Icon name="eye" size={15} />Read-only support access</span>}
          {isSuper && <Link className="btn" href={`/console/inventory?home=${id}`}><Icon name="package" size={15} />Assign boards</Link>}
          <button className="btn" onClick={() => void viewAsOwner()}><Icon name="eye" size={15} />See what the owner sees</button>
          {isSuper && <button className="btn" onClick={() => setDialog('edit')}><Icon name="settings" size={15} />Edit</button>}
        </div>
      </div>

      <div className="tabs" role="tablist">
        {([['overview', 'Overview'], ['boards', 'Boards', ws.boards.length], ['rooms', 'Rooms', ws.rooms.length], ['people', 'People', ws.stats.people], ['diagnostics', 'Diagnostics'], ['installation', 'Installation'], ['activity', 'Activity']] as [Tab, string, number?][]).map(([k, label, n]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`tab-btn ${tab === k ? 'active' : ''}`} onClick={() => go(k)}>
            {label}{n ? <span className="pill">{n}</span> : null}
            {k === 'diagnostics' && installedOffline > 0 && <Dot tone="bad" />}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid-2">
          <section className="panel">
            <div className="panel-pad stack-sm" style={{ borderBottom: '1px solid var(--ln)', padding: '14px 16px' }}>
              <div className="row" style={{ alignItems: 'baseline', gap: 10 }}><h2>Setup</h2><span className="small muted">{ws.stepsDone} of 6 done</span></div>
              <div className="progress"><i style={{ width: `${(ws.stepsDone / 6) * 100}%` }} /></div>
            </div>
            {ws.steps.map((s) => {
              const actionable = s.current && s.action && (s.n === 2 ? isSuper : canSetup);
              return (
                <div key={s.n} className={`step-row ${s.done ? 'done' : ''} ${s.current ? 'current' : ''}`}>
                  <span className="step-n">{s.done ? <Icon name="check" size={13} stroke={2.5} /> : s.n}</span>
                  <div className="li-text"><b>{s.title}</b><span className="sub" style={{ whiteSpace: 'normal' }}>{s.detail}</span></div>
                  {actionable && <button className="btn btn-sm btn-primary" onClick={() => stepAction(s.n)}>{s.n === 6 && h.ownerInvite ? 'Resend invite' : s.action}</button>}
                  {s.current && !actionable && <span className="small muted nowrap">Next up</span>}
                  {!s.current && !s.done && s.n === 6 && canSetup && !h.owner && <button className="btn btn-sm" onClick={() => setDialog('owner')}>{h.ownerInvite ? 'Resend' : 'Invite'}</button>}
                </div>
              );
            })}
          </section>
          <div className="stack" style={{ gap: 16 }}>
            <section className="kpis k3" style={{ marginBottom: 0 }}>
              <Kpi small label="Boards online" value={`${ws.stats.boardsOnline}/${ws.stats.boardsTotal}`} fg={ws.stats.boardsOnline < ws.boards.filter((b) => b.status === 'ADOPTED').length || ws.boards.some((b) => b.status === 'ASSIGNED') ? 'fg-warn' : ''} />
              <Kpi small label="Devices" value={ws.stats.devices} />
              <Kpi small label="People" value={ws.stats.people} />
            </section>
            <CustomerCard ws={ws} canEdit={canSetup} onChanged={() => void reload()} />
            <section className="panel">
              <div className="panel-head"><h2>What the owner gets</h2><Link href="/console/roles" className="link-btn">Roles</Link></div>
              {ownerGets.map(([icon, t, d, k, kicon, tone]) => (
                <div className="li" key={t}>
                  <span className="li-icon"><Icon name={icon} size={15} /></span>
                  <div className="li-text"><b>{t}</b><span className="sub">{d}</span></div>
                  <span className={`tag ${tone === 'info' ? 'info' : 'mute'}`} style={{ borderRadius: 999 }}><Icon name={kicon} size={12} />{k}</span>
                </div>
              ))}
            </section>
          </div>
        </div>
      )}

      {tab === 'boards' && (
        <div className="stack" style={{ gap: 12 }}>
          {ws.boards.length === 0 ? (
            <Empty action={isSuper && <Link className="btn btn-primary" href={`/console/inventory?home=${id}`}><Icon name="package" size={15} />Assign boards</Link>}>
              No boards assigned yet. Boards come from inventory — assign them, then the installer installs them on site.
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="table" style={{ minWidth: 760 }}>
                <thead><tr>{['Board', 'Condition', 'Pins', 'Devices', 'Firmware', ''].map((c) => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>
                  {ws.boards.map((b) => (
                    <tr key={b.id} className={b.status === 'ADOPTED' ? 'click' : ''} onClick={b.status === 'ADOPTED' ? () => router.push(boardHref(b.id)) : undefined}
                      title={b.status === 'ADOPTED' ? `Open ${b.location ?? b.id}` : undefined}>
                      <td>
                        <div className="cell-main" style={{ gap: 12 }}>
                          <Dot tone={b.cond} />
                          <span className="stack-tight"><b>{b.location ?? 'Not installed'}</b><span className="mono" style={{ fontSize: 11.5, color: 'var(--mu)' }}>{b.id} · {b.model}</span></span>
                        </div>
                      </td>
                      <td className={`nowrap fg-${b.cond === 'ok' ? 'ok' : b.cond === 'warn' ? 'warn' : b.cond === 'bad' ? 'bad' : 'mu'}`} style={{ fontWeight: 500 }}>{b.condText}</td>
                      <td>
                        <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                          <span className="progress ac" style={{ width: 80 }}><i style={{ width: `${(b.pinsUsed / b.pinsTotal) * 100}%` }} /></span>
                          <span className="cell-sub nowrap">{b.pinsUsed}/{b.pinsTotal}</span>
                        </div>
                      </td>
                      <td>{b.devices}</td>
                      <td className="mono" style={{ fontSize: 12 }}><FirmwareCell version={b.firmware} latest={ws.currentFirmware} old={b.firmwareOld} /></td>
                      <td className="right nowrap">
                        {b.status === 'ASSIGNED' && canSetup && (
                          <button className={`btn btn-sm ${b.online ? 'btn-primary' : ''}`} disabled={!b.online} title={b.online ? '' : 'Power the board and connect it to the home’s Wi‑Fi first'} onClick={() => setInstalling(b)}>
                            {b.online ? 'Install' : 'Waiting for power'}
                          </button>
                        )}
                        {b.status === 'ADOPTED' && (
                          <Link className="btn btn-sm" href={boardHref(b.id)} onClick={(e) => e.stopPropagation()}>Open board<Icon name="chevron-right" size={14} /></Link>
                        )}
                        {b.status === 'ASSIGNED' && isSuper && <button className="btn btn-sm btn-ghost" style={{ marginLeft: 6 }} onClick={() => setRemoving(b)}>Back to stock</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {canSetup && <ConnectGuide />}
        </div>
      )}

      {tab === 'rooms' && <RoomsView canEdit={canSetup} />}
      {tab === 'people' && (
        <PeopleView actorRole={isSuper ? 'OWNER' : 'ADMIN'} actorId={me.id} canManage={isSuper} ownerInviteOnly={staffRole === 'INSTALLER'} />
      )}
      {tab === 'diagnostics' && (
        <DiagnosticsView canSetup={canSetup} installerName={h.installer?.name} allowSupport={false}
          editHref={(nodeId) => boardHref(nodeId, 'devices')} openHref={(nodeId) => boardHref(nodeId)} />
      )}
      {tab === 'installation' && <InstallationView homeId={id} />}
      {tab === 'activity' && <ActivityView source={`/platform/audit?home=${id}`} showHome={false} />}

      {dialog === 'edit' && <EditHomeDialog ws={ws} onClose={() => setDialog(null)} onSaved={() => void reload()} />}
      {dialog === 'owner' && <InvitePersonDialog rooms={ws.rooms} canAdmin ownerInvite onClose={() => setDialog(null)} onDone={() => void reload()} />}
      {installing && <InstallDialog board={installing} onClose={() => setInstalling(null)} onDone={() => void reload()} />}
      {removing && (
        <Confirm title={`Send ${removing.id} back to stock?`} confirmLabel="Back to stock" danger={false}
          body="It leaves this home and can be assigned somewhere else."
          onConfirm={async () => { await post(`/platform/inventory/${removing.id}/unassign`); await reload(); }} onClose={() => setRemoving(null)} />
      )}
    </div>
  );
}

function InstallDialog({ board, onClose, onDone }: { board: WorkspaceBoard; onClose: () => void; onDone: () => void }) {
  const catalog = useLoad<Catalog>('/catalog');
  return (
    <FormModal title="Install board" sub={<>Name it after where it is — the owner sees this name. <span className="mono">{board.id}</span></>} submitLabel="Install" onClose={onClose}
      onSubmit={async (f) => { await post(`/nodes/${board.id}/adopt`, { name: f.get('name'), board: f.get('board') }); onDone(); }}>
      <div className="form-grid">
        <label className="field">Where is it?<input name="name" required maxLength={60} placeholder="Living room" /></label>
        <label className="field">Model
          <select name="board" defaultValue={board.board}>{catalog.data?.boards.map((b) => <option key={b.type} value={b.type}>{b.name}</option>) ?? <option value={board.board}>{board.model}</option>}</select>
        </label>
      </div>
      <p className="small muted">Then add its lights, sensors and wall buttons under <b>Configure pins</b>.</p>
    </FormModal>
  );
}
