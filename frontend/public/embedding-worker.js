import { env, pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm";

// All processing is 100% local - models download once, cache forever
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;

// Upgraded from all-MiniLM-L6-v2 for better recall at same size
const EMBEDDER_MODEL = "Xenova/bge-small-en-v1.5";

let embedderPromise;

function postStatus(label, stage) {
  self.postMessage({ type: "status", payload: { label, stage } });
}

async function getEmbedder() {
  if (!embedderPromise) {
    postStatus("Loading the local search model…", "loading-embedder");
    
    const isWebGPUSupported = !!navigator.gpu;
    const embedderOptions = isWebGPUSupported
      ? { dtype: "fp16", device: "webgpu" }
      : { dtype: "q8", device: "wasm" };
    
    embedderPromise = pipeline("feature-extraction", EMBEDDER_MODEL, {
      ...embedderOptions,
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
      await getEmbedder();
      self.postMessage({ id, type: "success", payload: { ok: true } });
      postStatus("Search model ready.", "ready");
      return;
    }

    if (type === "EMBED") {
      const embedder = await getEmbedder();
      postStatus("Building a local search vector…", "embedding");

      const output = await embedder(payload.text, { normalize: true, pooling: "mean" });
      const embedding = Array.from(output.data || []);

      postStatus("Search model ready.", "ready");
      self.postMessage({ id, type: "success", payload: { embedding } });
      return;
    }
  } catch (error) {
    postStatus("The embedding worker hit an error.", "error");
    self.postMessage({ id, type: "error", error: error.message || "Embedding failed." });
  }
};
