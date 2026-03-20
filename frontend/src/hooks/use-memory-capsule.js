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
import { DEFAULT_PREFERENCES, loadPreferences, savePreferences } from "@/lib/preferences";

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

  return {
    label: labelMap[payload.stage] || "Ready when you are.",
    stage: payload.stage,
  };
}

function createId() {
  return globalThis.crypto?.randomUUID?.() || `memory-${Date.now()}`;
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
    const monoSamples = new Float32Array(audioBuffer.length);

    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
      const channelData = audioBuffer.getChannelData(channel);
      for (let index = 0; index < channelData.length; index += 1) {
        monoSamples[index] += channelData[index] / audioBuffer.numberOfChannels;
      }
    }

    return monoSamples;
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
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);

  useEffect(() => {
    let active = true;

    const loadMemories = async () => {
      try {
        const storedMemories = await getMemories();
        if (active) {
          setMemories(storedMemories);
          setPreferences(loadPreferences());
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

  const processRecording = useCallback(async ({ averageAmplitude, blob, durationMs, frequency }) => {
    try {
      setProcessingState({ stage: "preparing", message: "Getting your memory ready…" });
      const decodedAudio = await decodeAudioBlob(blob);

      setProcessingState({ stage: "transcribing", message: "Turning your words into text…" });
      const transcript = normalizeTranscript(await transcribeAudio(decodedAudio));

      if (!transcript) {
        throw new Error("No speech was detected. Try recording a little longer.");
      }

      setProcessingState({ stage: "embedding", message: "Saving it so you can find it later…" });
      const embedding = await embedText(transcript);

      const memory = {
        id: createId(),
        audioBlob: blob,
        averageAmplitude,
        createdAt: new Date().toISOString(),
        durationMs,
        embedding,
        emotion: detectEmotion(transcript, averageAmplitude),
        frequency,
        summary: summarizeTranscript(transcript),
        tags: buildTags(transcript),
        transcript,
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
  }, []);

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
      savePreferences(nextPreferences);
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