/**
 * Runs the wake word and the speech detector off the main thread.
 *
 * In:  {type:'init', base}                     load the models (base = '/voice/')
 *      {type:'audio', samples: Float32Array}    80 ms of 16 kHz audio
 *      {type:'wake'}                            listen for the wake word
 *      {type:'capture', startTimeoutMs, preRollMs}  record one request until the person stops talking
 *      {type:'idle'}                            ignore audio
 * Out: {type:'ready', phrase} | {type:'error', message}
 *      {type:'wake', score} | {type:'speech'} | {type:'utterance', wav: Uint8Array} | {type:'nothing'}
 *      {type:'level', value}
 */
import { Endpointer, Vad, WakeWord, toWav } from './engine.mjs';

let ort;
let wake;
let vad;
let mode = 'idle';
let endpointer;
let recorded = [];
let spoke = false;
let busy = Promise.resolve();
const recent = []; // the last second of audio: a request said straight after the wake word starts here

async function bytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function init(base) {
  ort = await import(`${base}ort/ort.wasm.min.mjs`);
  ort.env.wasm.wasmPaths = `${base}ort/`;
  ort.env.wasm.numThreads = 1; // threads need cross-origin isolation; one is plenty for 80 ms steps
  const config = await (await fetch(`${base}wake.json`, { cache: 'no-cache' })).json();
  const [mel, embedding, model, vadModel] = await Promise.all([
    bytes(`${base}melspectrogram.onnx`), bytes(`${base}embedding_model.onnx`), bytes(`${base}${config.model}`), bytes(`${base}silero_vad.onnx`),
  ]);
  wake = await WakeWord.create(ort, { mel, embedding, wake: model }, { threshold: config.threshold ?? 0.5, patience: config.patience ?? 1 });
  vad = await Vad.create(ort, vadModel);
  postMessage({ type: 'ready', phrase: config.phrase });
}

async function onAudio(samples) {
  recent.push(samples);
  if (recent.length > 13) recent.shift(); // ~1 s
  let peak = 0;
  for (let i = 0; i < samples.length; i += 4) peak = Math.max(peak, Math.abs(samples[i]));
  if (mode === 'capture') postMessage({ type: 'level', value: Math.min(1, peak * 3) });

  if (mode === 'wake' && wake) {
    const r = await wake.push(samples);
    if (r && r.detected && mode === 'wake') {
      mode = 'idle';
      postMessage({ type: 'wake', score: r.score });
    }
  } else if (mode === 'capture' && vad) {
    recorded.push(samples);
    for (const p of await vad.push(samples)) {
      const state = endpointer.feed(p);
      if (state === 'speaking' && !spoke) {
        spoke = true;
        postMessage({ type: 'speech' });
      }
      if (state === 'done') return finish(true);
      if (state === 'nothing') return finish(false);
    }
  }
}

function finish(gotSpeech) {
  mode = 'idle';
  if (!gotSpeech) {
    recorded = [];
    postMessage({ type: 'nothing' });
    return;
  }
  const total = recorded.reduce((n, c) => n + c.length, 0);
  const all = new Float32Array(total);
  let o = 0;
  for (const c of recorded) { all.set(c, o); o += c.length; }
  recorded = [];
  const wav = toWav(all);
  postMessage({ type: 'utterance', wav }, [wav.buffer]);
}

onmessage = (e) => {
  const msg = e.data;
  // one at a time, in order: the models are not re-entrant
  busy = busy.then(async () => {
    try {
      if (msg.type === 'init') await init(msg.base);
      else if (msg.type === 'audio') await onAudio(msg.samples);
      else if (msg.type === 'wake') { wake?.reset(); mode = 'wake'; }
      else if (msg.type === 'idle') mode = 'idle';
      else if (msg.type === 'capture') {
        vad?.reset();
        endpointer = new Endpointer({ startTimeoutMs: msg.startTimeoutMs ?? 5000, endSilenceMs: msg.endSilenceMs ?? 800 });
        spoke = false;
        // keep what was said just after the wake word (people say it in one breath)
        const pre = Math.round((msg.preRollMs ?? 0) / 80);
        recorded = pre ? recent.slice(-pre) : [];
        // the pre-roll warms the detector up but doesn't count: it holds the wake word itself, and a pause
        // after "Hey Switchboard" must not end the request before it starts
        for (const c of recorded) await vad.push(c);
        mode = 'capture';
      }
    } catch (err) {
      postMessage({ type: 'error', message: String(err && err.message ? err.message : err) });
    }
  });
};

