'use client';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useAction } from '@/components/ui';
import { del, put } from '@/lib/api';
import { useLoad } from '@/lib/hooks';
import { useLive } from '@/lib/live';
import type { PresenceRuleState } from '@/lib/types';

type Rule = NonNullable<PresenceRuleState['rule']>;
const BLANK: Pick<Rule, 'switchOff' | 'offDevices' | 'awayMode' | 'notify' | 'arriveSceneId'> = {
  switchOff: 'lights', offDevices: [], awayMode: true, notify: true, arriveSceneId: null,
};

/**
 * Automations page (owners and admins): "When the last person leaves: switch off …, away mode, tell me;
 * when the first person comes home: run a scene." Only people who share when they're home count.
 */
export function LastOneOut() {
  const state = useLoad<PresenceRuleState>('/presence/rule');
  const { busy, error, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(BLANK);
  useLive('schedules.changed', () => void state.reload());
  useLive('presence.changed', () => void state.reload());
  const s = state.data;
  const rule = s?.rule ?? null;
  useEffect(() => { if (rule && !editing) setDraft({ switchOff: rule.switchOff, offDevices: rule.offDevices, awayMode: rule.awayMode, notify: rule.notify, arriveSceneId: rule.arriveSceneId }); }, [rule, editing]);
  if (!s) return null;

  const names = new Map(s.devices.map((d) => [d.id, d.name]));
  const what = (r: typeof draft) => [
    r.switchOff === 'lights' ? 'switch off the lights and fans' : r.switchOff === 'chosen' ? `switch off ${r.offDevices.map((id) => names.get(id) ?? 'a removed device').join(', ')}` : '',
    r.awayMode ? 'turn on away mode' : '', r.notify ? 'tell me' : '',
  ].filter(Boolean).join(', ') || 'nothing';
  const arrive = (r: typeof draft) => (r.arriveSceneId ? s.scenes.find((x) => x.id === r.arriveSceneId)?.name ?? 'a removed scene' : null);
  const save = () => run(async () => { await put('/presence/rule', { ...draft, enabled: true }); await state.reload(); setEditing(false); });
  const toggle = (enabled: boolean) => run(async () => { await put('/presence/rule', { enabled }); await state.reload(); });
  const remove = () => confirm('Stop doing anything when everyone leaves?') && run(async () => { await del('/presence/rule'); await state.reload(); });

  return (
    <section className="section">
      <div className="section-head spread">
        <h2>When everyone leaves <span className="muted small">and when someone comes home</span></h2>
        {!rule && !editing && <button className="btn btn-small" onClick={() => setEditing(true)}><Icon name="plus" size={14} />Set up</button>}
      </div>
      {error && <div className="alert">{error}</div>}
      {s.sharers === 0 && (
        <div className="empty">Nobody shares when they’re home yet. Each person turns on “Share when I’m home” in the phone app (Me). Only they count: this runs when all of them are out.</div>
      )}
      {rule && !editing && (
        <div className={`sched-item ${rule.enabled ? '' : 'done'}`}>
          <span className="sched-icon rule"><Icon name="users" size={18} /></span>
          <div className="sched-main">
            <b className="wrap">When the last person leaves: {what(rule)}.</b>
            {arrive(rule) && <span className="muted small">When the first person comes home: run {arrive(rule)}{rule.awayMode ? ' (and away mode goes off)' : ''}.</span>}
            <span className="small muted">
              {rule.lastEventAt ? `${rule.lastEvent === 'left' ? 'Everyone left' : 'Someone came home'} ${new Date(rule.lastEventAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}: ${rule.lastResult ?? ''}` : 'Hasn’t run yet'}
              {rule.createdBy ? ` · with ${rule.createdBy}’s rights` : ''}
            </span>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={() => setEditing(true)}>Change</button>
          <label className="switch-input" title={rule.enabled ? 'Pause' : 'Resume'}>
            <input type="checkbox" checked={rule.enabled} disabled={busy} onChange={(e) => void toggle(e.target.checked)} />
            <span />
          </label>
          <button className="icon-btn" aria-label="Remove" onClick={() => void remove()}><Icon name="trash" size={15} /></button>
        </div>
      )}
      {editing && (
        <div className="card stack" style={{ padding: 16, gap: 12 }}>
          <b>When the last person leaves</b>
          <div className="radio-cards">
            {([['lights', 'Lights and fans off', 'Everything called a light, bulb, fan… (not the fridge or router)'], ['chosen', 'Chosen devices off', 'Pick exactly what goes off'], ['none', 'Switch nothing', 'Only away mode or a message']] as const).map(([v, label, blurb]) => (
              <label key={v} className={`radio-card ${draft.switchOff === v ? 'on' : ''}`}>
                <input type="radio" name="switchOff" checked={draft.switchOff === v} onChange={() => setDraft({ ...draft, switchOff: v })} />
                <b>{label}</b><span>{blurb}</span>
              </label>
            ))}
          </div>
          {draft.switchOff === 'chosen' && (
            <div className="light-chips">
              {s.devices.map((d) => {
                const on = draft.offDevices.includes(d.id);
                return (
                  <button key={d.id} type="button" className={on ? 'on' : ''} aria-pressed={on}
                    onClick={() => setDraft({ ...draft, offDevices: on ? draft.offDevices.filter((x) => x !== d.id) : [...draft.offDevices, d.id] })}>
                    {d.name}{d.room ? ` · ${d.room}` : ''}
                  </button>
                );
              })}
            </div>
          )}
          {draft.switchOff === 'lights' && (
            <span className="small muted">Now that’s: {s.devices.filter((d) => d.lightOrFan).map((d) => d.name).join(', ') || 'nothing yet (name them “… light” or “… fan”)'}.</span>
          )}
          <label className="check"><input type="checkbox" checked={draft.awayMode} onChange={(e) => setDraft({ ...draft, awayMode: e.target.checked })} /> Turn on away mode (doors and motion alert at any hour)</label>
          <label className="check"><input type="checkbox" checked={draft.notify} onChange={(e) => setDraft({ ...draft, notify: e.target.checked })} /> Tell me</label>
          <label className="field">When the first person comes home, run <span className="hint">optional</span>
            <select value={draft.arriveSceneId ?? ''} onChange={(e) => setDraft({ ...draft, arriveSceneId: e.target.value || null })}>
              <option value="">Nothing</option>
              {s.scenes.map((sc) => <option key={sc.id} value={sc.id}>{sc.name}</option>)}
            </select>
          </label>
          <span className="small muted">It waits until everyone who shares is out (someone not heard from counts after 20 minutes), and switches only what you may switch.</span>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>Save</button>
            <button className="btn" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
