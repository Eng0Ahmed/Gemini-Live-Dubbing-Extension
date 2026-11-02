/**
 * AudioWorkletProcessor for Tab Audio Stream
 * Replaces deprecated ScriptProcessorNode.
 * Downsamples incoming Web Audio Float32 stream to 16,000 Hz 16-bit PCM buffer
 * for Google Gemini Live Multimodal WebSocket API.
 */

class TabAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetSampleRate = 16000;
    this.bufferSize = 2048; // Chunk size in 16kHz samples (~128ms)
    this.outputBuffer = new Int16Array(this.bufferSize);
    this.bufferIndex = 0;
    
    // Resampling tracking
    this.resampleRatio = sampleRate / this.targetSampleRate;
    this.resamplePosition = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    // Use first channel (mono) or average stereo channels
    const channel0 = input[0];
    const channel1 = input.length > 1 ? input[1] : channel0;

    if (!channel0) return true;

    const inputLength = channel0.length;

    // Resample from context sampleRate (e.g., 48000Hz) down to 16000Hz
    while (this.resamplePosition < inputLength) {
      const idx = Math.floor(this.resamplePosition);
      const nextIdx = Math.min(idx + 1, inputLength - 1);
      const fraction = this.resamplePosition - idx;

      // Mono sample calculation (average left + right)
      const s0 = (channel0[idx] + channel1[idx]) / 2;
      const s1 = (channel0[nextIdx] + channel1[nextIdx]) / 2;
      const interpolatedSample = s0 + (s1 - s0) * fraction;

      // Clamp & convert Float32 (-1.0 to 1.0) to 16-bit Signed Integer (-32768 to 32767)
      const clamped = Math.max(-1, Math.min(1, interpolatedSample));
      const int16Sample = clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF;

      this.outputBuffer[this.bufferIndex++] = Math.trunc(int16Sample);

      // When chunk is full, transfer ArrayBuffer to main thread
      if (this.bufferIndex >= this.bufferSize) {
        const chunkToTransfer = this.outputBuffer.slice(0, this.bufferSize);
        this.port.postMessage(chunkToTransfer.buffer, [chunkToTransfer.buffer]);
        this.bufferIndex = 0;
      }

      this.resamplePosition += this.resampleRatio;
    }

    // Reset position modulo for next buffer
    this.resamplePosition -= inputLength;

    return true;
  }
}

registerProcessor('audio-processor', TabAudioProcessor);
