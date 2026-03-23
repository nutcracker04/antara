import { useCallback, useEffect, useRef, useState } from "react";

import { isConstrainedMobileDevice } from "@/lib/device-profile";
import { WakeLockManager } from "@/lib/wake-lock";
import { VADManager } from "@/lib/vad-manager";

const wakeLockManager = new WakeLockManager();
const MOBILE_MAX_RECORDING_MS = 8000;

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function concatFloat32Arrays(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Float32Array(totalLength);
  let offset = 0;

  chunks.forEach((chunk) => {
    result.set(chunk, offset);
    offset += chunk.length;
  });

  return result;
}

export function useRecorder(onRecordingComplete) {
  const [amplitude, setAmplitude] = useState(0.12);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [error, setError] = useState("");
  const [frequency, setFrequency] = useState(0.2);
  const [isRecording, setIsRecording] = useState(false);

  const vadManagerRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);
  const audioContextRef = useRef(null);
  const samplesRef = useRef({ amplitudes: [], frequencies: [] });
  const sourceRef = useRef(null);
  const startTimeRef = useRef(0);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const constrainedMobileRef = useRef(isConstrainedMobileDevice());
  const isRecordingRef = useRef(false);
  const speechSegmentsRef = useRef([]);
  const autoStopTriggeredRef = useRef(false);

  const monitorLevels = useCallback(() => {
    if (!analyserRef.current) {
      return;
    }

    const analyser = analyserRef.current;
    const frequencyData = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(frequencyData);

    const lowBand = frequencyData.slice(0, 18);
    const highBand = frequencyData.slice(18, 60);
    const nextAmplitude = average([...lowBand, ...highBand]) / 255;
    const nextFrequency = average(highBand) / 255;

    setAmplitude(nextAmplitude);
    setFrequency(nextFrequency);

    samplesRef.current.amplitudes.push(nextAmplitude);
    samplesRef.current.frequencies.push(nextFrequency);

    animationFrameRef.current = requestAnimationFrame(monitorLevels);
  }, []);

  const stopRecording = useCallback(async () => {
    if (!isRecordingRef.current) {
      return;
    }

    // Stop VAD and get all captured segments
    const vadResult = await vadManagerRef.current?.stop();
    
    setIsRecording(false);
    isRecordingRef.current = false;
    wakeLockManager.releaseWakeLock().catch(() => undefined);

    // Clean up audio analysis
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
    }

    sourceRef.current?.disconnect();
    analyserRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());

    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => undefined);
    }

    // Calculate stats
    const durationMs = Date.now() - startTimeRef.current;
    const averageAmplitude = average(samplesRef.current.amplitudes);
    const averageFrequency = average(samplesRef.current.frequencies);

    // Reset state
    setAmplitude(0.12);
    setFrequency(0.2);
    setDurationSeconds(0);
    analyserRef.current = null;
    sourceRef.current = null;
    streamRef.current = null;
    audioContextRef.current = null;

    const vadSegments = (vadResult?.segments || speechSegmentsRef.current || [])
      .map((segment) => segment?.audio || segment)
      .filter((segment) => segment instanceof Float32Array && segment.length > 0);

    const finalAudio = vadSegments.length ? concatFloat32Arrays(vadSegments) : new Float32Array(0);
    const segmentCount = vadSegments.length;
    speechSegmentsRef.current = [];
    autoStopTriggeredRef.current = false;

    if (finalAudio.length === 0) {
      console.warn("[Recorder] No VAD speech segments captured");
      setError("No speech detected by the on-device listener. Please try again in a quieter space or speak a little closer.");
      return;
    }

    // Check minimum speech duration (at least 0.5 seconds)
    const speechDurationMs = (finalAudio.length / 16000) * 1000;
    if (speechDurationMs < 500) {
      console.warn(`[Recorder] Speech too short: ${speechDurationMs}ms`);
      setError("Recording too short - please speak for at least half a second.");
      return;
    }

    console.log(
      `[Recorder] Captured ${segmentCount} speech segments, ` +
      `${(speechDurationMs / 1000).toFixed(2)}s of speech from ${(durationMs / 1000).toFixed(2)}s total`
    );

    // Call completion callback with VAD-processed audio
    if (onRecordingComplete) {
      console.log("[Recorder] Calling onRecordingComplete with audio data");
      await onRecordingComplete({
        audioData: finalAudio, // Float32Array at 16kHz - ready for Whisper!
        averageAmplitude,
        durationMs,
        frequency: averageFrequency,
        speechDurationMs,
        segmentCount,
      });
    } else {
      console.warn("[Recorder] No onRecordingComplete callback provided");
    }
  }, [onRecordingComplete]);

  const startRecording = useCallback(async () => {
    if (isRecording) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Your browser does not support voice capture.");
      return;
    }

    try {
      setError("");
      speechSegmentsRef.current = [];
      await wakeLockManager.requestWakeLock();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Initialize VAD Manager
      vadManagerRef.current = new VADManager((audioSegment) => {
        // Callback for each speech segment detected
        console.log(`[Recorder] Speech segment captured: ${audioSegment.length} samples`);
        speechSegmentsRef.current.push(audioSegment);
      });

      // Start VAD using the same microphone stream as the visualizer.
      await vadManagerRef.current.start(stream);

      // Set up audio analysis for visual feedback (amplitude/frequency)
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;

      if (!AudioContextClass) {
        throw new Error("Your browser cannot analyze audio input.");
      }

      const audioContext = new AudioContextClass();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.85;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      samplesRef.current = { amplitudes: [], frequencies: [] };
      startTimeRef.current = Date.now();
      streamRef.current = stream;
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      sourceRef.current = source;

      setIsRecording(true);
      isRecordingRef.current = true;
      setDurationSeconds(0);
      monitorLevels();

      timerRef.current = window.setInterval(() => {
        const elapsedMs = Date.now() - startTimeRef.current;
        setDurationSeconds(Math.round(elapsedMs / 1000));

        if (
          constrainedMobileRef.current &&
          !autoStopTriggeredRef.current &&
          elapsedMs >= MOBILE_MAX_RECORDING_MS
        ) {
          autoStopTriggeredRef.current = true;
          void stopRecording();
        }
      }, 250);

      console.log("[Recorder] Started recording with VAD");
    } catch (recordingError) {
      await wakeLockManager.releaseWakeLock();
      
      // Clean up VAD if it was started
      if (vadManagerRef.current) {
        vadManagerRef.current.stop();
        vadManagerRef.current = null;
      }

      setError(recordingError.message || "Microphone access was not granted.");
      console.error("[Recorder] Error starting recording:", recordingError);
    }
  }, [isRecording, monitorLevels, stopRecording]);

  useEffect(() => {
    const onVisibility = () => {
      wakeLockManager.handleVisibilityChange(isRecordingRef.current).catch(() => undefined);
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => () => {
    // Cleanup function - make it async-safe
    (async () => {
      await stopRecording();
      
      // Clean up VAD
      if (vadManagerRef.current) {
        await vadManagerRef.current.stop();
        vadManagerRef.current = null;
      }
      
      wakeLockManager.releaseWakeLock().catch(() => undefined);
    })();
  }, [stopRecording]);

  return {
    amplitude,
    durationSeconds,
    error,
    frequency,
    isRecording,
    startRecording,
    stopRecording,
  };
}
