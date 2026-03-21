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
  let device = "wasm";
  let dtype = "q8";
  let modelName = MODELS.transcriberTiny;

  if (typeof navigator !== "undefined" && navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        device = "webgpu";
        dtype = "fp16";
        modelName = MODELS.transcriberBase;
      }
    } catch {
      /* fall back */
    }
  }

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

      const asrOptions = {
        chunk_length_s: 20,
        return_timestamps: false,
        stride_length_s: 4,
        language: rawLang,
        task: "transcribe",
      };

      let result;
      try {
        result = await transcriber(audioData, asrOptions);
      } finally {
        clearInterval(progressTimer);
      }

      postProgress(id, 100, "transcribing");

      const text = typeof result === "string" ? result : result?.text || "";

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
