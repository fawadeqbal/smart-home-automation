'use client';
import { Icon } from '@/components/Icon';
import { Photos, SignOff, Signed } from '@/components/installation/InstallationView';
import { Loader } from '@/components/Loader';
import { useCrumbs } from '@/components/Shell';
import { Badge, Empty, PageHead } from '@/components/ui';
import { useCallback, useEffect, useState } from 'react';
import { errorText, get, post } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { InstallReport } from '@/lib/types';

/** The home's copy of its installation report; the owner signs it here if they didn't on the installer's phone. */
export default function InstallationPage() {
  const { me, home } = useSession();
  useCrumbs([{ label: home?.name ?? 'Home', href: '/' }, { label: 'Installation' }]);
  const [state, setState] = useState<{ d: InstallReport | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => get<InstallReport | null>('/home/installation').then((d) => setState({ d })).catch((e) => setError(errorText(e))), []);
  useEffect(() => { void load(); }, [load]);
  if (!state) return error ? <div className="alert">{error}</div> : <Loader />;
  const d = state.d;
  return (
    <div className="stack install-report" style={{ maxWidth: 820 }}>
      <PageHead title="Installation" sub="What your installer did and checked, with photos — and your sign-off."
                actions={d && <button className="btn" onClick={() => window.print()}><Icon name="file-text" size={15} />Print</button>} />
      {!d ? <Empty>Your installer hasn’t started the installation report yet.</Empty> : (
        <>
          <div className="row" style={{ gap: 8 }}>
            {d.signed ? <Badge tone="ok">Signed off</Badge> : <Badge tone="warn">Waiting for your signature</Badge>}
            <span className="small muted">{d.installer ? `By ${d.installer} · ` : ''}{d.done} of {d.total} checked</span>
          </div>
          <section className="card card-pad stack">
            <h3 style={{ margin: 0 }}>What was checked</h3>
            {d.items.map((i) => (
              <div key={i.key} className="check-item done">
                <Icon name={i.done ? 'check' : 'x'} size={16} />
                <span className="stack-tight"><span>{i.label}</span>{i.note && <span className="small muted">{i.note}</span>}</span>
              </div>
            ))}
            {d.notes && <p style={{ margin: 0 }}><b>Notes:</b> {d.notes}</p>}
          </section>
          <section className="card card-pad stack"><h3 style={{ margin: 0 }}>Photos</h3><Photos r={d} /></section>
          <section className="card card-pad stack">
            <h3 style={{ margin: 0 }}>Sign-off</h3>
            {d.signed ? <Signed r={d} />
              : d.canSign && d.done === d.total ? <SignOff defaultName={me.name} onSign={async (name, signature) => { await post('/home/installation/sign', { name, signature }); await load(); }} />
              : <p className="small muted">{d.done < d.total ? 'Your installer is still finishing the checklist.' : 'The home’s owner signs here.'}</p>}
          </section>
        </>
      )}
    </div>
  );
}
