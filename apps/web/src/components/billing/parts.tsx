'use client';
import { Badge } from '@/components/ui';
import type { Invoice } from '@/lib/types';

export const rs = (n: number) => `Rs ${n.toLocaleString('en-PK')}`;
export const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const METHODS: Record<string, string> = { cash: 'Cash', bank: 'Bank transfer', jazzcash: 'JazzCash', easypaisa: 'Easypaisa', cheque: 'Cheque', other: 'Other' };

export function InvoiceStatus({ i }: { i: Invoice }) {
  if (i.status === 'PAID') return <Badge tone="ok">Paid</Badge>;
  if (i.status === 'VOID') return <Badge tone="mute">Cancelled</Badge>;
  return i.late ? <Badge tone="bad">Overdue</Badge> : <Badge tone="warn">Due</Badge>;
}

// The WhatsApp text for a bill is in lib/whatsapp.ts (MESSAGES.invoiceReminder), with every other message.
