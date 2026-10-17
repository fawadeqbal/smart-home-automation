'use client';
import { useState } from 'react';
import { InviteStaffDialog } from '@/components/console/Dialogs';
import { PasswordLinkDialog } from '@/components/PasswordLinkDialog';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { useCrumbs } from '@/components/Shell';
import { Avatar, Confirm, Dropdown, ErrorBox, PageHead, useAction } from '@/components/ui';
import { del, patch, post } from '@/lib/api';
import { useLoad } from '@/lib/hooks';
import { STAFF_BLURB, STAFF_LABEL } from '@/lib/roles';
import type { StaffList, StaffRole } from '@/lib/types';

/** Super admin: the organization's staff — installers, support and other super admins. */
export default function TeamPage() {
  const { data, error, reload } = useLoad<StaffList>('/platform/staff');
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<StaffList['people'][number] | null>(null);
  const [resetFor, setResetFor] = useState<StaffList['people'][number] | null>(null);
  const [off2fa, setOff2fa] = useState<StaffList['people'][number] | null>(null);
  const { error: actionError, run } = useAction();
  useCrumbs([{ label: 'Platform', href: '/console' }, { label: 'Team' }]);
  if (!data) return error ? <div className="alert">{error}</div> : <Loader label="Loading your team…" />;
  const by = (r: StaffRole) => data.people.filter((p) => p.staffRole === r).length;
  return (
    <>
      <PageHead
        eyebrow="Platform" title="Team"
        sub={`${data.people.length} people · ${by('SUPERADMIN')} super admin${by('SUPERADMIN') === 1 ? '' : 's'} · ${by('INSTALLER')} installers · ${by('SUPPORT')} support`}
        actions={<button className="btn btn-primary" onClick={() => setInviting(true)}><Icon name="user-plus" size={15} />Invite to team</button>}
      />
      <ErrorBox error={actionError} />
      <div className="table-wrap mt8">
        <table className="table" style={{ minWidth: 720 }}>
          <thead><tr><th>Person</th><th>Role</th><th>Homes</th><th>Since</th><th /></tr></thead>
          <tbody>
            {data.people.map((p) => (
              <tr key={p.id}>
                <td>
                  <div className="cell-main">
                    <Avatar name={p.name} role={p.roleLabel} size="sm" />
                    <span className="stack-tight"><b>{p.name}{p.me && <span className="muted" style={{ fontWeight: 400 }}> (you)</span>}</b><span className="cell-sub">{p.email}</span></span>
                  </div>
                </td>
                <td>
                  {p.me ? <span className="tag">{p.roleLabel}</span> : (
                    <select className="inline-select" value={p.staffRole} aria-label={`Role of ${p.name}`} title={STAFF_BLURB[p.staffRole]}
                      onChange={(e) => void run(() => patch(`/platform/staff/${p.id}`, { staffRole: e.target.value })).then(() => reload())}>
                      {(['SUPERADMIN', 'INSTALLER', 'SUPPORT'] as StaffRole[]).map((r) => <option key={r} value={r}>{STAFF_LABEL[r]}</option>)}
                    </select>
                  )}
                </td>
                <td>{p.staffRole === 'INSTALLER' || p.homes ? `${p.homes} assigned` : <span className="muted">All</span>}</td>
                <td className="muted nowrap">{new Date(p.since).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                <td className="right nowrap">
                  {p.disabled && <span className="badge bad" style={{ marginRight: 6 }}>Disabled</span>}
                  {!p.me && (
                    <Dropdown align="right" width={200} trigger={(_o, t) => <button className="icon-btn" onClick={t} aria-label={`More for ${p.name}`}><Icon name="more" size={16} /></button>}>
                      {(close) => (
                        <>
                          <button className="menu-item" onClick={() => { close(); void run(() => patch(`/platform/staff/${p.id}`, { disabled: !p.disabled })).then(() => reload()); }}>
                            <Icon name={p.disabled ? 'check' : 'lock'} size={15} />{p.disabled ? 'Enable sign-in' : 'Disable sign-in'}
                          </button>
                          {p.staffRole !== 'SUPERADMIN' && !p.disabled && (
                            <button className="menu-item" onClick={() => { close(); setResetFor(p); }}><Icon name="key" size={15} />Password link</button>
                          )}
                          {p.staffRole !== 'SUPERADMIN' && p.twoFactor && (
                            <button className="menu-item" onClick={() => { close(); setOff2fa(p); }}><Icon name="shield" size={15} />Turn off two-step sign-in</button>
                          )}
                          <button className="menu-item danger" onClick={() => { close(); setRemoving(p); }}><Icon name="trash" size={15} />Remove from team</button>
                        </>
                      )}
                    </Dropdown>
                  )}
                </td>
              </tr>
            ))}
            {data.invites.map((i) => (
              <tr key={i.id}>
                <td>
                  <div className="cell-main">
                    <span className="avatar sm av-system"><Icon name="send" size={13} /></span>
                    <span className="stack-tight"><b>{i.name || i.email}</b><span className="cell-sub">{i.name ? `${i.email} · ` : ''}Invite pending</span></span>
                  </div>
                </td>
                <td><span className="tag mute">{STAFF_LABEL[i.staffRole]}</span></td>
                <td className="muted">—</td>
                <td className="muted nowrap">Until {new Date(i.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</td>
                <td className="right"><button className="btn btn-sm btn-ghost" onClick={() => void run(() => del(`/platform/staff/invites/${i.id}`)).then(() => reload())}>Cancel</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {inviting && <InviteStaffDialog onClose={() => setInviting(false)} onDone={() => void reload()} />}
      {off2fa && (
        <Confirm title={`Turn off two-step sign-in for ${off2fa.name}?`} confirmLabel="Turn off"
                 body="Only when they’ve lost their phone and their recovery codes. They sign in with their password and should turn it on again. They get an email about it."
                 onConfirm={async () => { await post(`/auth/2fa/reset/${off2fa.id}`); await reload(); }} onClose={() => setOff2fa(null)} />
      )}
      {resetFor && <PasswordLinkDialog name={resetFor.name} endpoint={`/platform/staff/${resetFor.id}/reset-link`} onClose={() => setResetFor(null)} />}
      {removing && (
        <Confirm title={`Remove ${removing.name} from the team?`} confirmLabel="Remove"
          body={<>They lose access to the console{removing.homes ? ` and their ${removing.homes} homes are left without an installer` : ''}. Homes they belong to as a person are not affected.</>}
          onConfirm={async () => { await del(`/platform/staff/${removing.id}`); await reload(); }} onClose={() => setRemoving(null)} />
      )}
    </>
  );
}
