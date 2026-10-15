/**
 * Hands-free voice engine, on the device: nothing leaves it until the wake word is heard.
 *
 *  WakeWord  — openWakeWord's streaming pipeline (a faithful port of openwakeword/utils.py AudioFeatures):
 *              16 kHz audio in 80 ms chunks -> melspectrogram.onnx -> embedding_model.onnx (Google's speech
 *              embedding) -> the wake-word classifier over the last 16 embeddings -> score 0..1.
 *  Vad       — Silero VAD (16 kHz, 512-sample windows): is someone speaking right now?
 *
 * Environment-agnostic: give it an `ort` (onnxruntime-web in the browser, onnxruntime-node in tests) and a
 * way to load model bytes. Audio is Float32 in -1..1 at 16 kHz.
 */

export const SAMPLE_RATE = 16000;
export const CHUNK = 1280; // 80 ms: one step of openWakeWord

const MEL_BINS = 32;
const EMB_WINDOW = 76; // mel frames per embedding
const EMB_STEP = 8; // mel frames per 80 ms chunk
const FEATURES = 16; // embeddings the classifier looks at (1.28 s)
const MEL_CONTEXT = 160 * 3; // extra samples before each chunk, as in openWakeWord

export class WakeWord {
  /** @param ort onnxruntime module  @param models {mel, embedding, wake} as ArrayBuffer/Uint8Array */
  static async create(ort, models, options = {}) {
    const opts = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
    const [mel, emb, wake] = await Promise.all([
      ort.InferenceSession.create(models.mel, opts),
      ort.InferenceSession.create(models.embedding, opts),
      ort.InferenceSession.create(models.wake, opts),
    ]);
    return new WakeWord(ort, mel, emb, wake, options);
  }

  constructor(ort, mel, emb, wake, { threshold = 0.5, patience = 1, cooldownMs = 2000 } = {}) {
    this.ort = ort;
    this.mel = mel;
    this.emb = emb;
    this.wake = wake;
    this.threshold = threshold;
    this.patience = patience; // chunks in a row above the threshold
    this.cooldownMs = cooldownMs;
    this.reset();
  }

  /** Forget everything heard so far (after a detection, or when listening starts again). */
  reset() {
    this.raw = new Float32Array(0); // int16-scale samples not yet turned into features
    this.tail = new Float32Array(MEL_CONTEXT); // the samples before the next chunk
    this.melFrames = Array.from({ length: EMB_WINDOW }, () => new Float32Array(MEL_BINS).fill(1));
    this.features = [];
    this.hits = 0;
    this.lastScore = 0;
    this.coolUntil = 0;
  }

  /**
   * Feed audio (any length). Returns {score, detected} for the last 80 ms step, or null when no full step yet.
   * @param {Float32Array} audio -1..1 at 16 kHz
   */
  async push(audio, now = Date.now()) {
    const scaled = new Float32Array(audio.length);
    for (let i = 0; i < audio.length; i++) scaled[i] = Math.max(-32768, Math.min(32767, Math.round(audio[i] * 32767)));
    const all = new Float32Array(this.raw.length + scaled.length);
    all.set(this.raw);
    all.set(scaled, this.raw.length);
    let offset = 0;
    let result = null;
    while (all.length - offset >= CHUNK) {
      const chunk = all.subarray(offset, offset + CHUNK);
      offset += CHUNK;
      result = await this.step(chunk, now);
    }
    this.raw = all.slice(offset);
    return result;
  }

  async step(chunk, now) {
    // melspectrogram of the chunk plus 480 samples of context: 8 new frames
    const input = new Float32Array(MEL_CONTEXT + CHUNK);
    input.set(this.tail);
    input.set(chunk, MEL_CONTEXT);
    this.tail = chunk.slice(CHUNK - MEL_CONTEXT);
    const melOut = await this.mel.run({ [this.mel.inputNames[0]]: new this.ort.Tensor('float32', input, [1, input.length]) });
    const spec = melOut[this.mel.outputNames[0]].data; // [time, 1, 1, 32]
    const frames = spec.length / MEL_BINS;
    for (let t = 0; t < frames; t++) {
      const f = new Float32Array(MEL_BINS);
      for (let b = 0; b < MEL_BINS; b++) f[b] = spec[t * MEL_BINS + b] / 10 + 2; // openWakeWord's transform
      this.melFrames.push(f);
    }
    if (this.melFrames.length > 970) this.melFrames.splice(0, this.melFrames.length - 970);

    // one embedding from the last 76 mel frames
    const window = new Float32Array(EMB_WINDOW * MEL_BINS);
    const start = this.melFrames.length - EMB_WINDOW;
    for (let t = 0; t < EMB_WINDOW; t++) window.set(this.melFrames[start + t], t * MEL_BINS);
    const embOut = await this.emb.run({ [this.emb.inputNames[0]]: new this.ort.Tensor('float32', window, [1, EMB_WINDOW, MEL_BINS, 1]) });
    this.features.push(Float32Array.from(embOut[this.emb.outputNames[0]].data)); // 96
    if (this.features.length > FEATURES) this.features.shift();
    if (this.features.length < FEATURES) return { score: 0, detected: false };

    const feats = new Float32Array(FEATURES * 96);
    this.features.forEach((f, i) => feats.set(f, i * 96));
    const out = await this.wake.run({ [this.wake.inputNames[0]]: new this.ort.Tensor('float32', feats, [1, FEATURES, 96]) });
    const score = out[this.wake.outputNames[0]].data[0];
    this.lastScore = score;
    if (now < this.coolUntil) return { score, detected: false };
    this.hits = score >= this.threshold ? this.hits + 1 : 0;
    if (this.hits >= this.patience) {
      this.hits = 0;
      this.coolUntil = now + this.cooldownMs;
      return { score, detected: true };
    }
    return { score, detected: false };
  }
}

export class Vad {
  static async create(ort, model) {
    const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
    return new Vad(ort, session);
  }

  constructor(ort, session) {
    this.ort = ort;
    this.session = session;
    this.reset();
  }

  reset() {
    this.state = new Float32Array(2 * 128);
    this.context = new Float32Array(64); // Silero v5 expects the previous 64 samples before each window
    this.pending = new Float32Array(0);
  }

  /** Feed audio; returns the speech probabilities (0..1) of each 32 ms window completed. */
  async push(audio) {
    const all = new Float32Array(this.pending.length + audio.length);
    all.set(this.pending);
    all.set(audio, this.pending.length);
    const probs = [];
    let offset = 0;
    while (all.length - offset >= 512) {
      const win = all.subarray(offset, offset + 512);
      offset += 512;
      const input = new Float32Array(576);
      input.set(this.context);
      input.set(win, 64);
      this.context = win.slice(448);
      const feeds = {
        input: new this.ort.Tensor('float32', input, [1, 576]),
        state: new this.ort.Tensor('float32', this.state, [2, 1, 128]),
        sr: new this.ort.Tensor('int64', BigInt64Array.from([16000n]), []),
      };
      const out = await this.session.run(feeds);
      this.state = Float32Array.from(out.stateN.data);
      probs.push(out.output.data[0]);
    }
    this.pending = all.slice(offset);
    return probs;
  }
}

/**
 * Decides when a spoken request has ended: speech must start within `startTimeoutMs`, and it ends after
 * `endSilenceMs` of silence (or at `maxMs`). Fed with Vad probabilities, one per 32 ms.
 */
export class Endpointer {
  constructor({ startTimeoutMs = 5000, endSilenceMs = 800, maxMs = 12000, minSpeechMs = 250 } = {}) {
    Object.assign(this, { startTimeoutMs, endSilenceMs, maxMs, minSpeechMs });
    this.reset();
  }

  reset() {
    this.elapsed = 0;
    this.speech = 0;
    this.silence = 0;
    this.started = false;
  }

  /** @returns 'waiting' | 'speaking' | 'done' | 'nothing' */
  feed(prob) {
    const ms = 32;
    this.elapsed += ms;
    // hysteresis: start at 0.5, keep going down to 0.35, like Silero's own helper
    const voiced = prob >= (this.started ? 0.35 : 0.5);
    if (voiced) {
      this.speech += ms;
      this.silence = 0;
      if (this.speech >= this.minSpeechMs) this.started = true;
    } else {
      this.silence += ms;
      if (!this.started) this.speech = Math.max(0, this.speech - ms);
    }
    if (this.started && (this.silence >= this.endSilenceMs || this.elapsed >= this.maxMs)) return 'done';
    if (!this.started && this.elapsed >= this.startTimeoutMs) return 'nothing';
    return this.started ? 'speaking' : 'waiting';
  }
}

/** 16 kHz mono Float32 -> a WAV file (what /api/assistant/voice accepts). */
export function toWav(samples, rate = SAMPLE_RATE) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return new Uint8Array(buf);
}
