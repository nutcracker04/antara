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
let transcriberConfigKey = "";

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

async function getTranscriber() {
  const options = await resolveTranscriberOptions();
  const nextKey = `${options.modelName}|${options.device}|${options.dtype}`;

  if (!transcriberPromise || transcriberConfigKey !== nextKey) {
    transcriberConfigKey = nextKey;
    postStatus("Loading the on-device transcription model…", "loading-transcriber");
    transcriberPromise = pipeline("automatic-speech-recognition", options.modelName, {
      dtype: options.dtype,
      device: options.device,
      progress_callback: () => {
        postStatus("Transcription model is loading locally…", "loading-transcriber");
      },
    });
  }

  return { transcriber: await transcriberPromise, options };
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

      const asrOptions = {
        chunk_length_s: 20,
        return_timestamps: false,
        stride_length_s: 4,
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
