let workerInstance;
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

function getWorker() {
  if (workerInstance || typeof Worker === "undefined") {
    return workerInstance;
  }

  const workerUrl = `${process.env.PUBLIC_URL || ""}/ai-worker.js`;
  workerInstance = new Worker(workerUrl, { type: "module" });

  workerInstance.onmessage = (event) => {
    const { id, type, payload, error } = event.data;

    if (type === "status") {
      notifyStatus(payload);
      return;
    }

    const request = pendingRequests.get(id);
    if (!request) {
      return;
    }

    pendingRequests.delete(id);

    if (type === "error") {
      request.reject(new Error(error || "Local AI request failed."));
      return;
    }

    request.resolve(payload);
  };

  workerInstance.onerror = (event) => {
    notifyStatus({ stage: "error", label: "The local AI worker stopped unexpectedly." });
    rejectAllPending(event.message || "The local AI worker stopped unexpectedly.");
  };

  return workerInstance;
}

function sendMessage(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const worker = getWorker();

    if (!worker) {
      reject(new Error("This browser does not support Web Workers."));
      return;
    }

    const id = `ai-${requestCount + 1}`;
    requestCount += 1;
    pendingRequests.set(id, { resolve, reject });

    const transferables = [];
    if (payload.audioData instanceof Float32Array) {
      transferables.push(payload.audioData.buffer);
    }

    worker.postMessage({ id, type, payload }, transferables);
  });
}

export function subscribeToAIStatus(listener) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

export function warmupLocalModels() {
  return sendMessage("WARMUP");
}

export async function transcribeAudio(audioData) {
  const response = await sendMessage("TRANSCRIBE", { audioData });
  return response.text || "";
}

export async function embedText(text) {
  const response = await sendMessage("EMBED", { text });
  return response.embedding || [];
}