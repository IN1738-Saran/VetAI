/**
 * AudioWorklet Processor for Azure Voice Live API
 * Replaces deprecated ScriptProcessorNode
 */
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    
    if (input && input[0]) {
      const pcm = input[0]; // Float32Array of audio samples
      
      // Send audio data to main thread
      this.port.postMessage(pcm);
    }
    
    // Return true to keep processor alive
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
