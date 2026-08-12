/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

/**
 * Base64-encode raw PCM for `input_audio_buffer.append`.
 *
 * THIS IS THE HOTTEST FUNCTION IN THE APP. The AudioWorklet delivers a 960-sample
 * (1920-byte) chunk every 40ms — 25 times a second, for the entire interview,
 * whether or not anyone is speaking.
 *
 * It used to build the binary string with `binary += String.fromCharCode(b)` in a
 * per-byte loop. JavaScript strings are IMMUTABLE, so every `+=` allocates a new
 * string: 1920 allocations per chunk × 25 chunks/sec ≈ 48,000 allocations per
 * second, ~100 million over a 35-minute interview — all on the main thread, the
 * same thread that has to schedule AI audio buffers on time.
 *
 * That is why the muffling moved from ~15 minutes to ~35 after the output-side
 * batching fix but did not disappear: this is the INPUT side, and it runs
 * constantly regardless of who is talking.
 *
 * Chunked `String.fromCharCode.apply` over subarrays does the same work in ~1
 * allocation per 8KB instead of per byte. The 8192 block size stays well under
 * the argument-count limit that makes `.apply` throw on large arrays.
 */
function encode(bytes) {
  const CHUNK = 8192;
  const len = bytes.byteLength;
  if (len <= CHUNK) {
    return btoa(String.fromCharCode.apply(null, bytes));
  }
  const parts = [];
  for (let i = 0; i < len; i += CHUNK) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
  }
  return btoa(parts.join(''));
}

function decode(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// NOTE: a `createBlob()` helper used to live here. It was a Gemini Live API
// artifact — it returned Gemini's `{data, mimeType: 'audio/pcm;rate=16000'}`
// Blob shape at Gemini's 16kHz input rate. Azure Voice Live / the OpenAI Realtime
// protocol takes raw base64 PCM16 at 24kHz via `input_audio_buffer.append`
// instead, which the AudioWorklet + `encode()` already produce. It was unused
// after the migration and removed so nobody reintroduces a 16kHz mislabel.

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const numSamples = Math.floor(data.byteLength / 2 / numChannels);
  const buffer = ctx.createBuffer(
    numChannels,
    numSamples,
    sampleRate,
  );

  const dataInt16 = new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2);
  const totalSamples = dataInt16.length;

  if (numChannels === 1) {
    const dataFloat32 = new Float32Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      dataFloat32[i] = dataInt16[i] / 32768.0;
    }
    buffer.copyToChannel(dataFloat32, 0);
  } else {
    for (let c = 0; c < numChannels; c++) {
      const channelFloat32 = new Float32Array(numSamples);
      for (let i = 0; i < numSamples; i++) {
        channelFloat32[i] = dataInt16[i * numChannels + c] / 32768.0;
      }
      buffer.copyToChannel(channelFloat32, c);
    }
  }

  return buffer;
}

export {decode, decodeAudioData, encode};
