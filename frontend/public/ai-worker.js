import { env, pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm";

env.allowRemoteModels = true;
env.useBrowserCache = true;

const MODELS = {
  embedder: "Xenova/all-MiniLM-L6-v2",
  transcriberTiny: "Xenova/whisper-tiny",
  transcriberBase: "Xenova/whisper-base",
};

let embedderPromise;
let transcriberPromise;
let transcriberPreferredKey = "";
let transcriberResolvedOptions = null;

function postStatus(label, stage) {
  self.postMessage({
    type: "status",
    payload: { label, stage },
  });
}

function postProgress(id, percent, stage = "transcribing") {
  self.postMessage({
    id,
    type: "progress",
    payload: { percent, stage },
  });
}

async function resolveTranscriberOptions() {
  // Force CPU/WASM for now - WebGPU has issues with some audio formats
  // TODO: Re-enable WebGPU once Transformers.js fixes the >> >> >> bug
  const device = "wasm";
  const dtype = "q8";
  const modelName = MODELS.transcriberTiny;

  console.log(`[Transcriber] Using ${modelName} with ${device}/${dtype}`);

  return { device, dtype, modelName };
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
          const fallback = {
            device: "wasm",
            dtype: "q8",
            modelName: MODELS.transcriberTiny,
          };
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

async function getEmbedder() {
  if (!embedderPromise) {
    postStatus("Loading the local search model…", "loading-embedder");
    embedderPromise = pipeline("feature-extraction", MODELS.embedder, {
      dtype: "q8",
      progress_callback: () => {
        postStatus("Search model is loading locally…", "loading-embedder");
      },
    });
  }

  return embedderPromise;
}

self.onmessage = async (event) => {
  const { id, payload, type } = event.data;

  try {
    if (type === "WARMUP") {
      await Promise.all([getTranscriber(), getEmbedder()]);
      self.postMessage({ id, type: "success", payload: { ok: true } });
      postStatus("Local models are ready.", "ready");
      return;
    }

    if (type === "TRANSCRIBE") {
      const { transcriber, options } = await getTranscriber();
      postStatus("Transcribing on this device…", "transcribing");

      const audioData = payload.audioData instanceof Float32Array ? payload.audioData : new Float32Array(payload.audioData || []);

      // Validate audio data
      if (!audioData || audioData.length === 0) {
        throw new Error("No audio data received for transcription");
      }

      // Check for minimum audio length (at least 0.5 seconds at 16kHz)
      const minSamples = 8000; // 0.5 seconds at 16kHz
      if (audioData.length < minSamples) {
        throw new Error("Audio too short - please record for at least 1 second");
      }

      // Check if audio is not just silence - optimized version
      let maxAmplitude = 0;
      const checkInterval = Math.max(1, Math.floor(audioData.length / 1000));
      for (let i = 0; i < audioData.length; i += checkInterval) {
        const abs = Math.abs(audioData[i]);
        if (abs > maxAmplitude) {
          maxAmplitude = abs;
        }
      }
      
      if (maxAmplitude < 0.001) {
        throw new Error("No audio detected - please check your microphone");
      }

      postProgress(id, 4, "transcribing");

      let progressTimer;
      let progressValue = 4;
      progressTimer = setInterval(() => {
        progressValue = Math.min(progressValue + 6, 88);
        postProgress(id, progressValue, "transcribing");
      }, 450);

      const rawLang =
        typeof payload.language === "string" && payload.language.trim().length > 0
          ? payload.language.trim().split("-")[0]
          : "en";

      // Log audio stats for debugging
      console.log(`[Whisper] Processing ${audioData.length} samples (${(audioData.length / 16000).toFixed(2)}s at 16kHz)`);
      console.log(`[Whisper] Max amplitude: ${maxAmplitude.toFixed(4)}, Language: ${rawLang}`);

      const asrOptions = {
        chunk_length_s: 30,
        return_timestamps: false,
        stride_length_s: 5,
        language: rawLang,
        task: "transcribe",
        // Add these to potentially improve accuracy
        condition_on_previous_text: false,
        compression_ratio_threshold: 2.4,
        logprob_threshold: -1.0,
        no_speech_threshold: 0.6,
      };

      let result;
      try {
        console.log(`[Whisper] Starting transcription with model: ${options.modelName}`);
        result = await transcriber(audioData, asrOptions);
        console.log(`[Whisper] Raw result:`, result);
      } finally {
        clearInterval(progressTimer);
      }

      postProgress(id, 100, "transcribing");

      const text = typeof result === "string" ? result : result?.text || "";

      // Validate transcription result
      if (!text || text.trim().length === 0) {
        throw new Error("No speech detected in the recording");
      }

      // Check for common Whisper hallucinations
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
          transcriptionModel: `${options.modelName}|${options.device}|${options.dtype}`,
        },
      });
      return;
    }

    if (type === "EMBED") {
      const embedder = await getEmbedder();
      postStatus("Building a local search vector…", "embedding");

      const output = await embedder(payload.text, { normalize: true, pooling: "mean" });
      const embedding = Array.from(output.data || []);

      postStatus("Local models are ready.", "ready");
      self.postMessage({ id, type: "success", payload: { embedding } });
    }
  } catch (error) {
    postStatus("The local AI worker hit an error.", "error");
    self.postMessage({ id, type: "error", error: error.message || "Local AI worker failed." });
  }
};
