'use client';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { get } from '@/lib/api';
import { useAssistant } from '@/lib/assistant';
import { useSession } from '@/lib/session';
import type { Device } from '@/lib/types';
import { Icon } from '../Icon';
import { Spinner } from '../Loader';

/** Things to say, made from this person's own devices. */
function useSuggestions(enabled: boolean) {
  const [devices, setDevices] = useState<Device[] | null>(null);
  useEffect(() => {
    if (enabled && !devices) void get<Device[]>('/devices').then(setDevices).catch(() => setDevices([]));
  }, [enabled, devices]);
  return useMemo(() => {
    const list: string[] = [];
    const usable = (devices ?? []).filter((d) => d.online && d.access !== 'VIEW');
    const on = usable.find((d) => d.controllable && d.state?.on);
    const off = usable.find((d) => d.controllable && !d.state?.on);
    const climate = (devices ?? []).find((d) => d.type === 'dht');
    const door = (devices ?? []).find((d) => d.type === 'contact');
    if (on) list.push(`Turn off the ${on.name.toLowerCase()}`);
    if (off) list.push(`Turn on the ${off.name.toLowerCase()}`);
    if (climate) list.push(`What’s the temperature${climate.roomName ? ` in the ${climate.roomName.toLowerCase()}` : ''}?`);
    if (door) list.push(`Is the ${door.name.toLowerCase()} open?`);
    if (off) list.push(`Turn on the ${off.name.toLowerCase()} in 30 minutes`);
    list.push('What’s on right now?');
    return list.slice(0, 4);
  }, [devices]);
}

function Waveform({ level }: { level: number }) {
  // a gentle moving shape scaled by how loud the voice is
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf = 0;
    const tick = () => { setT(performance.now() / 1000); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="ai-wave" aria-hidden>
      {Array.from({ length: 28 }, (_, i) => {
        const wobble = (Math.sin(t * 6 + i * 0.7) + 1) / 2;
        const h = 4 + (6 + 22 * wobble) * Math.max(0.12, level);
        return <i key={i} style={{ height: `${Math.min(30, h)}px` }} />;
      })}
    </div>
  );
}

function RecordingTimer() {
  const [s, setS] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setS(Math.floor((Date.now() - start) / 1000)), 250);
    return () => clearInterval(id);
  }, []);
  return <span className="mono">0:{String(s).padStart(2, '0')}</span>;
}

/** The round button that opens the assistant, on every page of the home app. */
export function AssistantLauncher() {
  const { open, setOpen, phase, handsFree } = useAssistant();
  if (open || handsFree.stage !== 'idle') return null;     // the voice overlay is showing
  const ears = handsFree.enabled && handsFree.status === 'ready';
  return (
    <button className={`ai-fab ${phase !== 'idle' ? 'busy' : ''}`} onClick={() => setOpen(true)} aria-label="Open the assistant"
      title={ears ? `Listening for “${handsFree.phrase}”` : 'Assistant'}>
      <Icon name="sparkles" size={20} />
      <span className="ai-fab-label">Ask</span>
      {ears && <span className="ai-ears" aria-hidden />}
    </button>
  );
}

const HF_TEXT: Record<string, string> = {
  loading: 'Getting ready…',
  'needs-tap': 'Tap anywhere to start listening',
  denied: 'Microphone blocked: allow it in the browser’s site settings',
  unsupported: 'This browser can’t listen hands-free (needs https and a recent browser)',
  error: 'Hands-free stopped working. Turn it off and on again.',
};

/** The "Hey Switchboard" switch, with what it is doing right now. */
export function HandsFreeSwitch() {
  const { handsFree: hf, toggleHandsFree } = useAssistant();
  if (!hf.supported) return null;
  const note = hf.enabled ? (hf.status === 'ready' ? `Say “${hf.phrase}” any time` : HF_TEXT[hf.status]) : 'Talk without touching the screen';
  return (
    <div className={`hf-switch ${hf.enabled && hf.status === 'ready' ? 'on' : ''}`}>
      <span className="hf-ear"><Icon name="mic" size={15} /></span>
      <div className="grow stack-tight">
        <b>“{hf.phrase}”</b>
        <span className="small muted">{note}</span>
      </div>
      <button type="button" role="switch" aria-checked={hf.enabled} aria-label={`Hands-free: ${hf.phrase}`}
        className={`hf-toggle ${hf.enabled ? 'on' : ''}`} onClick={toggleHandsFree}><i /></button>
    </div>
  );
}

const STAGE_TEXT = { listening: 'Listening…', hearing: 'Listening…', thinking: 'Working on it…', speaking: '' } as const;

/** Siri-style: what hands-free is doing, over whatever page is open. */
export function VoiceOverlay() {
  const a = useAssistant();
  const stage = a.handsFree.stage;
  if (stage === 'idle' || a.open) return null;
  const lastMe = [...a.lines].reverse().find((l) => l.who === 'me');
  const lastBot = [...a.lines].reverse().find((l) => l.who === 'bot');
  const asked = stage === 'thinking' || stage === 'speaking' ? lastMe?.text : null;
  return (
    <div className={`voice-card ${stage}`} role="status" aria-live="polite">
      <div className="voice-orb" style={{ ['--lv' as string]: stage === 'hearing' || stage === 'listening' ? a.level : 0.15 }}>
        <span /><span /><span />
      </div>
      <div className="voice-text grow">
        {asked && <p className="voice-asked">“{asked}”</p>}
        <p className="voice-main">{stage === 'speaking' ? lastBot?.text : STAGE_TEXT[stage]}</p>
        {a.error && stage !== 'speaking' && <p className="voice-err">{a.error}</p>}
      </div>
      <button className="icon-btn" onClick={a.dismissVoice} aria-label="Stop"><Icon name="x" size={16} /></button>
    </div>
  );
}

/** The assistant: a side panel on a computer, a sheet from the bottom on a phone. */
export function AssistantDrawer() {
  const a = useAssistant();
  const { me } = useSession();
  const [text, setText] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const suggestions = useSuggestions(a.open && a.lines.length === 0);

  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' }); }, [a.lines, a.phase]);
  useEffect(() => {
    if (!a.open) return;
    if (a.phase === 'idle') setTimeout(() => input.current?.focus(), 60);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (a.phase === 'recording') a.cancelRecording(); else a.setOpen(false); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [a.open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!a.open) return null;
  const hfStage = a.handsFree.stage;
  const status = a.phase === 'recording' || hfStage === 'listening' || hfStage === 'hearing' ? 'Listening…'
    : a.phase === 'thinking' ? 'Thinking…' : a.speaking ? 'Speaking…'
    : a.handsFree.enabled && a.handsFree.status === 'ready' ? `Say “${a.handsFree.phrase}” · English and Urdu` : 'Ready · speaks English and Urdu';

  function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!text.trim()) return;
    a.send(text);
    setText('');
  }

  return (
    <>
      <div className="ai-backdrop" onClick={() => a.setOpen(false)} />
      <aside className="ai-drawer" role="dialog" aria-label="Assistant">
        <header className="ai-head">
          <span className={`ai-orb ${a.phase !== 'idle' || a.speaking ? 'live' : ''}`}><Icon name="sparkles" size={17} /></span>
          <div className="grow stack-tight">
            <b>Assistant</b>
            <span className={`ai-status ${a.phase}`}>{status}</span>
          </div>
          {a.lines.length > 0 && (
            <button className="icon-btn" onClick={a.reset} title="New conversation" aria-label="New conversation"><Icon name="rotate" size={16} /></button>
          )}
          <button className="icon-btn" onClick={() => a.setOpen(false)} aria-label="Close the assistant"><Icon name="x" size={17} /></button>
        </header>

        <div className="ai-log" ref={log} aria-live="polite">
          {a.lines.length === 0 && a.phase === 'recording' && (
            <div className="ai-hello">
              <span className="ai-orb lg live"><Icon name="mic" size={24} /></span>
              <h2>I’m listening…</h2>
              <p>Say something like “turn on the kitchen light”. Tap send when you’re done.</p>
            </div>
          )}
          {a.lines.length === 0 && a.phase === 'idle' && (
            <div className="ai-hello">
              <span className="ai-orb lg"><Icon name="sparkles" size={24} /></span>
              <h2>Hi {me.name.split(' ')[0]}, what should I do?</h2>
              <p>Switch lights and fans, check a room’s temperature, or set a timer — by voice or by typing.</p>
              <div className="ai-suggest">
                {suggestions.map((s) => (
                  <button key={s} className="ai-chip" onClick={() => a.send(s)}><Icon name="sparkles" size={13} />{s}</button>
                ))}
              </div>
            </div>
          )}
          {a.lines.map((l) => (
            <div key={l.id} className={`ai-msg ${l.who}`}>
              {l.who === 'bot' && <span className="ai-orb sm"><Icon name="sparkles" size={12} /></span>}
              <div className="ai-bubble">
                {l.text}
                {l.who === 'bot' && l.audio && (
                  <button className="ai-replay" onClick={() => a.play(l.audio)} aria-label="Play this reply" title="Play this reply"><Icon name="volume-2" size={14} /></button>
                )}
              </div>
            </div>
          ))}
          {a.phase === 'thinking' && (
            <div className="ai-msg bot">
              <span className="ai-orb sm live"><Icon name="sparkles" size={12} /></span>
              <div className="ai-bubble typing" aria-label="Assistant is thinking"><i /><i /><i /></div>
            </div>
          )}
          {a.notice && <div className="ai-note">{a.notice}</div>}
          {a.error && <div className="alert">{a.error}</div>}
        </div>

        <footer className="ai-foot">
          {a.phase === 'recording' ? (
            <div className="ai-listening">
              <button className="icon-btn" onClick={a.cancelRecording} aria-label="Cancel" title="Cancel"><Icon name="x" size={17} /></button>
              <div className="grow stack-tight" style={{ alignItems: 'center' }}>
                <Waveform level={a.level} />
                <span className="small muted">Listening · <RecordingTimer /> · tap to send</span>
              </div>
              <button className="ai-mic recording" onClick={a.stopRecording} aria-label="Send what I said"><Icon name="send" size={19} /></button>
            </div>
          ) : (
            <form className="ai-compose" onSubmit={submit}>
              <textarea
                ref={input} rows={1} value={text} disabled={a.phase !== 'idle'}
                placeholder={a.phase === 'thinking' ? 'Thinking…' : 'Type a message…'}
                aria-label="Message to the assistant"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
              />
              {text.trim() ? (
                <button className="ai-mic" disabled={a.phase !== 'idle'} aria-label="Send"><Icon name="arrow-up" size={19} /></button>
              ) : (
                <button type="button" className="ai-mic" onClick={() => void a.startRecording()} disabled={!a.micOk || a.phase !== 'idle'}
                  aria-label="Tap to talk" title={a.micOk ? 'Tap to talk' : 'Voice needs https:// or http://localhost. Typing works everywhere.'}>
                  {a.phase === 'thinking' ? <Spinner size={18} /> : <Icon name="mic" size={19} />}
                </button>
              )}
            </form>
          )}
          <HandsFreeSwitch />
          <p className="ai-hint">{a.micOk ? 'Press Enter to send · the assistant can only do what you may do' : 'Voice works on https:// or http://localhost — typing works everywhere.'}</p>
        </footer>
      </aside>
    </>
  );
}

/** The entry on the Home screen: type or talk straight away; the conversation opens beside it. */
export function AskBar() {
  const a = useAssistant();
  const last = [...a.lines].reverse().find((l) => l.who === 'bot');
  return (
    <div className="ask-wrap">
      <div className="ask">
        <button className="ask-open" onClick={() => a.setOpen(true)}>
          <span className="sparkle"><Icon name="sparkles" size={17} /></span>
          <span className="grow truncate">{last ? last.text : 'Ask: “turn off the bedroom fan”'}</span>
          {last && <span className="small muted nowrap">Continue</span>}
        </button>
        <button className="mic" onClick={() => void a.startRecording()} disabled={!a.micOk || a.phase !== 'idle'} aria-label="Tap to talk"
          title={a.micOk ? 'Tap to talk' : 'Voice needs https:// or http://localhost'}>
          {a.phase === 'thinking' ? <Spinner size={18} /> : <Icon name="mic" size={19} />}
        </button>
      </div>
    </div>
  );
}
