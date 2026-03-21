export const DEFAULT_PREFERENCES = {
  captureReminders: false,
  gentleMode: true,
  showSummariesFirst: true,
  useGeminiNano: true, // Default to true with runtime capability detection
  privateMode: false, // forces WASM Whisper, skips Web Speech API
  preferredTranscriptionTier: "auto", // "auto" | "webspeech" | "local"
};
