import workletUrl from './pcm-worklet.js?url';

/**
 * Speech, not music: 16 kHz mono is what a telephone has always carried, and the browser resamples
 * to it properly on the way in, so nothing here has to filter anything.
 */
export const RATE = 16_000;
/** A recording stops itself here. Long enough for anything anyone says; short enough to stay in hand. */
export const RECORD_MAX_MS = 5 * 60_000;
/** How often the level is published while recording. Often enough to look alive, rarely enough to be free. */
const LEVEL_EVERY_MS = 100;
/** What a recording is called when it arrives at the other end. */
export const RECORDING_NAME = 'ボイスメッセージ.wav';

/** Why a recording could not start, in the owner's terms. There is nothing to retry for the first two. */
export type RecorderProblem = 'denied' | 'unsupported' | 'failed';
export class RecorderError extends Error {
  constructor(readonly problem: RecorderProblem) { super(problem); }
}

/**
 * The one file format a browser can write without a codec it does not have: uncompressed PCM, with
 * the 44-byte header that says how to read it. It is large for what it holds — a minute is about
 * two megabytes — which is why the server re-encodes it before it goes anywhere.
 */
export function wavFile(samples: Int16Array, rate: number): Blob {
  const header = new DataView(new ArrayBuffer(44));
  const text = (at: number, value: string) => { for (let i = 0; i < value.length; i++) header.setUint8(at + i, value.charCodeAt(i)); };
  const bytes = samples.length * 2;
  text(0, 'RIFF'); header.setUint32(4, 36 + bytes, true); text(8, 'WAVE');
  text(12, 'fmt '); header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);          // PCM, uncompressed
  header.setUint16(22, 1, true);          // one channel
  header.setUint32(24, rate, true);
  header.setUint32(28, rate * 2, true);   // bytes per second
  header.setUint16(32, 2, true);          // bytes per frame
  header.setUint16(34, 16, true);         // bits per sample
  text(36, 'data'); header.setUint32(40, bytes, true);
  return new Blob([header.buffer, samples.buffer as ArrayBuffer], { type: 'audio/wav' });
}

/**
 * Holds the microphone open and keeps what it hears. The level is published as it arrives so the
 * screen can show that something is being heard — a recording that turns out to be silence is worse
 * than one that never started.
 *
 * Everything it opens is closed on `stop`, however that comes about: the tracks are what make a
 * browser show its recording indicator, and leaving one running would be a microphone left on.
 */
export class VoiceRecorder {
  #context: AudioContext | undefined;
  #stream: MediaStream | undefined;
  #node: AudioWorkletNode | undefined;
  #chunks: Int16Array[] = [];
  #count = 0;
  #rate = RATE;
  /** The loudest thing heard since the level was last published, and when that was. */
  #peak = 0;
  #told = 0;

  constructor(private readonly onLevel: (level: number) => void) {}

  get seconds(): number { return this.#count / this.#rate; }

  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') throw new RecorderError('unsupported');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch (error) {
      // Refused, dismissed, or blocked for the site: all of them mean the same thing to the owner.
      const name = (error as DOMException).name;
      throw new RecorderError(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'failed');
    }
    try {
      // Asking for the rate lets the browser resample as it captures, which it does better than
      // this could. A browser that will not be told keeps its own, and the server resamples later.
      let context: AudioContext;
      try { context = new AudioContext({ sampleRate: RATE }); }
      catch { context = new AudioContext(); }
      this.#context = context; this.#stream = stream; this.#rate = context.sampleRate;
      await context.audioWorklet.addModule(workletUrl);
      const node = new AudioWorkletNode(context, 'pcm-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      this.#node = node;
      node.port.onmessage = event => this.#take(event.data as Float32Array);
      // Through a silent gain to the speakers, because a graph is driven from its destination: a
      // node on no path to one may simply never be asked for anything. It emits nothing.
      const silence = context.createGain();
      silence.gain.value = 0;
      context.createMediaStreamSource(stream).connect(node);
      node.connect(silence).connect(context.destination);
      await context.resume();
    } catch (error) {
      await this.stop();
      throw error instanceof RecorderError ? error : new RecorderError('failed');
    }
  }

  #take(block: Float32Array) {
    const samples = new Int16Array(block.length);
    let peak = 0;
    for (let i = 0; i < block.length; i++) {
      const value = Math.max(-1, Math.min(1, block[i]!));
      if (Math.abs(value) > peak) peak = Math.abs(value);
      samples[i] = value < 0 ? value * 0x8000 : value * 0x7fff;
    }
    this.#chunks.push(samples); this.#count += samples.length;
    // A block arrives every few milliseconds; a meter that moved that often would be a blur, and
    // redrawing the screen at that rate for it would be worse. The loudest of them is what shows.
    this.#peak = Math.max(this.#peak, peak);
    const now = Date.now();
    if (now - this.#told < LEVEL_EVERY_MS) return;
    this.#told = now; this.onLevel(this.#peak); this.#peak = 0;
  }

  /** Closes everything and returns what was heard, or nothing when that was silence of no length. */
  async stop(): Promise<{ file: File; seconds: number } | null> {
    const node = this.#node, context = this.#context, stream = this.#stream;
    this.#node = undefined; this.#context = undefined; this.#stream = undefined;
    if (node) { node.port.onmessage = null; node.disconnect(); }
    for (const track of stream?.getTracks() ?? []) track.stop();
    await context?.close().catch(() => {});
    const chunks = this.#chunks.splice(0), count = this.#count, rate = this.#rate;
    this.#count = 0; this.#peak = 0; this.#told = 0;
    if (count === 0) return null;
    const samples = new Int16Array(count);
    let at = 0;
    for (const chunk of chunks) { samples.set(chunk, at); at += chunk.length; }
    return { file: new File([wavFile(samples, rate)], RECORDING_NAME, { type: 'audio/wav' }), seconds: count / rate };
  }
}
