import { useEffect, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import SiriWave from "siriwave";

const PALETTES = {
  calm: {
    background: "linear-gradient(180deg, rgba(255,255,255,0.92), rgba(245,249,247,0.88))",
    border: "rgba(149, 183, 167, 0.42)",
    glow: "rgba(167, 214, 192, 0.36)",
    lines: ["rgba(141, 186, 165, 0.24)", "rgba(110, 154, 132, 0.46)", "rgba(74, 122, 101, 0.82)"],
  },
  energetic: {
    background: "linear-gradient(180deg, rgba(255,255,255,0.92), rgba(252,244,240,0.9))",
    border: "rgba(220, 144, 118, 0.4)",
    glow: "rgba(244, 181, 160, 0.34)",
    lines: ["rgba(236, 177, 156, 0.24)", "rgba(214, 122, 91, 0.46)", "rgba(192, 97, 66, 0.84)"],
  },
  sad: {
    background: "linear-gradient(180deg, rgba(255,255,255,0.92), rgba(243,246,252,0.9))",
    border: "rgba(143, 159, 197, 0.38)",
    glow: "rgba(189, 204, 234, 0.34)",
    lines: ["rgba(194, 204, 229, 0.26)", "rgba(128, 145, 182, 0.46)", "rgba(95, 113, 154, 0.82)"],
  },
};

function getWaveAmplitude(amplitude, isRecording) {
  if (!isRecording) {
    return 0;
  }

  return Math.min(0.72, Math.max(0.16, amplitude * 1.45));
}

function getWaveSpeed(density, isRecording) {
  if (!isRecording) {
    return 0;
  }

  return Math.min(0.12, Math.max(0.06, 0.06 + density * 0.08));
}

export function VoiceWave({ amplitude = 0.12, density = 0.2, emotion = "calm", isRecording = false }) {
  const containerRef = useRef(null);
  const waveRef = useRef(null);
  const palette = PALETTES[emotion] || PALETTES.calm;

  const curveDefinition = useMemo(
    () => [
      { attenuation: -2, color: palette.lines[0], lineWidth: 1.2, opacity: 1 },
      { attenuation: 1.6, color: palette.lines[1], lineWidth: 2, opacity: 1 },
      { attenuation: 0.8, color: palette.lines[2], lineWidth: 2.8, opacity: 1 },
    ],
    [palette.lines],
  );

  useEffect(() => {
    if (!containerRef.current) {
      return undefined;
    }

    waveRef.current?.dispose();
    waveRef.current = new SiriWave({
      amplitude: 0,
      autostart: false,
      color: palette.lines[2],
      container: containerRef.current,
      curveDefinition,
      height: 140,
      lerpSpeed: 0.045,
      pixelDepth: 0.01,
      speed: 0.06,
      style: "ios",
      width: 280,
    });

    return () => {
      waveRef.current?.dispose();
      waveRef.current = null;
    };
  }, [curveDefinition, palette.lines]);

  useEffect(() => {
    if (!waveRef.current) {
      return;
    }

    if (isRecording) {
      waveRef.current.start();
      waveRef.current.setAmplitude(getWaveAmplitude(amplitude, true));
      waveRef.current.setSpeed(getWaveSpeed(density, true));
      return;
    }

    waveRef.current.setAmplitude(0);
    waveRef.current.setSpeed(0);
    waveRef.current.stop();
  }, [amplitude, density, isRecording]);

  return (
    <motion.div
      animate={{
        background: palette.background,
        borderColor: palette.border,
        boxShadow: isRecording
          ? `0 24px 54px ${palette.glow}, inset 0 1px 0 rgba(255,255,255,0.78)`
          : "0 18px 38px rgba(26,25,24,0.06), inset 0 1px 0 rgba(255,255,255,0.74)",
      }}
      className="relative mx-auto flex aspect-square w-full max-w-[20rem] items-center justify-center overflow-hidden rounded-[32px] border"
      data-testid="voice-wave-visual"
      transition={{ duration: 0.45, ease: "easeOut" }}
    >
      <motion.div
        animate={{
          opacity: isRecording ? [0.55, 0.95, 0.55] : [0.22, 0.35, 0.22],
          scale: isRecording ? [0.96, 1.04, 0.96] : [0.98, 1, 0.98],
        }}
        className="pointer-events-none absolute inset-[18%] rounded-full blur-3xl"
        style={{ background: `radial-gradient(circle, ${palette.glow} 0%, rgba(255,255,255,0) 72%)` }}
        transition={{ duration: isRecording ? 2 : 3.2, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="relative flex h-full w-full flex-col items-center justify-center gap-5 px-5 py-6">
        <div className="flex h-[9rem] w-full items-center justify-center overflow-hidden rounded-[26px] bg-white/28">
          <motion.div
            animate={{
              opacity: isRecording ? 0 : 1,
              scaleX: isRecording ? 0.92 : 1,
            }}
            className="pointer-events-none absolute h-px w-[10.5rem] rounded-full"
            style={{
              background: `linear-gradient(90deg, transparent, ${palette.lines[1]}, ${palette.lines[2]}, ${palette.lines[1]}, transparent)`,
              boxShadow: `0 0 18px ${palette.glow}`,
            }}
            transition={{ duration: 0.28, ease: "easeOut" }}
          />
          <motion.div
            animate={{ opacity: isRecording ? 1 : 0 }}
            className="h-[140px] w-[280px]"
            transition={{ duration: 0.32, ease: "easeOut" }}
          >
            <div className="h-[140px] w-[280px]" ref={containerRef} />
          </motion.div>
        </div>

        <div
          className="rounded-full border bg-white/72 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6B6A66]"
          data-testid="voice-wave-state-badge"
          style={{ borderColor: palette.border }}
        >
          {isRecording ? "Listening" : "Ready"}
        </div>
      </div>
    </motion.div>
  );
}
