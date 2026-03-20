import { useMemo } from "react";
import { motion } from "framer-motion";

const EMOTION_COLORS = {
  calm: "#6B8E78",
  energetic: "#C4705B",
  sad: "#8C86AA",
};

function buildWavePath({ amplitude, density, height, offset, width }) {
  const centerY = height / 2;
  const segments = 8;
  const points = Array.from({ length: segments + 1 }, (_, index) => {
    const progress = index / segments;
    const x = progress * width;
    const waveHeight = Math.sin((progress + offset) * Math.PI * (1.8 + density * 4.2)) * amplitude * height * 0.42;
    const drift = Math.cos((progress + offset * 0.8) * Math.PI * 2.1) * height * 0.05;
    return [x, centerY + waveHeight + drift];
  });

  return points.reduce((path, point, index) => {
    if (index === 0) {
      return `M ${point[0]} ${point[1]}`;
    }

    const previous = points[index - 1];
    const controlX = (previous[0] + point[0]) / 2;
    return `${path} Q ${controlX} ${previous[1]} ${point[0]} ${point[1]}`;
  }, "");
}

export function VoiceWave({ amplitude = 0.12, density = 0.2, emotion = "calm", isRecording = false }) {
  const accentColor = EMOTION_COLORS[emotion] || EMOTION_COLORS.calm;

  const paths = useMemo(
    () => [0.18, 0.43, 0.7].map((offset) => buildWavePath({ amplitude: Math.max(amplitude, 0.12), density, height: 180, offset, width: 320 })),
    [amplitude, density],
  );

  return (
    <motion.div
      animate={{ scale: isRecording ? [1, 1.02, 1] : [1, 1.01, 1] }}
      className="wave-shadow relative mx-auto flex h-[19rem] w-full max-w-[19rem] items-center justify-center overflow-hidden rounded-[40px] border border-white/45 bg-white/65"
      data-testid="voice-wave-visual"
      transition={{ duration: isRecording ? 1.2 : 2.4, repeat: Infinity, ease: "easeInOut" }}
    >
      <motion.div
        animate={{ opacity: isRecording ? 0.9 : 0.55, scale: isRecording ? 1.12 : 1.04 }}
        className="absolute inset-6 rounded-[36px]"
        style={{ background: `radial-gradient(circle at center, ${accentColor}55 0%, transparent 68%)` }}
        transition={{ duration: 0.9, repeat: Infinity, repeatType: "reverse" }}
      />

      <div className="relative h-[180px] w-[320px]">
        <svg className="h-full w-full" fill="none" viewBox="0 0 320 180" xmlns="http://www.w3.org/2000/svg">
          {paths.map((path, index) => (
            <motion.path
              animate={{ opacity: isRecording ? [0.48, 0.82, 0.48] : [0.28, 0.42, 0.28], pathLength: [0.96, 1, 0.96] }}
              d={path}
              key={`${path}-${index}`}
              stroke={accentColor}
              strokeLinecap="round"
              strokeWidth={index === 1 ? 6 : 4}
              transition={{ delay: index * 0.12, duration: isRecording ? 0.8 : 1.6, repeat: Infinity, ease: "easeInOut" }}
            />
          ))}
        </svg>
      </div>

      <div className="absolute bottom-5 left-5 rounded-full border border-white/60 bg-white/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6F6A62]" data-testid="voice-wave-state-badge">
        {isRecording ? "Listening" : "Resting"}
      </div>
    </motion.div>
  );
}