import { useCallback, useEffect, useState } from "react";

import { toast } from "@/components/ui/sonner";
import { embedText, subscribeToAIStatus, transcribeAudio, warmupLocalModels } from "@/lib/ai-worker-client";
import { clearMemories, getMemories, saveMemory } from "@/lib/memory-db";
import {
  buildAssistantResponse,
  buildTags,
  detectEmotion,
  sortMemoriesByNewest,
  summarizeTranscript,
  vectorSearch,
} from "@/lib/memory-utils";
import { DEFAULT_PREFERENCES } from "@/lib/preferences-defaults";
import { loadPreferences, savePreferences } from "@/lib/preferences";
import { summarizeWithPromptApi } from "@/lib/prompt-api";

const defaultProcessingState = {
  stage: "idle",
  message: "Ready to capture a new memory.",
};

const defaultModelStatus = {
  stage: "idle",
  label: "Ready when you are.",
};

function toFriendlyModelStatus(payload) {
  const labelMap = {
    embedding: "Organizing your memory…",
    error: "Something needs another try.",
    "loading-embedder": "Getting your memory space ready…",
    "loading-transcriber": "Getting your memory space ready…",
    ready: "Ready when you are.",
    transcribing: "Turning your words into a memory…",
  };

  if (payload.stage === "transcribing" && payload.percent != null) {
    return {
      label: `Transcribing… ${payload.percent}%`,
      stage: payload.stage,
    };
  }

  return {
    label: labelMap[payload.stage] || "Ready when you are.",
    stage: payload.stage,
  };
}

function createId() {
  return globalThis.crypto?.randomUUID?.() || `memory-${Date.now()}`;
}

/** Whisper ISO 639-1 hint from the browser (e.g. en-US → en). */
function getTranscriptionLanguageHint() {
  if (typeof navigator === "undefined" || !navigator.language) {
    return "en";
  }
  return navigator.language.trim().split("-")[0] || "en";
}

/** Whisper / transformers.js ASR expects PCM at this rate (see prepareAudios in @huggingface/transformers). */
const WHISPER_SAMPLE_RATE = 16000;

function mixToMonoFloat32(audioBuffer) {
  const monoSamples = new Float32Array(audioBuffer.length);

  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const channelData = audioBuffer.getChannelData(channel);
    for (let index = 0; index < channelData.length; index += 1) {
      monoSamples[index] += channelData[index] / audioBuffer.numberOfChannels;
    }
  }

  return monoSamples;
}

async function resampleMonoToWhisperRate(monoSamples, sourceSampleRate, durationSeconds) {
  if (sourceSampleRate === WHISPER_SAMPLE_RATE) {
    return monoSamples;
  }

  const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;

  if (!OfflineContext) {
    throw new Error("This browser cannot resample audio for transcription.");
  }

  const frameCount = Math.max(1, Math.ceil(durationSeconds * WHISPER_SAMPLE_RATE));
  const offline = new OfflineContext(1, frameCount, WHISPER_SAMPLE_RATE);
  const srcBuffer = offline.createBuffer(1, monoSamples.length, sourceSampleRate);
  srcBuffer.copyToChannel(monoSamples, 0);

  const source = offline.createBufferSource();
  source.buffer = srcBuffer;
  source.connect(offline.destination);
  source.start(0);

  const rendered = await offline.startRendering();
  return new Float32Array(rendered.getChannelData(0));
}

async function decodeAudioBlob(blob) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    throw new Error("This browser cannot decode recorded audio.");
  }

  const context = new AudioContextClass();

  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await context.decodeAudioData(arrayBuffer);
    const monoSamples = mixToMonoFloat32(audioBuffer);
    return resampleMonoToWhisperRate(monoSamples, audioBuffer.sampleRate, audioBuffer.duration);
  } finally {
    await context.close();
  }
}

function normalizeTranscript(text) {
  return text.replace(/\s+/g, " ").trim();
}

export function useMemoryCapsule() {
  const [memories, setMemories] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [processingState, setProcessingState] = useState(defaultProcessingState);
  const [modelStatus, setModelStatus] = useState(defaultModelStatus);
  const [preferences, setPreferences] = useState(() => ({ ...DEFAULT_PREFERENCES }));

  useEffect(() => {
    let active = true;

    const loadMemories = async () => {
      try {
        const [storedMemories, prefs] = await Promise.all([getMemories(), loadPreferences()]);
        if (active) {
          setMemories(storedMemories);
          setPreferences(prefs);
        }
      } catch (error) {
        toast.error("I couldn't load your saved memories.");
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    loadMemories();

    const unsubscribe = subscribeToAIStatus((payload) => {
      if (active) {
        setModelStatus(toFriendlyModelStatus(payload));
      }
    });

    const warmupTimer = window.setTimeout(() => {
      warmupLocalModels().catch(() => undefined);
    }, 1200);

    return () => {
      active = false;
      window.clearTimeout(warmupTimer);
      unsubscribe();
    };
  }, []);

  const processRecording = useCallback(
    async ({ averageAmplitude, blob, durationMs, frequency }) => {
      const transcriptionStartedAt = performance.now();

      try {
        setProcessingState({ stage: "preparing", message: "Getting your memory ready…" });
        const decodedAudio = await decodeAudioBlob(blob);

        setProcessingState({ stage: "transcribing", message: "Turning your words into text…" });
        const { text: transcriptRaw, transcriptionModel } = await transcribeAudio(decodedAudio, {
          language: getTranscriptionLanguageHint(),
        });
        const transcript = normalizeTranscript(transcriptRaw);
        const transcriptionDuration = Math.round(performance.now() - transcriptionStartedAt);

        if (!transcript) {
          throw new Error("No speech was detected. Try recording a little longer.");
        }

        const prefs = await loadPreferences();

        setProcessingState({ stage: "embedding", message: "Saving it so you can find it later…" });
        const embedding = await embedText(transcript);

        let summary;
        let summarySource = "rule-based";

        if (prefs.useGeminiNano) {
          const result = await summarizeWithPromptApi(transcript);
          summary = result.summary;
          summarySource = result.source;
        } else {
          summary = summarizeTranscript(transcript);
        }

        const memory = {
          id: createId(),
          audioBlob: blob,
          averageAmplitude,
          createdAt: new Date().toISOString(),
          durationMs,
          embedding,
          emotion: detectEmotion(transcript, averageAmplitude),
          frequency,
          summary,
          summarySource,
          tags: buildTags(transcript),
          transcript,
          transcriptionDuration,
          transcriptionModel,
          version: 2,
        };

        await saveMemory(memory);
        setMemories((currentMemories) => sortMemoriesByNewest([memory, ...currentMemories]));
        setProcessingState({ stage: "saved", message: "Saved to your capsule." });
        toast.success("Saved to your capsule.");
        return memory;
      } catch (error) {
        setProcessingState({ stage: "error", message: error.message || "Something went wrong while processing your memory." });
        toast.error(error.message || "I couldn't process that recording.");
        throw error;
      }
    },
    [],
  );

  const askAssistant = useCallback(
    async (query) => {
      if (!query.trim()) {
        return { answer: "Ask a question about your memories.", references: [] };
      }

      if (!memories.length) {
        return { answer: "You have not saved any memories yet.", references: [] };
      }

      const queryEmbedding = await embedText(query);
      const matches = vectorSearch(queryEmbedding, memories, 5);
      return buildAssistantResponse(query, matches, memories);
    },
    [memories],
  );

  const clearAllMemories = useCallback(async () => {
    await clearMemories();
    setMemories([]);
    toast.success("Your capsule was cleared.");
  }, []);

  const updatePreference = useCallback((key, value) => {
    setPreferences((currentPreferences) => {
      const nextPreferences = { ...currentPreferences, [key]: value };
      savePreferences(nextPreferences).catch(() => undefined);
      return nextPreferences;
    });
  }, []);

  return {
    askAssistant,
    clearAllMemories,
    isLoading,
    memories,
    modelStatus,
    preferences,
    processRecording,
    processingState,
    updatePreference,
  };
}
