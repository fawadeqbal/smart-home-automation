/**
 * WhatsApp messages to customers, sent by share link (no WhatsApp API): every message the team sends
 * from the console is written here, so the wording is easy to change in one place. Keep them short,
 * polite and plain.
 *
 * The API gives a person's number as international digits ("923001234567", the `whatsapp` fields);
 * with one, the message opens in WhatsApp addressed to them, else the phone's share sheet or a copy.
 */

/** Rupees: "Rs 12,500". */
export const rs = (n: number) => `Rs ${n.toLocaleString('en-PK')}`;
/** A calendar day ("2026-10-20"): "20 Oct 2026". */
export const dayText = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
/** A visit's time, as the clock in Pakistan shows it: "Tue 20 Oct, 4:00 pm". */
export const visitTime = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Karachi' });

const first = (name?: string | null) => (name ?? '').trim().split(/\s+/)[0] || '';
const hi = (name?: string | null) => (first(name) ? `Assalam o Alaikum ${first(name)},` : 'Assalam o Alaikum,');
const site = () => (typeof window === 'undefined' ? '' : window.location.origin);

export interface PayDetails { bank: string | null; jazzcash: string | null; easypaisa: string | null }

/** "How to pay" lines from the company settings (nothing when none are set). */
export function payLines(pay?: PayDetails | null) {
  if (!pay) return [];
  return [
    pay.jazzcash && `JazzCash: ${pay.jazzcash}`,
    pay.easypaisa && `Easypaisa: ${pay.easypaisa}`,
    pay.bank && `Bank: ${pay.bank}`,
  ].filter(Boolean) as string[];
}

export const MESSAGES = {
  visitBooked: (v: { name: string; visitAt: string; company: string; installer?: string | null }) =>
    `${hi(v.name)}\nYour free home visit with ${v.company} is booked for *${visitTime(v.visitAt)}*.${v.installer ? ` ${first(v.installer)} will come to see your home.` : ''}\nIf this time doesn't suit you, just reply and we'll change it. Thank you!`,

  ticketUpdate: (t: { name?: string | null; number: number; title: string; company: string; status: string; reply?: string | null; homeId: string; id: string }) =>
    `${hi(t.name)}\nAn update on your request #${t.number} (${t.title}): *${t.status}*.${t.reply ? `\n\n"${t.reply.slice(0, 500)}"` : ''}\n\nYou can see it in the app: ${site()}/support/${t.id}?home=${t.homeId}\n— ${t.company}`,

  invoiceReminder: (i: { name?: string | null; number: number; description: string; amount: number; dueOn: string; late: boolean; paid?: boolean; company: string; pay?: PayDetails | null }) => {
    if (i.paid) return `${hi(i.name)}\nWe received ${rs(i.amount)} for invoice ${i.number} (${i.description}). Thank you!\n— ${i.company}`;
    const how = payLines(i.pay);
    return `${hi(i.name)}\nA ${i.late ? 'reminder' : 'note'} about invoice ${i.number} from ${i.company}: ${i.description}.\nAmount: *${rs(i.amount)}*\n${i.late ? 'It was due on' : 'Due by'}: ${dayText(i.dueOn)}${how.length ? `\n\nYou can pay by:\n${how.join('\n')}` : ''}\n\nIf you've already paid, please send us the receipt and we'll update it. Thank you!`;
  },

  renewalReminder: (c: { name?: string | null; plan: string; endsOn: string; daysLeft: number; amount: number; periodText: string; company: string }) =>
    c.daysLeft < 0
      ? `${hi(c.name)}\nYour ${c.plan} with ${c.company} ended on ${dayText(c.endsOn)}. We'd be happy to renew it so your home stays looked after (${rs(c.amount)} ${c.periodText}). Just reply and we'll arrange it.`
      : `${hi(c.name)}\nYour ${c.plan} with ${c.company} ends on *${dayText(c.endsOn)}*${c.daysLeft <= 1 ? '' : ` (in ${c.daysLeft} days)`}. Shall we renew it for you (${rs(c.amount)} ${c.periodText})? Just reply and we'll take care of it. Thank you!`,

  onMyWay: (installer?: string | null) =>
    `Assalam o Alaikum, this is ${first(installer) || 'your installer'}. I'm on my way to you now. See you soon!`,

  quote: (q:{ customerName: string; ref: string; total: number; path: string; company: string; validUntil?: string | null }) =>
    `${hi(q.customerName)}\nThank you for your time. Here is your quote ${q.ref} from ${q.company}: *${rs(q.total)}*.\nSee the details and accept it here: ${site()}${q.path}${q.validUntil ? `\n(Valid until ${dayText(q.validUntil)}.)` : ''}`,
};

/** The wa.me link: to that number when we know it, else WhatsApp asks who to send it to. */
export function waLink(text: string, whatsapp?: string | null) {
  const to = whatsapp && /^\d{8,15}$/.test(whatsapp) ? whatsapp : '';
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}

/**
 * Sends a message: WhatsApp to the person's number; without one, the phone's share sheet (pick
 * WhatsApp or anything else), and on a computer without it, a copy to paste. Says which happened.
 */
export async function shareMessage(text: string, whatsapp?: string | null): Promise<'whatsapp' | 'shared' | 'copied' | 'cancelled'> {
  if (whatsapp) {
    window.open(waLink(text, whatsapp), '_blank', 'noopener,noreferrer');
    return 'whatsapp';
  }
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return 'cancelled';
      // not allowed here (some desktop browsers): fall through to copying
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    window.open(waLink(text), '_blank', 'noopener,noreferrer');
    return 'whatsapp';
  }
}
