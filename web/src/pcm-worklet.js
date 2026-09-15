/**
 * Hands every block of microphone samples to the page as it is captured. It does no more than that
 * on purpose: the audio thread must never wait, and everything a recording needs — accumulating,
 * measuring, writing a file — can happen where a pause costs nothing.
 *
 * Loaded as its own file because that is what an AudioWorklet is: a module the audio thread runs.
 */
class PcmTap extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    // A copy, because the block itself is reused for the next one the moment this returns.
    if (channel && channel.length > 0) this.port.postMessage(new Float32Array(channel));
    return true;
  }
}
registerProcessor('pcm-tap', PcmTap);
