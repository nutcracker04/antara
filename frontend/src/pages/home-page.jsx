import { useMemo, useRef } from "react";

import { MemoryCard } from "@/components/ui/memory-card";
import { VoiceWave } from "@/components/ui/voice-wave";
import { useRecorder } from "@/hooks/use-recorder";

export default function HomePage({ memories, modelStatus, onProcessRecording, preferences, processingState }) {
  const holdTimerRef = useRef(null);
  const holdTriggeredRef = useRef(false);
  const suppressClickRef = useRef(false);

  const { amplitude, durationSeconds, error, frequency, isRecording, startRecording, stopRecording } = useRecorder(onProcessRecording);

  const activeEmotion = useMemo(() => {
    if (processingState.stage === "error") {
      return "sad";
    }

    if (!isRecording) {
      return memories[0]?.emotion || "calm";
    }

    return frequency > 0.34 || amplitude > 0.34 ? "energetic" : "calm";
  }, [amplitude, frequency, isRecording, memories, processingState.stage]);

  const handlePointerDown = () => {
    suppressClickRef.current = false;
    holdTimerRef.current = window.setTimeout(async () => {
      holdTriggeredRef.current = true;
      await startRecording();
    }, 220);
  };

  const handlePointerUp = () => {
    window.clearTimeout(holdTimerRef.current);
    if (holdTriggeredRef.current) {
      holdTriggeredRef.current = false;
      suppressClickRef.current = true;
      stopRecording();
    }
  };

  const handleTapToggle = async () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }

    if (isRecording) {
      stopRecording();
      return;
    }

    await startRecording();
  };

  return (
    <section className="page-enter space-y-6 pb-6" data-testid="home-page">
      <div className="glass-panel rounded-[32px] p-5">
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="editorial-label" data-testid="recording-instructions-label">
                Capture a moment
              </p>
              <p className="mt-2 text-sm leading-relaxed text-[#4A4844]" data-testid="recording-instructions-text">
                Tap to begin and end a memory. Hold when you only want to catch a quick thought.
              </p>
            </div>

            <div className="rounded-[24px] border border-[#E8E4DB] bg-white/70 px-4 py-3 text-right">
              <p className="editorial-label" data-testid="recording-duration-label">
                Duration
              </p>
              <p className="mt-1 text-2xl text-[#1A1918]" data-testid="recording-duration-value">
                {durationSeconds}s
              </p>
            </div>
          </div>

          <button
            className="block w-full rounded-[40px] border-0 bg-transparent p-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2A2928] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FDFBF7]"
            data-testid="record-button"
            onClick={handleTapToggle}
            onPointerCancel={handlePointerUp}
            onPointerDown={handlePointerDown}
            onPointerLeave={handlePointerUp}
            onPointerUp={handlePointerUp}
            type="button"
          >
            <VoiceWave amplitude={amplitude} density={frequency} emotion={activeEmotion} isRecording={isRecording} />
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-[#E8E4DB] bg-white/65 px-3 py-2 text-xs text-[#4A4844]" data-testid="processing-stage-chip">
              {processingState.message}
            </span>
            <span className="rounded-full border border-[#E8E4DB] bg-white/65 px-3 py-2 text-xs text-[#4A4844]" data-testid="model-status-chip">
              {modelStatus.label}
            </span>
        {preferences.gentleMode ? (
              <span className="rounded-full border border-[#E8E4DB] bg-white/65 px-3 py-2 text-xs text-[#4A4844]" data-testid="gentle-mode-chip">
                Gentle mode is on
              </span>
            ) : null}
          </div>

          {error ? (
            <p className="rounded-[24px] border border-[#F0D8CF] bg-[#FBF2EF] px-4 py-3 text-sm text-[#8D4936]" data-testid="recording-error-message">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3" data-testid="home-insights-grid">
        <div className="glass-panel rounded-[24px] p-4" data-testid="insight-total-memories-card">
          <p className="editorial-label">Saved</p>
          <p className="mt-2 text-2xl text-[#1A1918]">{memories.length}</p>
          <p className="mt-1 text-sm text-[#4A4844]">moments in your capsule</p>
        </div>
        <div className="glass-panel rounded-[24px] p-4" data-testid="insight-last-mood-card">
          <p className="editorial-label">Latest tone</p>
          <p className="mt-2 text-2xl capitalize text-[#1A1918]">{memories[0]?.emotion || "Calm"}</p>
          <p className="mt-1 text-sm text-[#4A4844]">how your most recent note felt</p>
        </div>
        <div className="glass-panel rounded-[24px] p-4" data-testid="insight-home-view-card">
          <p className="editorial-label">Home view</p>
          <p className="mt-2 text-2xl text-[#1A1918]">{preferences.showSummariesFirst ? "Summary" : "Transcript"}</p>
          <p className="mt-1 text-sm text-[#4A4844]">what Memory Capsule highlights first</p>
        </div>
      </div>

      {preferences.captureReminders ? (
        <div className="glass-panel rounded-[24px] p-4" data-testid="capture-reminder-card">
          <p className="editorial-label">Gentle prompt</p>
          <p className="mt-2 text-lg text-[#1A1918]">What felt worth remembering today?</p>
          <p className="mt-1 text-sm leading-relaxed text-[#4A4844]">Use it whenever you want a nudge before recording.</p>
        </div>
      ) : null}

      <div className="space-y-4" data-testid="recent-memories-section">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="editorial-label" data-testid="recent-memories-label">
              Your latest memory
            </p>
            <p className="mt-2 text-sm text-[#4A4844]" data-testid="recent-memories-copy">
              The newest voice moment you save will appear here, ready to revisit whenever you need it.
            </p>
          </div>
          <div className="rounded-full border border-[#E8E4DB] bg-white/70 px-3 py-1 text-sm text-[#1A1918]" data-testid="recent-memory-count">
            {memories.length} saved
          </div>
        </div>

        {memories[0] ? (
          <MemoryCard memory={memories[0]} showSummariesFirst={preferences.showSummariesFirst} />
        ) : (
          <div className="glass-panel rounded-[28px] p-5" data-testid="empty-home-state">
            <p className="text-lg text-[#1A1918]">Nothing recorded yet.</p>
            <p className="mt-2 text-sm leading-relaxed text-[#4A4844]">
              Capture a thought, a meeting note, or a feeling. Your first memory will turn this space into something personal.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}