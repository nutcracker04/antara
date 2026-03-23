import { env, pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm";
import { installHfHubFetch } from "./hf-hub-auth.js";

// All processing is 100% local - models download once, cache forever
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;

const WHISPER_BASE_MODEL = "Xenova/whisper-base.en";

let transcriberPromise;
let transcriberPreferredKey = "";
let transcriberResolvedOptions = null;
const MOBILE_CHUNK_SECONDS = 5;

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

function isConstrainedMobileRuntime() {
  const userAgent = navigator.userAgent || "";
  const isTouchMac = /Macintosh/i.test(userAgent) && (navigator.maxTouchPoints || 0) > 1;
  const isMobile = /android|iphone|ipad|ipod/i.test(userAgent) || isTouchMac;
  if (!isMobile) {
    return false;
  }

  const deviceMemory = typeof navigator.deviceMemory === "number" ? navigator.deviceMemory : null;
  const hardwareConcurrency = typeof navigator.hardwareConcurrency === "number" ? navigator.hardwareConcurrency : null;

  return (
    deviceMemory === null ||
    deviceMemory <= 6 ||
    hardwareConcurrency === null ||
    hardwareConcurrency <= 8
  );
}

function initializeRuntime(runtime = {}) {
  installHfHubFetch(env, runtime.hfToken);
}

async function resolveTranscriberOptions() {
  const isWebGPUAvailable = await isWebGPUReliable();
  
  if (isWebGPUAvailable) {
    console.log(`[Transcriber] Using ${WHISPER_BASE_MODEL} with webgpu/fp16`);
    return { device: "webgpu", dtype: "fp16", modelName: WHISPER_BASE_MODEL };
  }

  console.log(`[Transcriber] Using ${WHISPER_BASE_MODEL} with wasm/q8`);
  return { device: "wasm", dtype: "q8", modelName: WHISPER_BASE_MODEL };
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
    transcriberPromise = (async () => {
      const candidates = preferred.device === "webgpu"
        ? [preferred, { device: "wasm", dtype: "q8", modelName: WHISPER_BASE_MODEL }]
        : [preferred];

      let lastError;
      for (const candidate of candidates) {
        try {
          if (candidate !== preferred) {
            postStatus("Switching Whisper Base to the CPU runtime for this device…", "loading-transcriber");
          }
          const transcriber = await loadTranscriberPipeline(candidate);
          transcriberResolvedOptions = candidate;
          return transcriber;
        } catch (error) {
          lastError = error;
          console.warn("[Transcriber] Failed to load candidate", candidate, error);
        }
      }

      transcriberPreferredKey = "";
      transcriberPromise = undefined;
      transcriberResolvedOptions = null;
      throw lastError;
    })();
  }

  const transcriber = await transcriberPromise;
  return { transcriber, options: transcriberResolvedOptions || preferred };
}

function normalizeResultText(result) {
  const rawText = typeof result === "string" ? result : result?.text || "";
  return rawText.replace(/\s+/g, " ").trim();
}

async function transcribeSequentially({ audioData, id, transcriber }) {
  const chunkSize = MOBILE_CHUNK_SECONDS * 16000;
  const totalChunks = Math.ceil(audioData.length / chunkSize);
  const texts = [];

  for (let index = 0; index < totalChunks; index += 1) {
    const start = index * chunkSize;
    const end = Math.min(start + chunkSize, audioData.length);
    const audioChunk = audioData.subarray(start, end);
    const result = await transcriber(audioChunk, {
      chunk_length_s: MOBILE_CHUNK_SECONDS,
      condition_on_previous_text: false,
      force_full_sequences: false,
      no_speech_threshold: 0.45,
      return_timestamps: false,
    });
    const text = normalizeResultText(result);

    if (text) {
      texts.push(text);
    }

    const percent = 10 + Math.round(((index + 1) / totalChunks) * 90);
    postProgress(id, percent, "transcribing");
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return {
    chunks: null,
    text: texts.join(" ").replace(/\s+/g, " ").trim(),
  };
}

self.onmessage = async (event) => {
  const { id, payload, type } = event.data;

  try {
    initializeRuntime(payload?.runtime);

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

      const minSamples = 6000;
      if (audioData.length < minSamples) {
        throw new Error("Audio too short - please record for at least half a second");
      }

      let maxAmplitude = 0;
      const checkInterval = Math.max(1, Math.floor(audioData.length / 1000));
      for (let i = 0; i < audioData.length; i += checkInterval) {
        const abs = Math.abs(audioData[i]);
        if (abs > maxAmplitude) maxAmplitude = abs;
      }
      
      if (maxAmplitude < 0.0006) {
        throw new Error("No audio detected - please check your microphone");
      }

      postProgress(id, 4, "transcribing");

      let progressValue = 4;
      const progressTimer = setInterval(() => {
        progressValue = Math.min(progressValue + 6, 88);
        postProgress(id, progressValue, "transcribing");
      }, 450);

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

      const constrainedMobile = isConstrainedMobileRuntime();
      const asrOptions = {
        chunk_length_s: constrainedMobile ? 8 : 20,
        stride_length_s: constrainedMobile ? 1 : 4,
        // Don't specify language or task for English-only models
        return_timestamps: false,
        force_full_sequences: false,
        condition_on_previous_text: false,
        // Anti-hallucination thresholds
        compression_ratio_threshold: 2.4,
        logprob_threshold: -1.0,  
        no_speech_threshold: 0.45,
      };

      let result;
      try {
        if (constrainedMobile && audioData.length > MOBILE_CHUNK_SECONDS * 16000) {
          result = await transcribeSequentially({ audioData, id, transcriber });
        } else {
          result = await transcriber(audioData, asrOptions);
        }
        console.log(`[Whisper] Result:`, result);
      } finally {
        clearInterval(progressTimer);
      }

      postProgress(id, 100, "transcribing");

      const text = normalizeResultText(result);
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
    const message = error.message || "Transcription failed.";
    self.postMessage({ id, type: "error", error: message });
  }
};
