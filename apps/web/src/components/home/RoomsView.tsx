'use client';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { Confirm, Dropdown, ErrorBox, FormModal, useAction } from '@/components/ui';
import { del, patch, post } from '@/lib/api';
import { useDevices, useLoad } from '@/lib/hooks';
import { useLive } from '@/lib/live';
import { ROOM_ICON } from '@/lib/roles';
import type { Room } from '@/lib/types';

/** Rooms of the home as tiles; owners, admins and installers add, rename and remove them, and place devices. */
export function RoomsView({ canEdit }: { canEdit: boolean }) {
  const rooms = useLoad<Room[]>('/rooms');
  const { devices, reload: reloadDevices } = useDevices();
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<Room | null>(null);
  const [removing, setRemoving] = useState<Room | null>(null);
  const { error, run } = useAction();
  useLive('devices.changed', () => void rooms.reload());

  if (!rooms.data || !devices) return rooms.error ? <div className="alert">{rooms.error}</div> : <Loader label="Loading rooms…" />;
  const loose = devices.filter((d) => !d.roomId);

  return (
    <div className="stack">
      <ErrorBox error={error} />
      <div className="room-grid">
        {rooms.data.map((r) => {
          const ds = devices.filter((d) => d.roomId === r.id);
          const on = ds.filter((d) => d.controllable && d.online && d.state?.on).length;
          const offline = ds.some((d) => !d.online);
          const boards = [...new Set(ds.map((d) => d.nodeId))];
          return (
            <div key={r.id} className="room-tile">
              <div className="spread" style={{ alignItems: 'flex-start' }}>
                <span className="ri"><Icon name={ROOM_ICON(r.name)} size={19} /></span>
                {canEdit && (
                  <Dropdown align="right" width={180} trigger={(_o, t) => <button className="icon-btn" onClick={t} aria-label={`More for ${r.name}`}><Icon name="more" size={16} /></button>}>
                    {(close) => (
                      <>
                        <button className="menu-item" onClick={() => { close(); setRenaming(r); }}><Icon name="pencil" size={15} />Rename</button>
                        <button className="menu-item danger" onClick={() => { close(); setRemoving(r); }}><Icon name="trash" size={15} />Delete room</button>
                      </>
                    )}
                  </Dropdown>
                )}
              </div>
              <b>{r.name}</b>
              <span className="small muted">{ds.length} device{ds.length === 1 ? '' : 's'}{offline ? ' · offline' : ` · ${on} on`}</span>
              <span className="foot mono small muted">{boards.join(', ') || 'No board yet'}</span>
            </div>
          );
        })}
        {canEdit && (
          <button className="room-tile add" onClick={() => setAdding(true)}>
            <span className="ri" style={{ marginBottom: 0 }}><Icon name="plus" size={19} /></span><b style={{ fontSize: 14 }}>Add a room</b>
          </button>
        )}
      </div>

      {canEdit && loose.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h2>Devices without a room</h2><span className="muted">Only owners and admins see these until they are placed</span></div>
          {loose.map((d) => (
            <div className="li" key={d.id}>
              <span className="li-icon"><Icon name={d.controllable ? 'lightbulb' : 'thermometer'} size={15} /></span>
              <div className="li-text"><b>{d.name}</b><span className="sub mono">{d.nodeId} · {d.pinLabel}</span></div>
              <select className="inline-select" defaultValue="" aria-label={`Room for ${d.name}`}
                onChange={(e) => e.target.value && void run(() => patch(`/devices/${d.id}`, { roomId: e.target.value })).then(() => reloadDevices())}>
                <option value="">Choose a room…</option>
                {rooms.data!.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
          ))}
        </section>
      )}

      {adding && (
        <FormModal title="Add a room" submitLabel="Add room" onClose={() => setAdding(false)}
          onSubmit={async (f) => { await post('/rooms', { name: f.get('name'), order: rooms.data!.length }); await rooms.reload(); }}>
          <label className="field">Name<input name="name" required maxLength={60} placeholder="Kids room" /></label>
        </FormModal>
      )}
      {renaming && (
        <FormModal title="Rename room" submitLabel="Save" onClose={() => setRenaming(null)}
          onSubmit={async (f) => { await patch(`/rooms/${renaming.id}`, { name: f.get('name') }); await rooms.reload(); void reloadDevices(); }}>
          <label className="field">Name<input name="name" required maxLength={60} defaultValue={renaming.name} /></label>
        </FormModal>
      )}
      {removing && (
        <Confirm title={`Delete ${removing.name}?`} confirmLabel="Delete room"
          body="Its devices are kept, without a room — only owners and admins see them until you place them again. People lose the access they had to this room."
          onConfirm={async () => { await del(`/rooms/${removing.id}`); await rooms.reload(); void reloadDevices(); }} onClose={() => setRemoving(null)} />
      )}
    </div>
  );
}
