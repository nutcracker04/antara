/**
 * VAD (Voice Activity Detection) Manager
 * Replaces MediaRecorder logic with intelligent speech detection
 * Only captures audio when someone is actually talking
 * 
 * Installation: npm install @ricky0123/vad-web
 */

export class VADManager {
  constructor(onSpeechEndCallback) {
    this.vad = null;
    this.onSpeechEndCallback = onSpeechEndCallback;
    this.isActive = false;
    this.speechSegments = [];
    this.sessionStartTime = null;
  }

  /**
   * Start listening for speech
   */
  async start(stream) {
    if (this.isActive) {
      console.warn("[VAD] Already active");
      return;
    }

    this.speechSegments = [];
    this.sessionStartTime = Date.now();

    await this.startVAD(stream);
  }

  async startVAD(stream) {
    // Dynamically import VAD library
    let MicVAD;
    try {
      const vadModule = await import("@ricky0123/vad-web");
      MicVAD = vadModule.MicVAD;
    } catch (error) {
      console.error("[VAD] Failed to load VAD library:", error);
      throw new Error("VAD library not available");
    }

    // Use local worklet and model files from public directory
    const publicUrl = process.env.PUBLIC_URL || "";
    
    try {
      this.vad = await MicVAD.new({
        workletURL: `${publicUrl}/vad.worklet.bundle.min.js`,
        modelURL: `${publicUrl}/silero_vad.onnx`,
        stream,
        
        // Configure ONNX runtime to use local files
        ortConfig(ort) {
          // Point to local WASM files in public directory
          ort.env.wasm.wasmPaths = `${publicUrl}/`;
        },
        
        // Flush the current utterance when the user stops manually.
        submitUserSpeechOnPause: true,

        // Slightly more permissive thresholds help mobile/PWA microphone
        // input where gain/noise processing can make speech look softer.
        positiveSpeechThreshold: 0.42,
        negativeSpeechThreshold: 0.3,
        minSpeechFrames: 2,
        preSpeechPadFrames: 3,
        redemptionFrames: 12,

        onSpeechStart: () => {
          console.log("[VAD] Speech detected...");
        },

        onSpeechEnd: (audio) => {
          // 'audio' is a Float32Array at 16000Hz - perfect for Whisper!
          console.log(`[VAD] Speech segment finished. Length: ${audio.length} samples (${(audio.length / 16000).toFixed(2)}s)`);
          
          // Store segment for later or process immediately
          this.speechSegments.push({
            audio,
            timestamp: Date.now(),
          });

          // Call the callback with the final complete audio segment
          if (this.onSpeechEndCallback) {
            console.log(`[VAD] Calling onSpeechEndCallback with ${audio.length} samples`);
            this.onSpeechEndCallback(audio);
          }
        },

        onVADMisfire: () => {
          console.log("[VAD] Misfire (likely background noise)");
        },
      });

      this.isActive = true;
      this.vad.start();
      console.log("[VAD] Started listening for speech");
    } catch (vadError) {
      console.error("[VAD] Failed to initialize VAD:", vadError);
      throw vadError;
    }
  }

  /**
   * Stop listening and return all captured segments
   * Returns a Promise to allow VAD to flush pending audio
   */
  async stop() {
    if (!this.isActive) {
      return {
        segments: [],
        totalDurationMs: 0,
        speechDurationMs: 0,
      };
    }

    // Handle VAD mode
    if (!this.vad) {
      return {
        segments: [],
        totalDurationMs: 0,
        speechDurationMs: 0,
      };
    }

    // Pause first — this flushes any in-progress speech segment
    // and triggers onSpeechEnd for buffered audio because
    // submitUserSpeechOnPause is enabled.
    this.vad.pause();
    
    // Wait for the flush to complete before destroying
    await new Promise(resolve => setTimeout(resolve, 300));
    
    this.vad.destroy();
    this.vad = null;
    this.isActive = false;

    const totalDurationMs = Date.now() - this.sessionStartTime;
    const speechDurationMs = this.speechSegments.reduce(
      (sum, seg) => sum + (seg.audio.length / 16000) * 1000,
      0
    );

    console.log(
      `[VAD] Session ended. Total: ${(totalDurationMs / 1000).toFixed(1)}s, Speech: ${(speechDurationMs / 1000).toFixed(1)}s (${((speechDurationMs / totalDurationMs) * 100).toFixed(1)}% efficiency)`
    );

    const result = {
      segments: this.speechSegments,
      totalDurationMs,
      speechDurationMs,
    };

    this.speechSegments = [];
    this.sessionStartTime = null;

    return result;
  }

  /**
   * Get concatenated audio from all segments
   */
  getConcatenatedAudio() {
    if (this.speechSegments.length === 0) {
      return new Float32Array(0);
    }

    const totalLength = this.speechSegments.reduce((sum, seg) => sum + seg.audio.length, 0);
    const result = new Float32Array(totalLength);

    let offset = 0;
    for (const segment of this.speechSegments) {
      result.set(segment.audio, offset);
      offset += segment.audio.length;
    }

    return result;
  }

  /**
   * Check if VAD is currently active
   */
  get isListening() {
    return this.isActive;
  }

  /**
   * Get current session statistics
   */
  getStats() {
    if (!this.sessionStartTime) {
      return null;
    }

    const totalDurationMs = Date.now() - this.sessionStartTime;
    const speechDurationMs = this.speechSegments.reduce(
      (sum, seg) => sum + (seg.audio.length / 16000) * 1000,
      0
    );

    return {
      totalDurationMs,
      speechDurationMs,
      segmentCount: this.speechSegments.length,
      efficiency: totalDurationMs > 0 ? (speechDurationMs / totalDurationMs) * 100 : 0,
    };
  }
}
