'use client';
import { Fragment, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useCrumbs } from '@/components/Shell';
import { PageHead } from '@/components/ui';
import { useLoad } from '@/lib/hooks';
import { MATRIX, ROLE_BLURB, ROLE_COLUMNS, STAFF_BLURB } from '@/lib/roles';
import { useSession } from '@/lib/session';
import type { Role, StaffRole } from '@/lib/types';

/** What each role may do — the same rules the API enforces. */
export default function RolesPage() {
  const { staffRole } = useSession();
  const counts = useLoad<Record<string, number>>('/platform/roles');
  const [col, setCol] = useState<string>(staffRole ?? 'SUPERADMIN');
  useCrumbs([{ label: 'Platform', href: '/console' }, { label: 'Roles & permissions' }]);
  const current = ROLE_COLUMNS.find((c) => c.key === col)!;
  const blurb = current.scope === 'Platform' ? STAFF_BLURB[col as StaffRole] : ROLE_BLURB[col as Role];

  return (
    <div data-screen-label="Roles and permissions">
      <PageHead title="Roles & permissions"
        sub="Platform staff work across your homes. Home roles live inside one home. Pick a column to highlight what that role can do."
        actions={
          <div className="legend" style={{ flexWrap: 'wrap' }}>
            <span><span className="mx full" style={{ width: 20, height: 20, margin: 0 }}><Icon name="check" size={12} stroke={2.5} /></span>Full</span>
            <span><span className="mx read" style={{ width: 20, height: 20, margin: 0 }}><Icon name="eye" size={12} /></span>Read-only</span>
            <span><span className="mx-scope">Scope</span>Limited</span>
            <span><span style={{ width: 20, textAlign: 'center' }}>—</span>None</span>
          </div>
        }
      />
      <div className="notice mb16"><b>{current.label}</b> · {current.scope.toLowerCase()} role — {blurb}.</div>
      <div className="table-wrap">
        <table className="table matrix" style={{ minWidth: 980 }}>
          <thead>
            <tr>
              <th style={{ minWidth: 240, verticalAlign: 'bottom' }}>Capability</th>
              {ROLE_COLUMNS.map((c) => (
                <th key={c.key} className={`col ${col === c.key ? 'active' : ''}`}>
                  <button onClick={() => setCol(c.key)} aria-pressed={col === c.key}>
                    <span style={{ fontSize: 10 }}>{c.scope}</span>
                    <b>{c.label}</b>
                    <span className="n">{counts.data ? `${counts.data[c.key] ?? 0} people` : '…'}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MATRIX.map((g) => (
              <Fragment key={g.group}>
                <tr><td colSpan={8} className="group">{g.group}</td></tr>
                {g.rows.map(([label, cells]) => (
                  <tr key={label}>
                    <td style={{ fontWeight: 500 }}>{label}</td>
                    {cells.map((c, i) => (
                      <td key={i} className={`c ${ROLE_COLUMNS[i]!.key === col ? 'active' : ''}`}>
                        {c.t === 'full' && <span className="mx full"><Icon name="check" size={13} stroke={2.5} /></span>}
                        {c.t === 'read' && <span className="mx read"><Icon name="eye" size={13} /></span>}
                        {c.t === 'scope' && <span className="mx-scope">{c.label}</span>}
                        {c.t === 'none' && <span className="mx-none">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
