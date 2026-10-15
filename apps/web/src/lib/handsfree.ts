/**
 * "Hey Switchboard": the microphone stays open, the wake word is recognised on this device (a Web Worker
 * running openWakeWord), and only the request said after it is sent to the server.
 *
 *   wake  ->  (wake word heard)  ->  capture  ->  (the person stops talking)  ->  utterance (WAV)
 *
 * The engine itself is in /public/voice (engine.mjs, worker.mjs, capture-worklet.js) so the same code runs
 * in the browser and in the Node tests.
 */

export type HandsFreeStatus = 'off' | 'loading' | 'ready' | 'needs-tap' | 'denied' | 'unsupported' | 'error';

export interface HandsFreeEvents {
  onStatus: (s: HandsFreeStatus, detail?: string) => void;
  onWake: () => void;
  onSpeech: () => void;
  onUtterance: (wav: Blob) => void;
  onNothing: () => void;
  onLevel: (v: number) => void;
}

const BASE = '/voice/';

export function handsFreeSupported() {
  return typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia
    && typeof AudioWorkletNode !== 'undefined' && typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined';
}

export class HandsFree {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private worker: Worker | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private playing: AudioBufferSourceNode | null = null;
  phrase = 'Hey Switchboard';

  constructor(private readonly on: HandsFreeEvents) {}

  get running() {
    return !!this.worker;
  }

  /** Call from a click (browsers only start sound and the microphone after one). */
  async start() {
    if (this.worker) return;
    if (!handsFreeSupported()) {
      this.on.onStatus('unsupported');
      return;
    }
    this.on.onStatus('loading');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (err) {
      this.on.onStatus((err as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'error', String(err));
      return;
    }
    try {
      this.ctx = new AudioContext();
      await this.ctx.audioWorklet.addModule(`${BASE}capture-worklet.js`);
      this.worker = new Worker(`${BASE}worker.mjs`, { type: 'module' });
      const ready = new Promise<void>((resolve, reject) => {
        this.worker!.onmessage = (e: MessageEvent) => {
          const m = e.data;
          if (m.type === 'ready') { this.phrase = m.phrase || this.phrase; resolve(); }
          else if (m.type === 'error') reject(new Error(m.message));
        };
      });
      this.worker.postMessage({ type: 'init', base: BASE });
      await ready;
      this.worker.onmessage = (e: MessageEvent) => this.message(e.data);
      this.source = this.ctx.createMediaStreamSource(this.stream);
      this.node = new AudioWorkletNode(this.ctx, 'capture-16k');
      this.node.port.onmessage = (e: MessageEvent<Float32Array>) => this.worker?.postMessage({ type: 'audio', samples: e.data }, [e.data.buffer]);
      this.source.connect(this.node);
      // keep the graph pulling audio without making a sound
      const mute = this.ctx.createGain();
      mute.gain.value = 0;
      this.node.connect(mute).connect(this.ctx.destination);
      this.listenForWake();
      this.on.onStatus(this.ctx.state === 'running' ? 'ready' : 'needs-tap');
    } catch (err) {
      this.stop();
      this.on.onStatus('error', String(err));
    }
  }

  /** After a page load the browser keeps sound paused until the first tap. */
  async resume() {
    if (this.ctx && this.ctx.state !== 'running') {
      await this.ctx.resume().catch(() => undefined);
      if ((this.ctx.state as AudioContextState) === 'running') this.on.onStatus('ready');
    }
  }

  get suspended() {
    return !!this.ctx && this.ctx.state !== 'running';
  }

  stop() {
    this.stopSpeaking();
    this.worker?.terminate();
    this.worker = null;
    this.node?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => undefined);
    this.ctx = this.stream = this.node = this.source = null;
    this.on.onStatus('off');
  }

  listenForWake() {
    this.worker?.postMessage({ type: 'wake' });
  }

  /** Record one request; `preRollMs` keeps what was said right after the wake word. */
  capture(startTimeoutMs = 5000, preRollMs = 0) {
    this.worker?.postMessage({ type: 'capture', startTimeoutMs, preRollMs });
  }

  idle() {
    this.worker?.postMessage({ type: 'idle' });
  }

  /** Short tones: up = listening, down = gave up. Played through the same (already allowed) audio context. */
  chime(kind: 'listen' | 'done' | 'cancel') {
    const ctx = this.ctx;
    if (!ctx) return;
    const notes = kind === 'listen' ? [660, 990] : kind === 'done' ? [880] : [520, 390];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const t = ctx.currentTime + i * 0.09;
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.18);
    });
  }

  /** Speak a reply (base64 WAV). Resolves when it has finished or was interrupted. */
  speak(base64: string): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return Promise.resolve();
    this.stopSpeaking();
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    return ctx.decodeAudioData(bytes.buffer).then((buffer) => new Promise<void>((resolve) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.onended = () => { if (this.playing === src) this.playing = null; resolve(); };
      this.playing = src;
      src.start();
    })).catch(() => undefined);
  }

  get speaking() {
    return !!this.playing;
  }

  stopSpeaking() {
    try { this.playing?.stop(); } catch { /* already ended */ }
    this.playing = null;
  }

  private message(m: { type: string; wav?: Uint8Array; value?: number; message?: string }) {
    if (m.type === 'wake') this.on.onWake();
    else if (m.type === 'speech') this.on.onSpeech();
    else if (m.type === 'utterance' && m.wav) this.on.onUtterance(new Blob([m.wav as BlobPart], { type: 'audio/wav' }));
    else if (m.type === 'nothing') this.on.onNothing();
    else if (m.type === 'level') this.on.onLevel(m.value ?? 0);
    else if (m.type === 'error') this.on.onStatus('error', m.message);
  }
}
