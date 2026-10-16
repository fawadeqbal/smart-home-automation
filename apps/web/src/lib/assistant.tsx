'use client';
/**
 * The voice assistant and chat, shared by the whole home app: the conversation stays while you move
 * between pages. It is this person's own conversation in this home: the first message of an empty chat
 * is sent as "fresh", so the assistant remembers exactly what is on the screen and nothing from another
 * home or an earlier visit. Voice: tap to talk, tap again to send (stops by itself after 15 s). Replies are
 * shown and spoken.
 */
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { errorText, post } from './api';
import { HandsFree, HandsFreeStatus, wakeWordAvailable } from './handsfree';

export interface Line {
  id: number;
  who: 'me' | 'bot';
  text: string;
  audio?: string | null;
  at: number;
}
interface Reply {
  heard?: string;
  reply: string;
  audio?: string | null;
}
export type Phase = 'idle' | 'recording' | 'thinking';
/** Where a hands-free exchange is: shown by the voice overlay. */
export type VoiceStage = 'idle' | 'listening' | 'hearing' | 'thinking' | 'speaking';

interface AssistantCtx {
  open: boolean;
  setOpen: (v: boolean) => void;
  lines: Line[];
  phase: Phase;
  error: string | null;
  notice: string | null;
  micOk: boolean;
  /** 0..1 loudness while recording (for the waveform). */
  level: number;
  speaking: boolean;
  send: (text: string) => void;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  cancelRecording: () => void;
  play: (audio?: string | null) => void;
  reset: () => void;
  /** "Hey Switchboard": wake word on this device. */
  handsFree: { supported: boolean; enabled: boolean; status: HandsFreeStatus; phrase: string; stage: VoiceStage; detail?: string };
  toggleHandsFree: () => void;
  /** Stop the current hands-free exchange (the overlay's close button). */
  dismissVoice: () => void;
  /** The console assistant (staff, about all the homes they look after) rather than a home's. */
  console: boolean;
  /** Replies read aloud (on by default; the speaker button in the assistant turns it off on this device). */
  voice: boolean;
  toggleVoice: () => void;
}

const Ctx = createContext<AssistantCtx | null>(null);
const MAX_RECORDING_MS = 15_000;
const HANDS_FREE_KEY = 'sb_hands_free';
const readFlag = () => { try { return localStorage.getItem(HANDS_FREE_KEY) === '1'; } catch { return false; } };
const writeFlag = (on: boolean) => { try { localStorage.setItem(HANDS_FREE_KEY, on ? '1' : '0'); } catch { /* private mode */ } };
const VOICE_KEY = 'sb_voice_replies';
const readVoice = () => { try { return localStorage.getItem(VOICE_KEY) !== '0'; } catch { return true; } };
const writeVoice = (on: boolean) => { try { localStorage.setItem(VOICE_KEY, on ? '1' : '0'); } catch { /* private mode */ } };
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';

export function AssistantProvider({ children, homeId, console = false }: { children: ReactNode; homeId: string | null; console?: boolean }) {
  // the console has its own staff-only routes; the API decides what each role may hear about
  const baseRef = useRef('/assistant');
  baseRef.current = console ? '/assistant/console' : '/assistant';
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [micOk, setMicOk] = useState(true);
  const [level, setLevel] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [voice, setVoice] = useState(true);
  const voiceRef = useRef(true);
  useEffect(() => { voiceRef.current = readVoice(); setVoice(voiceRef.current); }, []);
  const player = useRef<HTMLAudioElement | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const cancelled = useRef(false);
  const stopTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const meter = useRef<{ ctx: AudioContext; raf: number } | null>(null);
  const nextId = useRef(1);
  const hf = useRef<HandsFree | null>(null);
  const [hfEnabled, setHfEnabled] = useState(false);
  const [hfStatus, setHfStatus] = useState<HandsFreeStatus>('off');
  const [hfDetail, setHfDetail] = useState<string | undefined>();
  const [hfPhrase, setHfPhrase] = useState('Hey Switchboard');
  const [stage, setStage] = useState<VoiceStage>('idle');
  const [hfSupported, setHfSupported] = useState(false);
  useEffect(() => {
    void wakeWordAvailable().then((ok) => {
      setHfSupported(!!ok);
      if (ok) setHfPhrase(ok.phrase);
    });
  }, []);
  const stageRef = useRef<VoiceStage>('idle');
  const go = (s: VoiceStage) => { stageRef.current = s; setStage(s); };
  /** The chat on screen is empty: the next message starts a new conversation on the assistant too. */
  const fresh = useRef(true);

  useEffect(() => {
    // browsers allow the microphone only on https:// or http://localhost
    setMicOk(window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined');
  }, []);

  // a new home is a new conversation
  useEffect(() => { setLines([]); setError(null); setNotice(null); fresh.current = true; }, [homeId]);

  /** Read once per request: true only for the first message of an empty chat. */
  const takeFresh = () => {
    const was = fresh.current;
    fresh.current = false;
    return was;
  };

  const add = useCallback((l: Omit<Line, 'id' | 'at'>) => setLines((list) => [...list, { ...l, id: nextId.current++, at: Date.now() }]), []);

  /** One player, created during a click: browsers only allow sound that a click started. */
  const unlockSound = useCallback(() => {
    if (!player.current) {
      player.current = new Audio();
      player.current.onplay = () => setSpeaking(true);
      player.current.onended = () => setSpeaking(false);
      player.current.onpause = () => setSpeaking(false);
    }
    const p = player.current;
    if (p.paused && !p.src) {
      p.src = SILENT_WAV;
      void p.play().catch(() => undefined);
    }
  }, []);

  const play = useCallback((audio?: string | null) => {
    setNotice(null);
    if (!audio) return;
    unlockSound();
    const p = player.current!;
    p.src = `data:audio/wav;base64,${audio}`;
    p.play().catch(() => setNotice('The browser blocked the sound. Tap the speaker next to the reply to hear it.'));
  }, [unlockSound]);

  const request = useCallback(async (fn: () => Promise<Reply>, shown?: string, quiet = false): Promise<Reply | null> => {
    setPhase('thinking');
    setError(null);
    if (shown) add({ who: 'me', text: shown });
    try {
      const reply = await fn();
      if (reply.heard && !shown) add({ who: 'me', text: reply.heard });
      add({ who: 'bot', text: reply.reply, audio: reply.audio });
      if (!quiet && voiceRef.current) play(reply.audio);
      return reply;
    } catch (err) {
      setError(errorText(err));
      return null;
    } finally {
      setPhase('idle');
    }
  }, [add, play]);

  const send = useCallback((text: string) => {
    const value = text.trim();
    if (!value || phase !== 'idle') return;
    unlockSound();
    const isFresh = takeFresh();
    void request(() => post<Reply>(`${baseRef.current}/chat`, { text: value, speak: voiceRef.current, fresh: isFresh }), value);
  }, [phase, request, unlockSound]);

  const stopMeter = () => {
    if (!meter.current) return;
    cancelAnimationFrame(meter.current.raf);
    void meter.current.ctx.close().catch(() => undefined);
    meter.current = null;
    setLevel(0);
  };

  const stopRecording = useCallback(() => {
    clearTimeout(stopTimer.current);
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }, []);

  const cancelRecording = useCallback(() => {
    cancelled.current = true;
    stopRecording();
  }, [stopRecording]);

  const startRecording = useCallback(async () => {
    if (phase !== 'idle') return;
    setError(null);
    setOpen(true);
    unlockSound();
    player.current?.pause();
    hf.current?.idle();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      // loudness for the waveform
      try {
        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        let last = 0;
        const tick = (t: number) => {
          analyser.getByteTimeDomainData(data);
          if (t - last > 60) {
            let sum = 0;
            for (const v of data) sum += ((v - 128) / 128) ** 2;
            setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
            last = t;
          }
          meter.current!.raf = requestAnimationFrame(tick);
        };
        meter.current = { ctx, raf: requestAnimationFrame(tick) };
      } catch { /* the waveform is decoration */ }
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream);
      cancelled.current = false;
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        stopMeter();
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        hf.current?.listenForWake();
        if (cancelled.current || blob.size < 1000) {
          setPhase('idle');
          return;
        }
        const form = new FormData();
        form.append('audio', blob, 'speech');
        form.append('fresh', String(takeFresh()));
        void request(() => post<Reply>(`${baseRef.current}/voice`, form));
      };
      recorder.current = rec;
      rec.start();
      setPhase('recording');
      stopTimer.current = setTimeout(stopRecording, MAX_RECORDING_MS);
    } catch {
      setError('Microphone not available. Allow microphone access in the browser, or type instead.');
    }
  }, [phase, request, stopRecording, unlockSound]);

  // ---------------------------------------------------------------- hands-free ("Hey Switchboard")
  const afterWake = useRef(false);
  const handleUtterance = useCallback(async (wav: Blob) => {
    const engine = hf.current;
    if (!engine) return;
    go('thinking');
    const form = new FormData();
    form.append('audio', wav, 'speech.wav');
    form.append('fresh', String(takeFresh()));
    form.append('afterWake', String(afterWake.current));
    const reply = await request(() => post<Reply>(`${baseRef.current}/voice`, form), undefined, true);
    if (!hf.current) return;
    if (!reply) {
      engine.chime('cancel');
      go('idle');
      engine.listenForWake();
      return;
    }
    // while it answers, "Hey Switchboard" interrupts it
    engine.listenForWake();
    if (reply.audio && voiceRef.current) {
      go('speaking');
      setSpeaking(true);
      await engine.speak(reply.audio);
      setSpeaking(false);
    } else {
      go('speaking');   // voice off: the answer shows on screen only
    }
    if (stageRef.current !== 'speaking' && stageRef.current !== 'thinking') return;   // interrupted by a new wake word
    if (/[?؟]\s*$/.test(reply.reply)) {
      // it asked something ("which light?"): listen for the answer without the wake word
      engine.chime('listen');
      go('listening');
      afterWake.current = false;
      engine.capture(6000);
    } else {
      // leave the answer on screen a moment, like Siri, unless something new has started
      setTimeout(() => { if (stageRef.current === 'speaking') go('idle'); }, voiceRef.current ? 2500 : 7000);   // longer to read
    }
  }, [request]); // eslint-disable-line react-hooks/exhaustive-deps

  const engineFor = useCallback(() => {
    if (hf.current) return hf.current;
    hf.current = new HandsFree({
      onStatus: (s, detail) => { setHfStatus(s); setHfDetail(detail); },
      onWake: () => {
        const engine = hf.current;
        if (!engine) return;
        engine.stopSpeaking();
        player.current?.pause();
        setSpeaking(false);
        engine.chime('listen');
        go('listening');
        afterWake.current = true;
        engine.capture(5000, 160);
      },
      onSpeech: () => go('hearing'),
      onUtterance: (wav) => void handleUtterance(wav),
      onNothing: () => {
        hf.current?.chime('cancel');
        go('idle');
        hf.current?.listenForWake();
      },
      onLevel: (v) => setLevel(v),
    });
    return hf.current;
  }, [handleUtterance]);

  const startHandsFree = useCallback(async () => {
    const engine = engineFor();
    await engine.start();
    setHfPhrase(engine.phrase);
  }, [engineFor]);

  const toggleHandsFree = useCallback(() => {
    if (hfEnabled) {
      hf.current?.stop();
      hf.current = null;
      setHfEnabled(false);
      writeFlag(false);
      go('idle');
      return;
    }
    unlockSound();
    setHfEnabled(true);
    writeFlag(true);
    void startHandsFree();
  }, [hfEnabled, startHandsFree, unlockSound]);

  const dismissVoice = useCallback(() => {
    const engine = hf.current;
    engine?.stopSpeaking();
    setSpeaking(false);
    go('idle');
    engine?.listenForWake();
  }, []);

  // turned on last time: start again; the browser may need one tap first
  useEffect(() => {
    if (!readFlag()) return;
    let gone = false;
    const wake = () => { void hf.current?.resume(); };
    void wakeWordAvailable().then((ok) => {
      if (!ok || gone) return;
      setHfEnabled(true);
      void startHandsFree();
      window.addEventListener('pointerdown', wake);
      window.addEventListener('keydown', wake);
    });
    return () => {
      gone = true;
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
      hf.current?.stop();
      hf.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleVoice = useCallback(() => {
    const on = !voiceRef.current;
    voiceRef.current = on;
    setVoice(on);
    writeVoice(on);
    if (!on) { player.current?.pause(); setSpeaking(false); }
  }, []);

  const reset = useCallback(() => {
    setLines([]);
    fresh.current = true;
    setError(null);
    setNotice(null);
    player.current?.pause();
    void post(`${baseRef.current}/reset`).catch(() => undefined);
  }, []);

  return (
    <Ctx.Provider value={{
      open, setOpen, lines, phase, error, notice, micOk, level, speaking, send, startRecording, stopRecording, cancelRecording, play, reset,
      handsFree: { supported: hfSupported, enabled: hfEnabled, status: hfStatus, phrase: hfPhrase, stage, detail: hfDetail },
      toggleHandsFree, dismissVoice, console, voice, toggleVoice,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAssistant() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAssistant outside AssistantProvider');
  return ctx;
}
