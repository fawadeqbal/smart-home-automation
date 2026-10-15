'use client';
import { useState } from 'react';
import { Loader } from '@/components/Loader';
import { Avatar, Empty, Seg } from '@/components/ui';
import { useLoad } from '@/lib/hooks';
import type { AuditRow } from '@/lib/types';

type Cat = 'all' | 'setup' | 'access' | 'devices' | 'system' | 'billing';

/** The audit log: who changed what, and where. `source` is '/home/activity' or '/platform/audit?…'. */
export function ActivityView({ source, showHome, billing = false }: { source: string; showHome: boolean; billing?: boolean }) {
  const [cat, setCat] = useState<Cat>('all');
  const sep = source.includes('?') ? '&' : '?';
  const { data, error } = useLoad<AuditRow[]>(`${source}${sep}category=${cat}&limit=200`);
  return (
    <div className="stack" style={{ gap: 12 }} data-screen-label="Audit log">
      <div style={{ alignSelf: 'flex-start' }}>
        <Seg<Cat> value={cat} onChange={setCat} options={[
          { id: 'all', label: 'All' }, { id: 'setup', label: 'Setup' }, { id: 'access', label: 'Access' },
          { id: 'devices', label: 'Devices' }, { id: 'system', label: 'System' }, ...(billing ? [{ id: 'billing' as Cat, label: 'Billing' }] : []),
        ]} />
      </div>
      {!data ? (error ? <div className="alert">{error}</div> : <Loader label="Loading activity…" />) : data.length === 0 ? (
        <Empty>Nothing recorded {cat === 'all' ? 'yet' : 'in this group'}.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table" style={{ minWidth: showHome ? 760 : 620 }}>
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>What</th>{showHome && <th>Home</th>}</tr></thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id}>
                  <td className="muted nowrap" style={{ fontSize: 12.5 }} title={new Date(a.at).toLocaleString()}>{a.when}</td>
                  <td>
                    <div className="cell-main">
                      <Avatar name={a.who} role={a.system ? 'system' : a.role} size="xs" />
                      <span className="stack-tight"><b className="nowrap">{a.who}</b><span className="cell-sub" style={{ fontSize: 11.5 }}>{a.role}</span></span>
                    </div>
                  </td>
                  <td className="mono nowrap" style={{ color: 'var(--act)', fontSize: 12 }}>{a.action}</td>
                  <td>{a.target}</td>
                  {showHome && <td className="muted nowrap">{a.homeName}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
