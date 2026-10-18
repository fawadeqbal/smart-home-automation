'use client';
import { FormEvent, useState } from 'react';
import { Icon } from '@/components/Icon';
import { ErrorBox, useAction } from '@/components/ui';
import { patch } from '@/lib/api';
import type { Workspace } from '@/lib/types';
import { QuotesPanel } from './QuoteEditor';
import './service.css';

/**
 * The home's customer in the console: the owner's mobile number (for WhatsApp messages; staff can
 * fill it in after a phone call) and the home's quotes.
 */
export function CustomerCard({ ws, canEdit, onChanged }: { ws: Workspace; canEdit: boolean; onChanged: () => void }) {
  const owner = ws.home.owner;
  const [editing, setEditing] = useState(false);
  const { busy, error, run } = useAction();
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const phone = String(new FormData(e.currentTarget).get('phone') ?? '').trim();
    if (await run(() => patch(`/platform/homes/${ws.home.id}/people/${owner!.id}/phone`, { phone: phone || null }))) { setEditing(false); onChanged(); }
  }
  return (
    <section className="panel">
      <div className="panel-head"><h2>Customer</h2></div>
      <div className="panel-pad stack" style={{ padding: '12px 16px' }}>
        {owner ? (
          editing ? (
            <form className="row" style={{ gap: 6, flexWrap: 'wrap' }} onSubmit={save}>
              <input name="phone" className="grow" inputMode="tel" maxLength={24} defaultValue={owner.phone ?? ''} placeholder="0300 1234567" aria-label={`${owner.name}'s mobile number`} autoFocus />
              <button className="btn btn-sm btn-primary" disabled={busy}>Save</button>
              <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>Cancel</button>
            </form>
          ) : (
            <div className="row" style={{ gap: 8 }}>
              <Icon name="phone" size={15} />
              <span className="grow">{owner.name} · {owner.phone ?? <span className="muted">no mobile number</span>}</span>
              {canEdit && <button className="link-btn small" onClick={() => setEditing(true)}>{owner.phone ? 'Change' : 'Add'}</button>}
            </div>
          )
        ) : <span className="small muted">The owner hasn’t joined yet. Their number for WhatsApp comes from their visit request until then.</span>}
        <ErrorBox error={error} />
        <QuotesPanel homeId={ws.home.id} compact />
      </div>
    </section>
  );
}
