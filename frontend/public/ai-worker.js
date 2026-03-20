import { env, pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm";

env.allowRemoteModels = true;
env.useBrowserCache = true;

const MODELS = {
  embedder: "Xenova/all-MiniLM-L6-v2",
  transcriber: "Xenova/whisper-tiny",
};

let embedderPromise;
let transcriberPromise;

function postStatus(label, stage) {
  self.postMessage({
    type: "status",
    payload: { label, stage },
  });
}

async function getTranscriber() {
  if (!transcriberPromise) {
    postStatus("Loading the on-device transcription model…", "loading-transcriber");
    transcriberPromise = pipeline("automatic-speech-recognition", MODELS.transcriber, {
      dtype: "q8",
      progress_callback: () => {
        postStatus("Transcription model is loading locally…", "loading-transcriber");
      },
    });
  }

  return transcriberPromise;
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
      const transcriber = await getTranscriber();
      postStatus("Transcribing on this device…", "transcribing");

      const audioData = payload.audioData instanceof Float32Array ? payload.audioData : new Float32Array(payload.audioData || []);
      const result = await transcriber(audioData, {
        chunk_length_s: 20,
        return_timestamps: false,
        stride_length_s: 4,
      });

      postStatus("Transcription finished locally.", "ready");
      self.postMessage({
        id,
        type: "success",
        payload: { text: typeof result === "string" ? result : result.text || "" },
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