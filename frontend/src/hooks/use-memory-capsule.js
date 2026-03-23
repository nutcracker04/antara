import { useCallback, useEffect, useState } from "react";

import { toast } from "@/components/ui/sonner";
import { streamAssistantChat } from "@/lib/backend-chat";
import {
  disposeEmbeddingWorker,
  disposeTranscriptionWorker,
  embedText,
  subscribeToAIStatus,
  transcribeAudio,
  warmupLocalModels,
} from "@/lib/ai-worker-client";
import { isConstrainedMobileDevice } from "@/lib/device-profile";
import { clearMemories, getMemories, saveMemory } from "@/lib/memory-db";
import {
  buildAssistantFallback,
  buildTags,
  detectEmotion,
  getAssistantReferences,
  sortMemoriesByNewest,
  summarizeTranscript,
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
    embedding: "Indexing your memory on this device…",
    error: "The on-device assistant needs another try.",
    "loading-embedder": "Preparing local search on this device…",
    "loading-transcriber": "Preparing on-device speech processing…",
    ready: "Ready when you are.",
    transcribing: "Transcribing on this device…",
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

function normalizeTranscript(text) {
  return text.replace(/\s+/g, " ").trim();
}

function replaceMemoryInList(memories, nextMemory) {
  return sortMemoriesByNewest(memories.map((memory) => (memory.id === nextMemory.id ? nextMemory : memory)));
}

export function useMemoryCapsule() {
  const constrainedMobile = isConstrainedMobileDevice();
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
          
          // Lazy re-embedding for migrated memories
          const needsReembed = storedMemories.filter(m => m.embeddingModel === "pending-reembed");
          if (needsReembed.length > 0 && !constrainedMobile) {
            console.log(`[Migration] Found ${needsReembed.length} memories needing re-embedding`);
            
            // Re-embed one at a time when idle
            const reembedOne = async (memory) => {
              try {
                const embedding = await embedText(memory.transcript || memory.summary);
                const updated = { ...memory, embedding, embeddingModel: "bge-small-en-v1.5" };
                await saveMemory(updated);
                
                // Update local state
                setMemories(current => 
                  current.map(m => m.id === memory.id ? updated : m)
                );
                
                console.log(`[Migration] Re-embedded memory ${memory.id}`);
              } catch (error) {
                console.warn(`[Migration] Failed to re-embed ${memory.id}:`, error);
              }
            };
            
            // Process one memory at a time with delays
            const processQueue = async (queue) => {
              if (!active || queue.length === 0) return;
              
              const memory = queue.shift();
              await reembedOne(memory);
              
              // Wait 2 seconds before next one
              setTimeout(() => processQueue(queue), 2000);
            };
            
            // Start processing after a delay
            setTimeout(() => processQueue([...needsReembed]), 3000);
          }
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

    const warmupTimer = constrainedMobile
      ? null
      : window.setTimeout(() => {
          // On constrained mobile browsers, eager-loading both local models
          // makes recording much less stable.
          warmupLocalModels().catch(() => undefined);
        }, 1200);

    return () => {
      active = false;
      if (warmupTimer != null) {
        window.clearTimeout(warmupTimer);
      }
      unsubscribe();
    };
  }, [constrainedMobile]);

  const processRecording = useCallback(
    async ({ audioData, averageAmplitude, durationMs, frequency, speechDurationMs, segmentCount }) => {
      const transcriptionStartedAt = performance.now();

      try {
        console.log(
          `[Processing] Starting - Total: ${durationMs}ms, Speech: ${speechDurationMs}ms, ` +
          `Segments: ${segmentCount}, Amplitude: ${averageAmplitude.toFixed(4)}`
        );
        
        setProcessingState({ stage: "transcribing", message: "Turning your words into text…" });
        
        // Audio is already in the correct format (Float32Array at 16kHz) from VAD!
        // No need to decode or resample
        const { text: transcriptRaw, transcriptionModel } = await transcribeAudio(audioData, {
          language: getTranscriptionLanguageHint(),
        });

        if (constrainedMobile) {
          disposeTranscriptionWorker();
        }
        
        console.log(`[Processing] Raw transcript (${transcriptRaw.length} chars):`, transcriptRaw);
        
        const transcript = normalizeTranscript(transcriptRaw);
        const transcriptionDuration = Math.round(performance.now() - transcriptionStartedAt);

        console.log(`[Processing] Normalized transcript (${transcript.length} chars):`, transcript);
        console.log(`[Processing] Transcription took ${transcriptionDuration}ms using ${transcriptionModel}`);

        if (!transcript) {
          throw new Error("No speech was detected. Try recording a little longer.");
        }

        if (transcript.length < 3) {
          throw new Error("Transcription too short - please speak more clearly or record longer.");
        }

        const prefs = await loadPreferences();
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
          audioData: null, // VAD doesn't produce a blob, we could reconstruct if needed
          averageAmplitude,
          createdAt: new Date().toISOString(),
          durationMs,
          speechDurationMs,
          segmentCount,
          embedding: null,
          emotion: detectEmotion(transcript, averageAmplitude),
          frequency,
          summary,
          summarySource,
          tags: buildTags(transcript),
          transcript,
          transcriptionDuration,
          transcriptionModel,
          embeddingModel: constrainedMobile ? "pending-reembed" : "pending-local-embed",
          version: 3, // Bumped version for VAD-based recordings
        };

        await saveMemory(memory);
        setMemories((currentMemories) => sortMemoriesByNewest([memory, ...currentMemories]));
        setProcessingState({
          stage: constrainedMobile ? "saved" : "embedding",
          message: constrainedMobile
            ? "Saved locally. Finishing the on-device index in the background…"
            : "Saving it so you can find it later…",
        });
        toast.success(constrainedMobile ? "Saved locally on this device." : "Saved to your capsule.");

        const finalizeEmbedding = async () => {
          try {
            const embedding = await embedText(transcript);
            const indexedMemory = {
              ...memory,
              embedding,
              embeddingModel: "bge-small-en-v1.5",
            };

            await saveMemory(indexedMemory);
            setMemories((currentMemories) => replaceMemoryInList(currentMemories, indexedMemory));
            setProcessingState({ stage: "saved", message: "Saved to your capsule." });
          } catch (embeddingError) {
            console.warn("[Processing] Background embedding failed:", embeddingError);
            setProcessingState({
              stage: "saved",
              message: "Saved locally. Search will sharpen up after a stronger device session.",
            });
          } finally {
            if (constrainedMobile) {
              disposeEmbeddingWorker();
            }
          }
        };

        if (constrainedMobile) {
          window.setTimeout(() => {
            void finalizeEmbedding();
          }, 0);
        } else {
          await finalizeEmbedding();
        }
        
        console.log(`[Processing] Memory saved successfully:`, memory.id);
        
        return memory;
      } catch (error) {
        if (constrainedMobile) {
          disposeTranscriptionWorker();
          disposeEmbeddingWorker();
        }
        console.error("[Processing] Error:", error);
        setProcessingState({ stage: "error", message: error.message || "Something went wrong while processing your memory." });
        toast.error(error.message || "I couldn't process that recording.");
        throw error;
      }
    },
    [constrainedMobile],
  );

  const streamAssistantReply = useCallback(
    async ({ history = [], onChunk, query }) => {
      const normalizedQuery = normalizeTranscript(query || "");

      if (!normalizedQuery) {
        return { answer: "Ask a question about your memories.", references: [] };
      }

      if (!memories.length) {
        return { answer: "You have not saved any memories yet.", references: [] };
      }

      const queryEmbedding = await embedText(normalizedQuery);
      const references = getAssistantReferences(normalizedQuery, queryEmbedding, memories);

      if (!references.length) {
        return {
          answer: buildAssistantFallback(normalizedQuery, references),
          references: [],
        };
      }

      const answer = await streamAssistantChat({
        history,
        onChunk,
        query: normalizedQuery,
        references,
      });

      const normalizedAnswer = normalizeTranscript(answer);

      return {
        answer: normalizedAnswer || buildAssistantFallback(normalizedQuery, references),
        references,
      };
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
    clearAllMemories,
    isLoading,
    memories,
    modelStatus,
    preferences,
    processRecording,
    processingState,
    streamAssistantReply,
    updatePreference,
  };
}
