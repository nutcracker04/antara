import { useCallback, useEffect, useRef, useState } from "react";

import { WakeLockManager } from "@/lib/wake-lock";

const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

const wakeLockManager = new WakeLockManager();

function getSupportedMimeType() {
  return MIME_TYPES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function useRecorder(onRecordingComplete) {
  const [amplitude, setAmplitude] = useState(0.12);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [error, setError] = useState("");
  const [frequency, setFrequency] = useState(0.2);
  const [isRecording, setIsRecording] = useState(false);

  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);
  const audioContextRef = useRef(null);
  const chunksRef = useRef([]);
  const mediaRecorderRef = useRef(null);
  const samplesRef = useRef({ amplitudes: [], frequencies: [] });
  const sourceRef = useRef(null);
  const startTimeRef = useRef(0);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const isRecordingRef = useRef(false);

  const cleanupAudioGraph = useCallback(async () => {
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
      await audioContextRef.current.close();
    }

    analyserRef.current = null;
    animationFrameRef.current = null;
    audioContextRef.current = null;
    sourceRef.current = null;
    streamRef.current = null;
    timerRef.current = null;
  }, []);

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

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      return;
    }

    recorder.stop();
    setIsRecording(false);
    isRecordingRef.current = false;
    wakeLockManager.releaseWakeLock().catch(() => undefined);
  }, []);

  const startRecording = useCallback(async () => {
    if (isRecording) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Your browser does not support voice capture.");
      return;
    }

    try {
      setError("");
      await wakeLockManager.requestWakeLock();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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

      const mimeType = getSupportedMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      chunksRef.current = [];
      samplesRef.current = { amplitudes: [], frequencies: [] };
      startTimeRef.current = Date.now();
      streamRef.current = stream;
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      sourceRef.current = source;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const durationMs = Date.now() - startTimeRef.current;
        const averageAmplitude = average(samplesRef.current.amplitudes);
        const averageFrequency = average(samplesRef.current.frequencies);

        await cleanupAudioGraph();
        setAmplitude(0.12);
        setFrequency(0.2);
        setDurationSeconds(0);

        if (blob.size && onRecordingComplete) {
          await onRecordingComplete({
            averageAmplitude,
            blob,
            durationMs,
            frequency: averageFrequency,
          });
        }
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      isRecordingRef.current = true;
      setDurationSeconds(0);
      monitorLevels();

      timerRef.current = window.setInterval(() => {
        setDurationSeconds(Math.round((Date.now() - startTimeRef.current) / 1000));
      }, 250);
    } catch (recordingError) {
      await wakeLockManager.releaseWakeLock();
      await cleanupAudioGraph();
      setError(recordingError.message || "Microphone access was not granted.");
    }
  }, [cleanupAudioGraph, isRecording, monitorLevels, onRecordingComplete]);

  useEffect(() => {
    const onVisibility = () => {
      wakeLockManager.handleVisibilityChange(isRecordingRef.current).catch(() => undefined);
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => () => {
    stopRecording();
    cleanupAudioGraph();
    wakeLockManager.releaseWakeLock().catch(() => undefined);
  }, [cleanupAudioGraph, stopRecording]);

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