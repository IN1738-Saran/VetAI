/**
 * AudioWorklet Processor for Azure Voice Live API
 * Runs on the dedicated audio rendering thread — NOT the main UI thread.
 *
 * Design decisions:
 *  - Gate is handled HERE (audio thread), not on the main thread.
 *    When AI is speaking, audio is discarded at the source — zero wasted
 *    postMessage traffic, zero wasted Float32→Int16 conversion cycles.
 *  - Float32→Int16 conversion is done here, so the main thread receives
 *    Azure-ready PCM and only needs to base64-encode before sending.
 *  - 960-sample buffer = 40ms at 24kHz — center of Azure OpenAI Realtime's recommended
 *    20–40ms chunk range (best practices doc).
 *  - Buffer is filled via Float32Array.set() + subarray (bulk native copy,
 *    SIMD-capable) — avoids a sample-by-sample loop.
 *  - The filled buffer is transferred (zero-copy) to the main thread, then
 *    a fresh Int16Array is allocated for the next chunk.
 */

const CHUNK_SIZE = 960; // 40ms at 24kHz — Azure OpenAI Realtime recommended range: 20–40ms

class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._gated = false;
    this._floatBuf = new Float32Array(CHUNK_SIZE);  // staging buffer for bulk copy
    this._intBuf   = new Int16Array(CHUNK_SIZE);    // output buffer (Int16 PCM)
    this._offset   = 0;

    // Gate control messages from the main thread: { type: 'gate', value: bool }
    this.port.onmessage = ({ data }) => {
      if (data.type === 'gate') {
        this._gated = data.value;
        if (data.value) {
          // Flush in-progress buffer — don't send stale pre-gate audio
          this._offset = 0;
        }
      }
    };
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel || channel.length === 0) return true;

    // While the AI is speaking we must NOT forward the candidate's microphone —
    // the AI's own voice bleeds back in and trips the server VAD, which makes the
    // model interrupt itself and "answer its own question".
    //
    // But we must not send NOTHING either. Azure's turn detector measures
    // silence over the audio it RECEIVES, so a hole in the stream freezes its
    // clock: the utterance that was in progress before the gate closed is never
    // declared finished, and `input_audio_buffer.speech_stopped` never arrives.
    // Dropping frames outright is what left the interview waiting forever.
    //
    // So while gated we send SILENCE at the same 40ms cadence. The timeline stays
    // continuous, the VAD keeps counting, and no echo reaches the model.
    const gated = this._gated;

    let inputOffset = 0;

    while (inputOffset < channel.length) {
      const spaceLeft = CHUNK_SIZE - this._offset;
      const toCopy    = Math.min(spaceLeft, channel.length - inputOffset);

      if (gated) {
        this._floatBuf.fill(0, this._offset, this._offset + toCopy);
      } else {
        // Bulk copy Float32 samples into staging buffer (native, SIMD-eligible)
        this._floatBuf.set(channel.subarray(inputOffset, inputOffset + toCopy), this._offset);
      }
      this._offset    += toCopy;
      inputOffset     += toCopy;

      if (this._offset === CHUNK_SIZE) {
        // Calculate RMS to gate out quiet background noise
        let sumSquares = 0;
        for (let i = 0; i < CHUNK_SIZE; i++) {
          sumSquares += this._floatBuf[i] * this._floatBuf[i];
        }
        const rms = Math.sqrt(sumSquares / CHUNK_SIZE);

        // Noise floor only. This must be LOW — the browser mic already runs
        // echoCancellation + noiseSuppression, and AI echo is fully discarded by
        // the `_gated` flag above, so this gate's only job is to drop dead-silent
        // room tone. A high threshold (the old 0.02) zeroed out genuine but quiet
        // candidate speech (common with laptop mics + AGC), starving Azure's VAD
        // so it never detected the candidate and the AI never replied. 0.005 lets
        // real speech through while still muting true silence.
        if (rms < 0.005) {
          this._intBuf.fill(0);
        } else {
          // Convert Float32 [-1.0, 1.0] → Int16 [-32768, 32767] for Azure Realtime PCM format
          for (let i = 0; i < CHUNK_SIZE; i++) {
            const s = this._floatBuf[i];
            const clamped = s < -1.0 ? -1.0 : s > 1.0 ? 1.0 : s;
            this._intBuf[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
          }
        }

        // Send a clone of the Int16Array buffer without detaching this._intBuf
        const pcmCopy = this._intBuf.slice(0).buffer;
        this.port.postMessage(pcmCopy, [pcmCopy]);

        // Reset offset for next chunk — zero reallocations in real-time process loop!
        this._offset = 0;
      }
    }

    return true;
  }
}

registerProcessor('mic-processor', MicProcessor);
