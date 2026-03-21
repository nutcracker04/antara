import { env, pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm";

// All processing is 100% local - models download once, cache forever
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;

// Two-tier model selection:
// - WebGPU: whisper-large-v3-turbo (high quality, ~800MB)
// - WASM: distil-whisper-base.en (~80MB, fast on mobile)
const WEBGPU_MODEL = "onnx-community/whisper-large-v3-turbo";
const WASM_MODEL = "Xenova/distil-whisper-base.en";

let transcriberPromise;
let transcriberPreferredKey = "";
let transcriberResolvedOptions = null;

function postStatus(label, stage) {
  self.postMessage({ type: "status", payload: { label, stage } });
}

function postProgress(id, percent, stage = "transcribing") {
  self.postMessage({ id, type: "progress", payload: { percent, stage } });
}

async function isWebGPUReliable() {
  if (!navigator.gpu) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return false;
    const info = await adapter.requestAdapterInfo();
    // Skip on known problematic mobile GPU vendors
    const isMobile = /android/i.test(navigator.userAgent);
    if (isMobile && !info.vendor) return false;
    return true;
  } catch {
    return false;
  }
}

async function resolveTranscriberOptions() {
  const isWebGPUAvailable = await isWebGPUReliable();
  
  if (isWebGPUAvailable) {
    console.log(`[Transcriber] Using ${WEBGPU_MODEL} with webgpu/fp16`);
    return { device: "webgpu", dtype: "fp16", modelName: WEBGPU_MODEL };
  }

  console.log(`[Transcriber] Using ${WASM_MODEL} with wasm/q8 (fallback)`);
  return { device: "wasm", dtype: "q8", modelName: WASM_MODEL };
}

function loadTranscriberPipeline(options) {
  return pipeline("automatic-speech-recognition", options.modelName, {
    dtype: options.dtype,
    device: options.device,
    progress_callback: () => {
      postStatus("Transcription model is loading locally…", "loading-transcriber");
    },
  });
}

async function getTranscriber() {
  const preferred = await resolveTranscriberOptions();
  const preferredKey = `${preferred.modelName}|${preferred.device}|${preferred.dtype}`;

  if (!transcriberPromise || transcriberPreferredKey !== preferredKey) {
    transcriberPreferredKey = preferredKey;
    postStatus("Loading the on-device transcription model…", "loading-transcriber");
    transcriberPromise = loadTranscriberPipeline(preferred)
      .then((transcriber) => {
        transcriberResolvedOptions = preferred;
        return transcriber;
      })
      .catch(async (error) => {
        if (preferred.device === "webgpu") {
          postStatus("Falling back to CPU transcription…", "loading-transcriber");
          const fallback = { device: "wasm", dtype: "q8", modelName: WASM_MODEL };
          try {
            const transcriber = await loadTranscriberPipeline(fallback);
            transcriberResolvedOptions = fallback;
            return transcriber;
          } catch (fallbackError) {
            transcriberPreferredKey = "";
            transcriberPromise = undefined;
            transcriberResolvedOptions = null;
            throw fallbackError;
          }
        }
        transcriberPreferredKey = "";
        transcriberPromise = undefined;
        transcriberResolvedOptions = null;
        throw error;
      });
  }

  const transcriber = await transcriberPromise;
  return { transcriber, options: transcriberResolvedOptions || preferred };
}

self.onmessage = async (event) => {
  const { id, payload, type } = event.data;

  try {
    if (type === "WARMUP") {
      await getTranscriber();
      self.postMessage({ id, type: "success", payload: { ok: true } });
      postStatus("Transcription model ready.", "ready");
      return;
    }



    if (type === "TRANSCRIBE") {
      const { transcriber, options } = await getTranscriber();
      postStatus("Transcribing on this device…", "transcribing");

      const audioData = payload.audioData instanceof Float32Array 
        ? payload.audioData 
        : new Float32Array(payload.audioData || []);

      if (!audioData || audioData.length === 0) {
        throw new Error("No audio data received for transcription");
      }

      const minSamples = 8000;
      if (audioData.length < minSamples) {
        throw new Error("Audio too short - please record for at least 1 second");
      }

      let maxAmplitude = 0;
      const checkInterval = Math.max(1, Math.floor(audioData.length / 1000));
      for (let i = 0; i < audioData.length; i += checkInterval) {
        const abs = Math.abs(audioData[i]);
        if (abs > maxAmplitude) maxAmplitude = abs;
      }
      
      if (maxAmplitude < 0.001) {
        throw new Error("No audio detected - please check your microphone");
      }

      postProgress(id, 4, "transcribing");

      let progressValue = 4;
      const progressTimer = setInterval(() => {
        progressValue = Math.min(progressValue + 6, 88);
        postProgress(id, progressValue, "transcribing");
      }, 450);

      const rawLang = typeof payload.language === "string" && payload.language.trim().length > 0
        ? payload.language.trim().split("-")[0]
        : "en";

      console.log(`[Whisper] Processing ${audioData.length} samples (${(audioData.length / 16000).toFixed(2)}s)`);
      
      // Calculate audio stats without spreading the array
      let minVal = audioData[0];
      let maxVal = audioData[0];
      let sum = 0;
      let nonZeroCount = 0;
      for (let i = 0; i < audioData.length; i++) {
        const val = audioData[i];
        if (val < minVal) minVal = val;
        if (val > maxVal) maxVal = val;
        sum += val;
        if (Math.abs(val) > 0.001) nonZeroCount++;
      }
      const mean = sum / audioData.length;
      const nonZeroPercent = (nonZeroCount / audioData.length * 100).toFixed(1);
      console.log(`[Whisper] Audio stats - min: ${minVal.toFixed(4)}, max: ${maxVal.toFixed(4)}, mean: ${mean.toFixed(4)}, non-zero: ${nonZeroPercent}%`);

      const asrOptions = {
        chunk_length_s: 30,
        stride_length_s: 5,
        // Don't specify language or task for English-only models
        return_timestamps: true,
        force_full_sequences: false,
        condition_on_previous_text: false,
        // Anti-hallucination thresholds
        compression_ratio_threshold: 2.4,
        logprob_threshold: -1.0,  
        no_speech_threshold: 0.6,
      };

      let result;
      try {
        result = await transcriber(audioData, asrOptions);
        console.log(`[Whisper] Result:`, result);
      } finally {
        clearInterval(progressTimer);
      }

      postProgress(id, 100, "transcribing");

      const text = typeof result === "string" ? result : result?.text || "";
      const chunks = result?.chunks || null;

      if (!text || text.trim().length === 0) {
        throw new Error("No speech detected in the recording");
      }

      // Filter common Whisper hallucinations
      const hallucinations = [
        "Thank you for watching",
        "Thanks for watching",
        "Subscribe",
        "Please subscribe",
        "Subtitles by",
        "Amara.org",
        "www.mooji.org"
      ];

      const lowerText = text.toLowerCase();
      const isHallucination = hallucinations.some(phrase => lowerText.includes(phrase.toLowerCase()));

      if (isHallucination && text.length < 100) {
        throw new Error("Could not detect clear speech - please try recording again");
      }

      postStatus("Transcription finished locally.", "ready");
      self.postMessage({
        id,
        type: "success",
        payload: {
          text,
          chunks,
          transcriptionModel: `${options.modelName}|${options.device}|${options.dtype}`,
        },
      });
      return;
    }
  } catch (error) {
    postStatus("The transcription worker hit an error.", "error");
    self.postMessage({ id, type: "error", error: error.message || "Transcription failed." });
  }
};
