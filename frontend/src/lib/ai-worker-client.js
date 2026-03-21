let transcriptionWorker;
let embeddingWorker;
let requestCount = 0;

const pendingRequests = new Map();
const statusListeners = new Set();

function notifyStatus(payload) {
  statusListeners.forEach((listener) => listener(payload));
}

function rejectAllPending(message) {
  pendingRequests.forEach(({ reject }) => reject(new Error(message)));
  pendingRequests.clear();
}

function createWorkerHandler(worker, workerName) {
  worker.onmessage = (event) => {
    const { id, type, payload, error } = event.data;

    if (type === "status") {
      notifyStatus(payload);
      return;
    }

    if (type === "progress") {
      notifyStatus({
        stage: "transcribing",
        label: `Transcribing… ${payload.percent}%`,
        percent: payload.percent,
      });
      return;
    }

    if (type === "chunk") {
      // Handle streaming chunk responses
      const request = pendingRequests.get(id);
      if (request && request.onChunk) {
        request.onChunk(payload);
      }
      return;
    }

    const request = pendingRequests.get(id);
    if (!request) {
      return;
    }

    pendingRequests.delete(id);

    if (type === "error") {
      request.reject(new Error(error || `${workerName} request failed.`));
      return;
    }

    request.resolve(payload);
  };

  worker.onerror = (event) => {
    console.error(`[AI Worker Client] ${workerName} error:`, event);
    
    // Check if this is the HTML parsing error (worker file not found)
    if (event.message && event.message.includes("Unexpected token '<'")) {
      const errorMsg = `${workerName} failed to load. The worker file may not be accessible. Check that the file exists in the public/ directory and the dev server is serving it correctly.`;
      notifyStatus({ stage: "error", label: errorMsg });
      rejectAllPending(errorMsg);
    } else {
      notifyStatus({ stage: "error", label: `${workerName} stopped unexpectedly.` });
      rejectAllPending(event.message || `${workerName} stopped unexpectedly.`);
    }
  };
}

function getTranscriptionWorker() {
  if (transcriptionWorker) {
    console.log("[AI Worker Client] Reusing existing transcription worker");
    return transcriptionWorker;
  }

  if (typeof Worker === "undefined") {
    throw new Error("Web Workers are not supported in this browser");
  }

  const workerUrl = `${process.env.PUBLIC_URL || ""}/transcription-worker.js`;
  console.log("[AI Worker Client] Creating transcription worker from:", workerUrl);
  console.log("[AI Worker Client] process.env.PUBLIC_URL:", process.env.PUBLIC_URL);
  console.log("[AI Worker Client] window.location.origin:", window.location.origin);
  
  transcriptionWorker = new Worker(workerUrl, { type: "module" });
  createWorkerHandler(transcriptionWorker, "Transcription worker");
  console.log("[AI Worker Client] Transcription worker created successfully");

  return transcriptionWorker;
}

function getEmbeddingWorker() {
  if (embeddingWorker) {
    console.log("[AI Worker Client] Reusing existing embedding worker");
    return embeddingWorker;
  }

  if (typeof Worker === "undefined") {
    throw new Error("Web Workers are not supported in this browser");
  }

  const workerUrl = `${process.env.PUBLIC_URL || ""}/embedding-worker.js`;
  console.log("[AI Worker Client] Creating embedding worker from:", workerUrl);
  
  embeddingWorker = new Worker(workerUrl, { type: "module" });
  createWorkerHandler(embeddingWorker, "Embedding worker");
  console.log("[AI Worker Client] Embedding worker created successfully");

  return embeddingWorker;
}

function sendMessage(workerType, type, payload = {}) {
  return new Promise((resolve, reject) => {
    console.log(`[AI Worker Client] Sending ${type} to ${workerType} worker`);
    
    const worker = workerType === "transcription" 
      ? getTranscriptionWorker() 
      : getEmbeddingWorker();

    if (!worker) {
      const error = new Error("This browser does not support Web Workers.");
      console.error("[AI Worker Client]", error);
      reject(error);
      return;
    }

    const id = `ai-${requestCount + 1}`;
    requestCount += 1;
    pendingRequests.set(id, { resolve, reject });

    const transferables = [];
    if (payload.audioData instanceof Float32Array) {
      transferables.push(payload.audioData.buffer);
    }

    console.log(`[AI Worker Client] Posting message ${id} to ${workerType} worker`);
    worker.postMessage({ id, type, payload }, transferables);
  });
}

export function subscribeToAIStatus(listener) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

export async function warmupLocalModels() {
  // Warmup both workers in parallel
  await Promise.all([
    sendMessage("transcription", "WARMUP"),
    sendMessage("embedding", "WARMUP"),
  ]);
}

export async function transcribeAudio(audioData, options = {}) {
  const { language } = options;
  const response = await sendMessage("transcription", "TRANSCRIBE", { audioData, language });
  return {
    text: response.text || "",
    chunks: response.chunks || null,
    transcriptionModel: response.transcriptionModel || "distil-whisper-base|wasm|q8",
  };
}

export async function embedText(text) {
  const response = await sendMessage("embedding", "EMBED", { text });
  return response.embedding || [];
}

// Alias for migration code compatibility
export const getEmbedding = embedText;
