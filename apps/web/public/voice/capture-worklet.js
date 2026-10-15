/**
 * Microphone -> 16 kHz mono Float32 chunks of 1280 samples (80 ms), posted to the main thread.
 * Resamples itself (any input rate): Firefox refuses to connect a microphone to a 16 kHz AudioContext.
 */
class Capture16k extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.pos = 0; // fractional read position into the incoming stream
    this.prev = 0; // last input sample of the previous block (for interpolation)
    this.acc = 0; // low-pass state
    this.out = new Float32Array(1280);
    this.n = 0;
    // a one-pole low-pass at ~7 kHz before dropping samples: keeps aliasing out of the wake-word features
    const fc = 7000 / sampleRate;
    this.alpha = this.ratio > 1 ? (2 * Math.PI * fc) / (2 * Math.PI * fc + 1) : 1;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    const filtered = new Float32Array(ch.length);
    let acc = this.acc;
    for (let i = 0; i < ch.length; i++) {
      acc += this.alpha * (ch[i] - acc);
      filtered[i] = acc;
    }
    this.acc = acc;
    // linear interpolation at steps of `ratio`
    while (this.pos < ch.length) {
      const i = Math.floor(this.pos);
      const frac = this.pos - i;
      const a = i === 0 ? this.prev : filtered[i - 1];
      const b = filtered[i];
      this.out[this.n++] = a + (b - a) * frac;
      if (this.n === this.out.length) {
        this.port.postMessage(this.out, [this.out.buffer]);
        this.out = new Float32Array(1280);
        this.n = 0;
      }
      this.pos += this.ratio;
    }
    this.pos -= ch.length;
    this.prev = filtered[ch.length - 1];
    return true;
  }
}

registerProcessor('capture-16k', Capture16k);
