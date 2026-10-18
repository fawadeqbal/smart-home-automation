'use client';
import { useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { Badge, ErrorBox, Modal, useAction } from '@/components/ui';
import { post } from '@/lib/api';
import { timeAgo, useLoad } from '@/lib/hooks';
import { useLive } from '@/lib/live';
import type { BoardNode, Replacements, SwapCandidate, SwapResult } from '@/lib/types';

/**
 * Replace a board: pick the new one (from stock, or one that just came online in this home), check the
 * pin plan (same pin numbers on the new board), confirm. Every device and wall button moves over with
 * its timers, scenes, rules and history; the old board goes to the faulty shelf, or back to stock.
 */
export function ReplaceBoardDialog({ node, onClose, onDone }: { node: BoardNode; onClose: () => void; onDone: (r: SwapResult) => void }) {
  const data = useLoad<Replacements>(`/nodes/${encodeURIComponent(node.id)}/replacements`);
  useLive('inventory.changed', () => void data.reload());
  const [pick, setPick] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [oldTo, setOldTo] = useState<'faulty' | 'stock'>('faulty');
  const [note, setNote] = useState('');
  const [done, setDone] = useState<SwapResult | null>(null);
  const { busy, error, run } = useAction();

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data.data?.candidates ?? []).filter((c) => !term || c.id.toLowerCase().includes(term));
  }, [data.data, q]);
  const chosen = data.data?.candidates.find((c) => c.id === pick) ?? null;

  async function confirm() {
    if (!chosen) return;
    const r = await run(() => post<SwapResult>(`/nodes/${encodeURIComponent(node.id)}/replace`, { newId: chosen.id, oldTo, ...(note.trim() ? { note: note.trim() } : {}) }));
    if (r) { setDone(r); onDone(r); }
  }

  if (done) {
    return (
      <Modal title="Board replaced" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
        <div className="dialog-body stack" style={{ gap: 10 }}>
          <div className="ok-note"><b className="mono">{done.newId}</b> now runs {node.name}: {done.devices} device{done.devices === 1 ? '' : 's'} and {done.inputs} wall button{done.inputs === 1 ? '' : 's'}, with their timers, scenes and rules.</div>
          <span className="small">The old board <span className="mono">{done.oldId}</span> is {done.oldStatus === 'STOCK' ? 'back in stock' : 'on the faulty shelf'} in the inventory.</span>
          {done.warnings.map((w) => <div key={w} className="notice small">{w}</div>)}
          <span className="small muted">Wire it the same way: every wire goes on the same pin of the new board.</span>
        </div>
      </Modal>
    );
  }

  return (
    <Modal wide title={`Replace ${node.name}`} sub={`Board ${node.id} · its devices and wall buttons move to the new board, on the same pins`} onClose={onClose} className="form-dialog"
      footer={(
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!chosen || chosen.problems.length > 0 || busy} onClick={() => void confirm()}>
            {busy ? 'Replacing…' : chosen ? `Replace with ${chosen.id}` : 'Pick the new board'}
          </button>
        </>
      )}>
      <div className="dialog-body stack" style={{ gap: 14 }}>
        {!data.data ? (data.error ? <div className="alert">{data.error}</div> : <Loader label="Finding boards…" />) : (
          <>
            <div className="stack-tight">
              <span className="form-step">1 · The new board</span>
              <span className="small muted">Power it and connect it to the home’s Wi‑Fi first: it shows here as online. Boards in stock and boards assigned to this home are listed.</span>
            </div>
            {data.data.candidates.length > 6 && (
              <label className="input-icon" style={{ width: 'min(320px, 100%)' }}>
                <Icon name="search" size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Board ID" aria-label="Find a board" />
              </label>
            )}
            {list.length === 0 ? (
              <div className="empty small">No board in stock{q ? ' with that ID' : ''}. Ask the office to add the new board to stock by its ID, then it appears here.</div>
            ) : (
              <div className="swap-list" role="radiogroup" aria-label="New board">
                {list.map((c) => <Candidate key={c.id} c={c} picked={pick === c.id} onPick={() => setPick(c.id)} />)}
              </div>
            )}

            {chosen && (
              <>
                <div className="stack-tight">
                  <span className="form-step">2 · Pin plan</span>
                  <span className="small muted">Move each wire to the same pin on the new board.</span>
                </div>
                <PinPlan c={chosen} />
                {chosen.problems.length > 0 && <div className="alert" role="alert">This board can’t take over: {chosen.problems.join(' ')}</div>}
                {chosen.warnings.map((w) => <div key={w} className="notice small">{w}</div>)}

                <div className="stack-tight">
                  <span className="form-step">3 · The old board</span>
                </div>
                <div className="seg seg-wide" role="group" aria-label="The old board">
                  <button type="button" className={oldTo === 'faulty' ? 'on' : ''} onClick={() => setOldTo('faulty')}>It’s broken: faulty shelf</button>
                  <button type="button" className={oldTo === 'stock' ? 'on' : ''} onClick={() => setOldTo('stock')}>It was fine: back to stock</button>
                </div>
                {oldTo === 'faulty' && (
                  <label className="field">What’s wrong with it? (optional)<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={node.note && node.note !== 'Marked faulty' ? node.note : 'Dead after a power surge'} /></label>
                )}
              </>
            )}
            <ErrorBox error={error} />
          </>
        )}
      </div>
    </Modal>
  );
}

function Candidate({ c, picked, onPick }: { c: SwapCandidate; picked: boolean; onPick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={picked} className={`swap-item ${picked ? 'picked' : ''}`} onClick={onPick}>
      <span className={`sdot ${c.online ? 'ok' : 'mute'}`} />
      <span className="grow stack-tight" style={{ textAlign: 'left' }}>
        <b className="mono">{c.id}</b>
        <span className="small muted">{c.boardName} · {c.online ? 'online now' : c.lastSeenAt ? `seen ${timeAgo(c.lastSeenAt)}` : 'never connected'}{c.firmware ? ` · firmware ${c.firmware}` : ''}</span>
      </span>
      {c.status === 'ASSIGNED' && <Badge tone="info">For this home</Badge>}
      {c.problems.length > 0 ? <Badge tone="bad">Pins don’t fit</Badge> : picked ? <Icon name="check" size={16} /> : null}
    </button>
  );
}

function PinPlan({ c }: { c: SwapCandidate }) {
  if (!c.plan.length) return <div className="small muted">Nothing is wired to the old board: the new one just takes its place.</div>;
  return (
    <div className="table-wrap flush">
      <table className="table">
        <thead><tr><th>Wire</th><th>Old board</th><th /><th>New board</th></tr></thead>
        <tbody>
          {c.plan.map((r) => (
            <tr key={`${r.gpio}-${r.name}`}>
              <td><span className="stack-tight"><b>{r.name}</b><span className="cell-sub">{r.what}</span></span></td>
              <td className="mono">{r.from}</td>
              <td aria-hidden><Icon name="arrow-right" size={14} /></td>
              <td className="mono">{r.problem ? <span className="text-bad">{r.problem}</span> : <span className="text-ok">{r.to}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
