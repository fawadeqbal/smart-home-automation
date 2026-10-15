'use client';
import { useState } from 'react';
import { InvitePersonDialog } from '@/components/console/Dialogs';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { Avatar, Confirm, Dropdown, ErrorBox, useAction } from '@/components/ui';
import { del, patch, put } from '@/lib/api';
import { useLoad } from '@/lib/hooks';
import { ACCESS_LABEL, ROLE_LABEL, STAFF_LABEL } from '@/lib/roles';
import type { Access, FamilyMember, Invite, Role, Room } from '@/lib/types';

/**
 * Who can sign in to the home, and what each person may do in each room.
 * `actorRole` is the viewer's role in the home; `canManage` false = read-only (support, installers).
 */
export function PeopleView({ actorRole, actorId, canManage, ownerInviteOnly = false }: {
  actorRole: Role; actorId: string; canManage: boolean; ownerInviteOnly?: boolean;
}) {
  const people = useLoad<FamilyMember[]>('/users');
  const rooms = useLoad<Room[]>('/rooms');
  const invites = useLoad<Invite[]>(canManage || ownerInviteOnly ? '/invites' : null);
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<FamilyMember | null>(null);
  const { error, run } = useAction();

  if (!people.data || !rooms.data) return people.error ?? rooms.error ? <div className="alert">{people.error ?? rooms.error}</div> : <Loader label="Loading people…" />;
  const reload = () => { void people.reload(); void invites.reload(); };
  const isOwner = actorRole === 'OWNER';
  const hasOwner = people.data.some((p) => p.role === 'OWNER');
  const editable = (p: FamilyMember) => canManage && p.id !== actorId && !p.staff && p.role !== 'OWNER' && (isOwner || (p.role !== 'ADMIN'));
  const pending = invites.data ?? [];
  const guestLinks = pending.filter((i) => i.role === 'GUEST');

  async function setAccess(p: FamilyMember, roomId: string, access: Access | '') {
    const others = p.rooms.filter((r) => r.roomId !== roomId);
    await run(() => put(`/users/${p.id}/rooms`, { rooms: access ? [...others, { roomId, access }] : others }));
    void people.reload();
  }

  return (
    <div className="stack" style={{ gap: 12 }} data-screen-label="People">
      <div className="row" style={{ gap: 10 }}>
        <span className="small muted">
          {people.data.length} {people.data.length === 1 ? 'person' : 'people'}
          {pending.length ? ` · ${pending.length} invite${pending.length === 1 ? '' : 's'} pending` : ''}
          {guestLinks.length ? ` · guest link${guestLinks.length === 1 ? '' : 's'} expire ${new Date(guestLinks[0]!.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}
        </span>
        {canManage && !ownerInviteOnly && <button className="btn btn-primary push" onClick={() => setInviting(true)}><Icon name="plus" size={15} />Invite someone</button>}
        {ownerInviteOnly && !hasOwner && <button className="btn btn-primary push" onClick={() => setInviting(true)}><Icon name="send" size={14} />Send owner invite</button>}
      </div>
      <ErrorBox error={error} />
      <div className="table-wrap">
        <table className="table" style={{ minWidth: 720 }}>
          <thead>
            <tr>
              <th>Person</th><th>Role</th>
              {rooms.data.map((r) => <th key={r.id}>{r.name}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {people.data.map((p) => {
              const roleText = p.staff ? STAFF_LABEL[p.staff] : ROLE_LABEL[p.role!];
              const can = editable(p);
              return (
                <tr key={p.id}>
                  <td>
                    <div className="cell-main">
                      <Avatar name={p.name} role={roleText} size="sm" />
                      <span className="stack-tight"><b>{p.name}{p.id === actorId ? <span className="muted" style={{ fontWeight: 400 }}> (you)</span> : null}</b><span className="cell-sub">{p.staff ? 'Platform staff' : p.email}</span></span>
                    </div>
                  </td>
                  <td>
                    {can && (p.role === 'MEMBER' || p.role === 'GUEST' || (isOwner && p.role === 'ADMIN')) ? (
                      <select className="inline-select" value={p.role!} aria-label={`Role of ${p.name}`}
                        onChange={(e) => void run(() => patch(`/users/${p.id}`, { role: e.target.value })).then(() => people.reload())}>
                        {(isOwner ? ['ADMIN', 'MEMBER', 'GUEST'] : ['MEMBER', 'GUEST']).map((r) => <option key={r} value={r}>{ROLE_LABEL[r as Role]}</option>)}
                      </select>
                    ) : <span className={`tag ${p.staff ? 'ok' : ''}`}>{roleText}</span>}
                  </td>
                  {rooms.data!.map((r) => {
                    if (p.staff) return <td key={r.id}><span className="access-chip">Setup access</span></td>;
                    if (p.role === 'OWNER' || p.role === 'ADMIN') return <td key={r.id}><span className="access-chip">Everything</span></td>;
                    const a = p.rooms.find((x) => x.roomId === r.id)?.access;
                    if (!can) return <td key={r.id}><span className={`access-chip ${a ? a.toLowerCase() : ''}`}>{a ? ACCESS_LABEL[a] : 'No access'}</span></td>;
                    return (
                      <td key={r.id}>
                        <select className={`access-chip ${a ? a.toLowerCase() : ''}`} value={a ?? ''} aria-label={`${p.name} in ${r.name}`}
                          onChange={(e) => void setAccess(p, r.id, e.target.value as Access | '')}>
                          <option value="">No access</option>
                          <option value="VIEW">{ACCESS_LABEL.VIEW}</option>
                          <option value="CONTROL">{ACCESS_LABEL.CONTROL}</option>
                          {p.role === 'MEMBER' && <option value="MANAGE">{ACCESS_LABEL.MANAGE}</option>}
                        </select>
                      </td>
                    );
                  })}
                  <td className="right nowrap">
                    {p.disabled ? <span className="badge bad">Disabled</span> : <span className="small muted">{p.staff ? 'Installer' : `Joined ${new Date(p.joinedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}</span>}
                    {can && (
                      <Dropdown align="right" width={200} trigger={(_o, t) => <button className="icon-btn" onClick={t} aria-label={`More for ${p.name}`} style={{ marginLeft: 6 }}><Icon name="more" size={16} /></button>}>
                        {(close) => (
                          <>
                            <button className="menu-item" onClick={() => { close(); void run(() => patch(`/users/${p.id}`, { disabled: !p.disabled })).then(() => people.reload()); }}>
                              <Icon name={p.disabled ? 'check' : 'lock'} size={15} />{p.disabled ? 'Enable account' : 'Disable account'}
                            </button>
                            <button className="menu-item danger" onClick={() => { close(); setRemoving(p); }}><Icon name="trash" size={15} />Remove from home</button>
                          </>
                        )}
                      </Dropdown>
                    )}
                  </td>
                </tr>
              );
            })}
            {pending.map((i) => (
              <tr key={i.id}>
                <td>
                  <div className="cell-main">
                    <span className="avatar sm av-system"><Icon name="send" size={13} /></span>
                    <span className="stack-tight"><b>{i.name || i.email}</b><span className="cell-sub">{i.name ? `${i.email} · ` : ''}Invite link</span></span>
                  </div>
                </td>
                <td><span className="tag mute">{ROLE_LABEL[i.role]}</span></td>
                {rooms.data!.map((r) => <td key={r.id}><span className="access-chip">—</span></td>)}
                <td className="right nowrap">
                  <span className="small muted">Until {new Date(i.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                  {(canManage || ownerInviteOnly) && <button className="btn btn-sm btn-ghost" style={{ marginLeft: 6 }} onClick={() => void run(() => del(`/invites/${i.id}`)).then(() => invites.reload())}>Cancel</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {inviting && <InvitePersonDialog rooms={rooms.data} canAdmin={isOwner} ownerInvite={ownerInviteOnly} onClose={() => setInviting(false)} onDone={reload} />}
      {removing && (
        <Confirm title={`Remove ${removing.name}?`} confirmLabel="Remove"
          body={<>They can no longer open this home. Their account is deleted if they belong to no other home.</>}
          onConfirm={async () => { await del(`/users/${removing.id}`); reload(); }} onClose={() => setRemoving(null)} />
      )}
    </div>
  );
}
