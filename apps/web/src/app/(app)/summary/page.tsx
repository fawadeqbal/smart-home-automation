'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { useCrumbs } from '@/components/Shell';
import { ErrorBox, PageHead, Seg, useAction, WhatsAppShare } from '@/components/ui';
import { post } from '@/lib/api';
import { useLoad } from '@/lib/hooks';
import { useSession } from '@/lib/session';

interface Summary { home: string; period: 'day' | 'week'; range: string; lines: string[]; text: string; mail: boolean }

const ICONS: Record<string, string> = { Power: 'zap', Internet: 'wifi-off', Electricity: 'lightbulb', Automations: 'clock', Alerts: 'bell', Boards: 'cpu' };

function SummaryView() {
  const params = useSearchParams();
  const { home } = useSession();
  useCrumbs([{ label: home?.name ?? 'Home', href: '/' }, { label: 'Summary' }]);
  const [period, setPeriod] = useState<'day' | 'week'>(params.get('period') === 'day' ? 'day' : 'week');
  const s = useLoad<Summary>(`/home/summary?period=${period}`);
  const { busy, error, run } = useAction();
  const [sent, setSent] = useState<string | null>(null);
  const email = async () => {
    const r = await run(() => post<{ to: string }>(`/home/summary/email?period=${period}`));
    if (r) setSent(r.to);
  };
  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <PageHead title="Summary" sub="How the home did, in a few lines — to read here or send to the family."
                actions={<Seg options={[{ id: 'day', label: 'Today' }, { id: 'week', label: 'This week' }]} value={period} onChange={(v) => { setPeriod(v); setSent(null); }} />} />
      {!s.data ? (s.error ? <div className="alert">{s.error}</div> : <Loader />) : (
        <section className="card card-pad stack">
          <div className="spread"><b>{s.data.home}</b><span className="small muted">{s.data.range}</span></div>
          <div className="summary-lines">
            {s.data.lines.map((l) => {
              const [head, ...rest] = l.split(': ');
              return (
                <div key={l} className="summary-line">
                  <span className="summary-ic"><Icon name={ICONS[head!] ?? 'activity'} size={15} /></span>
                  <span><b>{head}</b>{rest.length ? `: ${rest.join(': ')}` : ''}</span>
                </div>
              );
            })}
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <WhatsAppShare text={s.data.text} />
            {s.data.mail && <button className="btn" disabled={busy} onClick={() => void email()}><Icon name="mail" size={14} />Email it to me</button>}
          </div>
          {sent && <div className="ok-note"><Icon name="check" size={15} /> Sent to {sent}.</div>}
          <ErrorBox error={error} />
          <p className="small muted" style={{ margin: 0 }}>Owners and admins get the week’s summary every Sunday evening. Turn the daily one on in Notifications.</p>
        </section>
      )}
    </div>
  );
}

export default function SummaryPage() {
  return <Suspense fallback={<Loader />}><SummaryView /></Suspense>;
}
