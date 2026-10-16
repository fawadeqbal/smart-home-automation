import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';
import { SETTINGS, Settings } from '../config';

export interface Mail {
  to: string;
  subject: string;
  /** plain sentences; each blank line starts a new paragraph */
  text: string;
  /** the one thing to press, e.g. { label: 'Choose a new password', url } */
  button?: { label: string; url: string };
}

/**
 * Email (password links, alerts, summaries) through an SMTP account, e.g. Gmail with an app password
 * (SMTP_USER + SMTP_PASS in .env). Without them, email is off: nothing is sent, and screens that
 * depend on it say so (password links can still be made by an owner or super admin).
 */
@Injectable()
export class MailService {
  private readonly log = new Logger('Mail');
  private readonly transport: Transporter | null;

  constructor(@Inject(SETTINGS) private readonly settings: Settings) {
    const s = settings.smtp;
    this.transport = s ? nodemailer.createTransport({
      host: s.host, port: s.port, secure: s.port === 465, auth: { user: s.user, pass: s.pass },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    }) : null;
    if (!s) this.log.log('Email is off (set SMTP_USER and SMTP_PASS to send password links and alerts).');
  }

  get enabled() {
    return !!this.transport;
  }

  /** Sends one email. Never throws: a mail problem must not break the request that caused it. */
  async send(mail: Mail): Promise<boolean> {
    if (!this.transport) return false;
    try {
      await this.transport.sendMail({
        from: this.settings.smtp!.from, to: mail.to, subject: mail.subject,
        text: mail.text + (mail.button ? `\n\n${mail.button.label}: ${mail.button.url}` : '') + '\n\n— Switchboard',
        html: html(mail),
      });
      return true;
    } catch (err) {
      this.log.warn(`Could not send "${mail.subject}" to ${mail.to}: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function html(mail: Mail) {
  const paras = mail.text.split(/\n\s*\n/).map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  const button = mail.button
    ? `<p style="margin:22px 0"><a href="${esc(mail.button.url)}" style="background:#2852eb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;display:inline-block">${esc(mail.button.label)}</a></p>
       <p style="margin:0 0 14px;color:#6b7280;font-size:13px">Or open this link: <a href="${esc(mail.button.url)}" style="color:#2852eb;word-break:break-all">${esc(mail.button.url)}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
<div style="max-width:520px;margin:0 auto;padding:28px 16px">
<div style="font-weight:700;font-size:17px;margin-bottom:18px">Switchboard</div>
<div style="background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:24px 22px;font-size:15px;line-height:1.55">${paras}${button}</div>
<p style="color:#9ca3af;font-size:12px;margin-top:16px">You get this email because of your Switchboard account.</p>
</div></body></html>`;
}
