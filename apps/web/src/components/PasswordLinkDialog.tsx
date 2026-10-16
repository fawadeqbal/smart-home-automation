'use client';
import { useState } from 'react';
import { post } from '@/lib/api';
import { Icon } from './Icon';
import { CopyField, ErrorBox, inviteUrl, Modal, useAction, WhatsAppShare } from './ui';

/**
 * Makes a link for someone to choose a new password (they forgot it and can't get the email), to send
 * them by WhatsApp. `endpoint`: /users/<id>/reset-link (a home) or /platform/staff/<id>/reset-link (a company).
 */
export function PasswordLinkDialog({ name, endpoint, onClose }: { name: string; endpoint: string; onClose: () => void }) {
  const [link, setLink] = useState<{ path: string; expiresInHours: number } | null>(null);
  const { busy, error, run } = useAction();
  const first = name.split(' ')[0];
  const make = async () => {
    const r = await run(() => post<{ path: string; expiresInHours: number }>(endpoint));
    if (r) setLink(r);
  };
  const url = link ? inviteUrl(link.path) : '';
  return (
    <Modal title={`Password link for ${name}`} onClose={onClose}
      footer={link
        ? <button className="btn btn-primary" onClick={onClose}>Done</button>
        : <><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={() => void make()}>{busy ? 'Making…' : 'Make the link'}</button></>}>
      <div className="dialog-body">
        {!link ? (
          <>
            <p style={{ margin: 0, lineHeight: 1.5 }}>
              For when {first} forgot their password and can’t get the email. The link lets them choose a new one,
              works <b>once</b> for <b>24 hours</b>, and signs them out on their other devices.
            </p>
            <p className="small muted" style={{ margin: 0 }}>Send it only to {first}: anyone with the link can set the password. It’s recorded in the activity log.</p>
            <ErrorBox error={error} />
          </>
        ) : (
          <div className="stack">
            <div className="ok-note"><Icon name="check" size={15} /> Link ready. Send it to {first} (valid {link.expiresInHours} hours, works once):</div>
            <CopyField value={url} />
            <WhatsAppShare text={`Hi ${first}, here is your link to choose a new Switchboard password (works once, for ${link.expiresInHours} hours): ${url}`} />
          </div>
        )}
      </div>
    </Modal>
  );
}
