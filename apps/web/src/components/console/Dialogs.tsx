'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { get, patch, post } from '@/lib/api';
import { ACCESS_LABEL, ROLE_BLURB, ROLE_LABEL, STAFF_BLURB, STAFF_LABEL } from '@/lib/roles';
import type { Access, Inventory, Role, Room, StaffList, StaffRole, Workspace } from '@/lib/types';
import { CopyField, FormModal, inviteUrl } from '../ui';
import { AccessLimitsFields, limitsBody, LimitsState, NO_LIMITS } from '../home/AccessLimits';

const ZONES = ['Asia/Karachi', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Riyadh', 'Asia/Dhaka', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney', 'UTC'];

function useInstallers() {
  const [list, setList] = useState<{ id: string; name: string; staffRole: StaffRole }[]>([]);
  useEffect(() => {
    void get<StaffList>('/platform/staff')
      .then((s) => setList(s.people.filter((p) => !p.disabled && (p.staffRole === 'INSTALLER' || p.staffRole === 'SUPERADMIN')).map((p) => ({ id: p.id, name: p.name, staffRole: p.staffRole }))))
      .catch(() => undefined);
  }, []);
  return list;
}

/** Super admin: a new customer home, optionally with its installer, rooms and owner invite. */
export function NewHomeDialog({ onClose, onCreated, defaults }: { onClose: () => void; onCreated?: (id: string) => void; defaults?: { name?: string; city?: string } }) {
  const installers = useInstallers();
  const [created, setCreated] = useState<{ id: string; name: string; invite: { path: string } | null } | null>(null);
  return (
    <FormModal
      title="New home" sub="A customer’s home. Boards come from inventory; the installer sets them up on site." submitLabel="Create home" wide onClose={onClose}
      onSubmit={async (f) => {
        const ownerEmail = String(f.get('ownerEmail') ?? '').trim();
        const res = await post<{ id: string; name: string; invite: { path: string } | null }>('/platform/homes', {
          name: f.get('name'), city: f.get('city'), timezone: f.get('timezone'),
          installerId: f.get('installerId') || null,
          rooms: String(f.get('rooms') ?? '').split(',').map((r) => r.trim()).filter(Boolean),
          owner: ownerEmail ? { email: ownerEmail, name: String(f.get('ownerName') ?? '') || undefined } : null,
        });
        setCreated(res);
        onCreated?.(res.id);
      }}
      done={created && (
        <div className="stack">
          <div className="ok-note"><b>{created.name}</b> is ready. Next: assign boards from inventory.</div>
          {created.invite && (
            <label className="field">Owner invite link (valid 7 days) — send it to the owner
              <CopyField value={inviteUrl(created.invite.path)} />
            </label>
          )}
          <div className="row">
            <Link className="btn btn-primary" href={`/console/homes/${created.id}`} onClick={onClose}>Open workspace</Link>
            <Link className="btn" href={`/console/inventory?home=${created.id}`} onClick={onClose}>Assign boards</Link>
          </div>
        </div>
      )}
    >
      <div className="form-grid">
        <label className="field">Home name<input name="name" required maxLength={80} placeholder="Sharma residence" defaultValue={defaults?.name} /></label>
        <label className="field">City<input name="city" maxLength={80} placeholder="Lahore" defaultValue={defaults?.city} /></label>
        <label className="field">Time zone
          <select name="timezone" defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Karachi'}>
            {[...new Set([Intl.DateTimeFormat().resolvedOptions().timeZone, ...ZONES].filter(Boolean))].map((z) => <option key={z}>{z}</option>)}
          </select>
        </label>
        <label className="field">Installer
          <select name="installerId" defaultValue="">
            <option value="">Not yet</option>
            {installers.map((i) => <option key={i.id} value={i.id}>{i.name}{i.staffRole === 'SUPERADMIN' ? ' (super admin)' : ''}</option>)}
          </select>
        </label>
      </div>
      <label className="field">Rooms <span className="hint">Comma separated. You can change them later.</span>
        <input name="rooms" defaultValue="Living room, Kitchen, Bedroom" maxLength={600} />
      </label>
      <div className="form-grid">
        <label className="field">Owner’s name <span className="hint">optional</span><input name="ownerName" maxLength={80} placeholder="Priya Sharma" /></label>
        <label className="field">Owner’s email <span className="hint">we create an invite link</span><input name="ownerEmail" type="email" placeholder="priya@example.com" /></label>
      </div>
    </FormModal>
  );
}

/** Super admin: edit a home, change its installer, archive it. */
export function EditHomeDialog({ ws, onClose, onSaved }: { ws: Workspace; onClose: () => void; onSaved: () => void }) {
  const installers = useInstallers();
  return (
    <FormModal title="Edit home" submitLabel="Save" onClose={onClose}
      onSubmit={async (f) => {
        await patch(`/platform/homes/${ws.home.id}`, {
          name: f.get('name'), city: f.get('city'), timezone: f.get('timezone'), installerId: f.get('installerId') || null,
          ...(f.get('archived') === 'on' ? { archived: true } : ws.home.archived ? { archived: false } : {}),
        });
        onSaved();
      }}>
      <div className="form-grid">
        <label className="field">Home name<input name="name" required maxLength={80} defaultValue={ws.home.name} /></label>
        <label className="field">City<input name="city" maxLength={80} defaultValue={ws.home.city} /></label>
        <label className="field">Time zone
          <select name="timezone" defaultValue={ws.home.timezone}>{[...new Set([ws.home.timezone, ...ZONES])].map((z) => <option key={z}>{z}</option>)}</select>
        </label>
        <label className="field">Installer
          <select name="installerId" defaultValue={ws.home.installer?.id ?? ''}>
            <option value="">None</option>
            {installers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </label>
      </div>
      <label className="row small"><input type="checkbox" name="archived" defaultChecked={ws.home.archived} /> Archived — hidden from lists, people keep their accounts</label>
    </FormModal>
  );
}

/** Super admin: register boards by their IDs (printed on them / shown on their setup page). */
export function AddStockDialog({ inv, onClose, onDone }: { inv: Inventory; onClose: () => void; onDone: () => void }) {
  const [result, setResult] = useState<{ added: number; skipped: number } | null>(null);
  return (
    <FormModal title="Add boards to stock" sub="Type or scan each board’s ID — it is printed at start-up and is part of its Wi‑Fi name (HomeNode‑…)."
      submitLabel="Add to stock" onClose={onClose}
      onSubmit={async (f) => {
        const ids = String(f.get('ids') ?? '').split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
        setResult(await post<{ added: number; skipped: number }>('/platform/inventory', { ids, board: f.get('board'), note: String(f.get('note') ?? '') || undefined }));
        onDone();
      }}
      done={result && <div className="ok-note">{result.added} board{result.added === 1 ? '' : 's'} added to stock{result.skipped ? ` · ${result.skipped} already there` : ''}.</div>}>
      <label className="field">Board IDs <span className="hint">One per line, or separated by commas</span>
        <textarea name="ids" rows={5} required placeholder={'esp-3c71bf\nesp-3c71c0'} className="mono" />
      </label>
      <div className="form-grid">
        <label className="field">Model
          <select name="board" defaultValue={inv.models[0]?.type}>{inv.models.map((m) => <option key={m.type} value={m.type}>{m.name}</option>)}</select>
        </label>
        <label className="field">Note <span className="hint">optional</span><input name="note" maxLength={200} placeholder="Batch from supplier, 12 Oct" /></label>
      </div>
      <p className="small muted">A board that is already powered and online shows up here by itself once its ID is added.</p>
    </FormModal>
  );
}

/** Invite someone into the current home (owner/admin), with their room rights. */
export function InvitePersonDialog({ rooms, canAdmin, ownerInvite = false, timeZone = 'Asia/Karachi', onClose, onDone }: {
  rooms: Room[] | Workspace['rooms']; canAdmin: boolean; ownerInvite?: boolean; timeZone?: string; onClose: () => void; onDone: () => void;
}) {
  const [role, setRole] = useState<Role>(ownerInvite ? 'OWNER' : 'MEMBER');
  const [access, setAccess] = useState<Record<string, Access | ''>>({});
  const [link, setLink] = useState<{ path: string; existing: boolean; email: string; days: number; limits: string | null } | null>(null);
  const [limits, setLimits] = useState<LimitsState>(NO_LIMITS);
  const [limited, setLimited] = useState(false);
  const roles: Role[] = ownerInvite ? ['OWNER'] : canAdmin ? ['ADMIN', 'MEMBER', 'GUEST'] : ['MEMBER', 'GUEST'];
  const perRoom = role === 'MEMBER' || role === 'GUEST';
  return (
    <FormModal title={ownerInvite ? 'Send the owner invite' : 'Invite someone'} wide
      sub={ownerInvite ? 'The owner gets everything in the home and invites the family. Wiring stays with the installer.' : 'They get a link to choose a password. You decide what they may do in each room.'}
      submitLabel="Create invite link" onClose={onClose}
      onSubmit={async (f) => {
        const email = String(f.get('email'));
        const res = await post<{ path: string; existingAccount: boolean; expiresInDays: number; access: string | null }>('/invites', {
          email, name: String(f.get('name') ?? '') || undefined, role,
          rooms: perRoom ? Object.entries(access).filter(([, a]) => a).map(([roomId, a]) => ({ roomId, access: a })) : [],
          ...(perRoom && limited ? limitsBody(limits) : {}),
        });
        setLink({ path: res.path, existing: res.existingAccount, email, days: res.expiresInDays ?? 7, limits: res.access ?? null });
        onDone();
      }}
      done={link && (
        <div className="stack">
          <div className="ok-note">Invite ready for <b>{link.email}</b>{link.existing ? ' — they already have an account and just confirm with their password' : ''}. Send them this link (valid {link.days} day{link.days === 1 ? '' : 's'}):</div>
          {link.limits && <div className="small muted">Their access: {link.limits}.</div>}
          <CopyField value={inviteUrl(link.path)} />
        </div>
      )}>
      <div className="form-grid">
        <label className="field">Email<input name="email" type="email" required placeholder="name@example.com" /></label>
        <label className="field">Name <span className="hint">optional</span><input name="name" maxLength={80} /></label>
      </div>
      {roles.length > 1 && (
        <div className="radio-cards">
          {roles.map((r) => (
            <label key={r} className={`radio-card ${role === r ? 'on' : ''}`}>
              <input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} />
              <b>{ROLE_LABEL[r]}</b><span>{ROLE_BLURB[r]}</span>
            </label>
          ))}
        </div>
      )}
      {perRoom && rooms.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Room</th><th>Access</th></tr></thead>
            <tbody>
              {rooms.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>
                    <select className="inline-select" value={access[r.id] ?? ''} onChange={(e) => setAccess((a) => ({ ...a, [r.id]: e.target.value as Access | '' }))}>
                      <option value="">No access</option>
                      {(['VIEW', 'CONTROL', ...(role === 'MEMBER' ? ['MANAGE'] : [])] as Access[]).map((a) => <option key={a} value={a}>{ACCESS_LABEL[a]}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {perRoom && (
        <div className="stack" style={{ gap: 10 }}>
          <label className="check">
            <input type="checkbox" checked={limited} onChange={(e) => setLimited(e.target.checked)} />
            For a while, or at certain hours <span className="muted small">(a guest for the weekend, help 9:00–17:00)</span>
          </label>
          {limited && <AccessLimitsFields value={limits} onChange={setLimits} timeZone={timeZone} />}
        </div>
      )}
    </FormModal>
  );
}

/** Super admin: invite an installer, a support person or another super admin. */
export function InviteStaffDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [role, setRole] = useState<StaffRole>('INSTALLER');
  const [link, setLink] = useState<{ path: string; email: string } | null>(null);
  return (
    <FormModal title="Invite to your team" sub="Staff work across your homes. Installers only see the homes you assign to them." submitLabel="Create invite link" wide onClose={onClose}
      onSubmit={async (f) => {
        const email = String(f.get('email'));
        const res = await post<{ path: string }>('/platform/staff/invites', { email, name: String(f.get('name') ?? '') || undefined, staffRole: role });
        setLink({ path: res.path, email });
        onDone();
      }}
      done={link && (<div className="stack"><div className="ok-note">Invite ready for <b>{link.email}</b>. Send them this link (valid 7 days):</div><CopyField value={inviteUrl(link.path)} /></div>)}>
      <div className="form-grid">
        <label className="field">Email<input name="email" type="email" required placeholder="ravi@yourcompany.com" /></label>
        <label className="field">Name <span className="hint">optional</span><input name="name" maxLength={80} /></label>
      </div>
      <div className="radio-cards">
        {(['INSTALLER', 'SUPPORT', 'SUPERADMIN'] as StaffRole[]).map((r) => (
          <label key={r} className={`radio-card ${role === r ? 'on' : ''}`}>
            <input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} />
            <b>{STAFF_LABEL[r]}</b><span>{STAFF_BLURB[r]}</span>
          </label>
        ))}
      </div>
    </FormModal>
  );
}
