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
  async start() {
    if (this.isActive) {
      console.warn("[VAD] Already active");
      return;
    }

    this.speechSegments = [];
    this.sessionStartTime = Date.now();

    // Try VAD first, fallback to MediaRecorder
    try {
      await this.startVAD();
    } catch (vadError) {
      console.warn("[VAD] VAD initialization failed, falling back to MediaRecorder:", vadError);
      await this.startMediaRecorderFallback();
    }
  }

  async startVAD() {
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
        
        // Configure ONNX runtime to use local files
        ortConfig(ort) {
          // Point to local WASM files in public directory
          ort.env.wasm.wasmPaths = `${publicUrl}/`;
        },
        
        // VAD Sensitivity Tweaks - balanced to reduce fragmentation
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.4,
        minSpeechFrames: 3,
        preSpeechPadFrames: 2,
        redemptionFrames: 8, // Lower for more responsive end detection

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
   * MediaRecorder fallback when VAD fails
   */
  async startMediaRecorderFallback() {
    console.log("[VAD] Starting MediaRecorder fallback mode");
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = new MediaRecorder(stream);
      this.recordedChunks = [];
      
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };
      
      this.mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(this.recordedChunks, { type: "audio/webm" });
        
        // Convert blob to Float32Array at 16kHz for Whisper
        const audioBuffer = await this.blobToAudioBuffer(audioBlob);
        const float32Audio = this.resampleTo16kHz(audioBuffer);
        
        this.speechSegments.push({
          audio: float32Audio,
          timestamp: Date.now(),
        });
        
        if (this.onSpeechEndCallback) {
          this.onSpeechEndCallback(float32Audio);
        }
        
        // Clean up
        stream.getTracks().forEach(track => track.stop());
      };
      
      this.mediaRecorder.start();
      this.isActive = true;
      this.usingFallback = true;
      console.log("[VAD] MediaRecorder fallback started");
    } catch (error) {
      console.error("[VAD] MediaRecorder fallback failed:", error);
      throw new Error("Could not access microphone");
    }
  }

  async blobToAudioBuffer(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    return await audioContext.decodeAudioData(arrayBuffer);
  }

  resampleTo16kHz(audioBuffer) {
    const targetSampleRate = 16000;
    const sourceSampleRate = audioBuffer.sampleRate;
    
    if (sourceSampleRate === targetSampleRate) {
      return audioBuffer.getChannelData(0);
    }
    
    const ratio = sourceSampleRate / targetSampleRate;
    const sourceData = audioBuffer.getChannelData(0);
    const targetLength = Math.round(sourceData.length / ratio);
    const result = new Float32Array(targetLength);
    
    for (let i = 0; i < targetLength; i++) {
      const sourceIndex = Math.floor(i * ratio);
      result[i] = sourceData[sourceIndex];
    }
    
    return result;
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

    // Handle MediaRecorder fallback
    if (this.usingFallback && this.mediaRecorder) {
      this.mediaRecorder.stop();
      this.isActive = false;
      this.usingFallback = false;
      
      const totalDurationMs = Date.now() - this.sessionStartTime;
      return {
        segments: this.speechSegments,
        totalDurationMs,
        speechDurationMs: totalDurationMs, // No VAD, so assume all is speech
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
    // and triggers onSpeechEnd for buffered audio
    this.vad.pause();
    
    // Wait for the flush to complete before destroying
    await new Promise(resolve => setTimeout(resolve, 300));
    
    this.vad.destroy();
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
