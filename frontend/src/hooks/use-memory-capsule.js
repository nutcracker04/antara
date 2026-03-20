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

const defaultProcessingState = {
  stage: "idle",
  message: "Ready to capture a new memory.",
};

const defaultModelStatus = {
  stage: "idle",
  label: "Local models load when needed.",
};

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

  useEffect(() => {
    let active = true;

    const loadMemories = async () => {
      try {
        const storedMemories = await getMemories();
        if (active) {
          setMemories(storedMemories);
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
        setModelStatus(payload);
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
      setProcessingState({ stage: "preparing", message: "Preparing your voice note locally…" });
      const decodedAudio = await decodeAudioBlob(blob);

      setProcessingState({ stage: "transcribing", message: "Transcribing on this device…" });
      const transcript = normalizeTranscript(await transcribeAudio(decodedAudio));

      if (!transcript) {
        throw new Error("No speech was detected. Try recording a little longer.");
      }

      setProcessingState({ stage: "embedding", message: "Creating a memory fingerprint for local search…" });
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
      setProcessingState({ stage: "saved", message: "Saved locally. It stays on this device first." });
      toast.success("Memory saved on this device.");
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
    toast.success("All local memories were cleared.");
  }, []);

  return {
    askAssistant,
    clearAllMemories,
    isLoading,
    memories,
    modelStatus,
    processRecording,
    processingState,
  };
}