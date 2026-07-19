/**
 * PCM Capture AudioWorklet Processor
 *
 * Captures up to two channels of Float32 PCM from its input and forwards
 * batched samples to the main thread via the message port. Used by the
 * integration stream encoder (replaces the deprecated ScriptProcessorNode).
 *
 * Batches ~100ms of audio per message to keep cross-thread traffic low.
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffers = [[], []];
    this._bufferLength = 0;
    this._batchSize = 4096;
  }

  _flush(channelCount) {
    const merged = [];
    const transfers = [];
    for (let ch = 0; ch < channelCount; ch++) {
      const out = new Float32Array(this._bufferLength);
      let offset = 0;
      for (let i = 0; i < this._buffers[ch].length; i++) {
        out.set(this._buffers[ch][i], offset);
        offset += this._buffers[ch][i].length;
      }
      merged.push(out);
      transfers.push(out.buffer);
    }
    this.port.postMessage({ type: 'pcm', channels: merged }, transfers);
    this._buffers = [[], []];
    this._bufferLength = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const ch0 = input[0];
    if (!ch0 || ch0.length === 0) return true;
    const ch1 = input.length > 1 && input[1] ? input[1] : ch0;

    // Copy: input buffers are reused by the audio engine
    this._buffers[0].push(new Float32Array(ch0));
    this._buffers[1].push(new Float32Array(ch1));
    this._bufferLength += ch0.length;

    if (this._bufferLength >= this._batchSize) {
      this._flush(2);
    }

    return true;
  }
}

registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
