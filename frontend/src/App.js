import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";

import { BottomNav } from "@/components/ui/bottom-nav";
import { Toaster } from "@/components/ui/sonner";
import { useMemoryCapsule } from "@/hooks/use-memory-capsule";
import AssistantPage from "@/pages/assistant-page";
import HomePage from "@/pages/home-page";
import MemoriesPage from "@/pages/memories-page";
import SettingsPage from "@/pages/settings-page";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const PAGE_COPY = {
  "/": {
    label: "Voice capture",
    title: "A calm space for the memories you speak.",
    description: "Tap once to start, hold for a quick thought, and keep everything on your device first.",
  },
  "/memories": {
    label: "Memory library",
    title: "Your recent voice moments, organized gently.",
    description: "Review transcripts, listen back, and filter by mood, date, or keywords.",
  },
  "/assistant": {
    label: "Local assistant",
    title: "Ask what your memories already know.",
    description: "Search semantically across your saved voice notes without leaving the device-first flow.",
  },
  "/settings": {
    label: "Settings",
    title: "Private by default, installable when you are ready.",
    description: "Manage local storage, app install, and device-side model readiness.",
  },
};

function MemoryCapsuleShell() {
  const location = useLocation();
  const appState = useMemoryCapsule();
  const [backendHealth, setBackendHealth] = useState({ status: "checking", label: "Checking backend" });

  useEffect(() => {
    let active = true;

    const checkBackend = async () => {
      try {
        await axios.get(`${API}/health`);
        if (active) {
          setBackendHealth({ status: "ok", label: "Backend connected" });
        }
      } catch (error) {
        if (active) {
          setBackendHealth({ status: "offline", label: "Backend unavailable" });
        }
      }
    };

    checkBackend();
    return () => {
      active = false;
    };
  }, []);

  const currentCopy = useMemo(() => PAGE_COPY[location.pathname] || PAGE_COPY["/"], [location.pathname]);

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-background text-foreground">
      <div aria-hidden className="memory-noise" />
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top,_rgba(196,112,91,0.12),_transparent_34%),radial-gradient(circle_at_bottom,_rgba(107,142,120,0.16),_transparent_28%)]" />

      <div className="app-shell mx-auto flex min-h-[100dvh] max-w-md flex-col px-4 pb-28 pt-5 sm:px-6">
        <header className="glass-panel page-enter mb-6 rounded-[28px] px-5 py-4" data-testid="app-header">
          <p className="editorial-label" data-testid="page-label">
            {currentCopy.label}
          </p>
          <div className="mt-3 space-y-3">
            <h1 className="text-4xl leading-tight tracking-tighter text-[#1A1918] sm:text-5xl" data-testid="page-title">
              {currentCopy.title}
            </h1>
            <p className="max-w-[28rem] text-sm leading-relaxed text-[#4A4844]" data-testid="page-description">
              {currentCopy.description}
            </p>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-[#6F6A62]">
            <span className="rounded-full border border-[#E8E4DB] bg-white/60 px-3 py-1" data-testid="local-processing-chip">
              On-device processing
            </span>
            <span className="rounded-full border border-[#E8E4DB] bg-white/60 px-3 py-1" data-testid="memory-count-chip">
              {appState.memories.length} memories saved
            </span>
            <span className="rounded-full border border-[#E8E4DB] bg-white/60 px-3 py-1" data-testid="backend-status-chip">
              {backendHealth.label}
            </span>
          </div>
        </header>

        <main className="flex-1">
          <Routes>
            <Route
              path="/"
              element={
                <HomePage
                  memories={appState.memories}
                  processingState={appState.processingState}
                  modelStatus={appState.modelStatus}
                  onProcessRecording={appState.processRecording}
                />
              }
            />
            <Route path="/memories" element={<MemoriesPage isLoading={appState.isLoading} memories={appState.memories} />} />
            <Route
              path="/assistant"
              element={<AssistantPage askAssistant={appState.askAssistant} memories={appState.memories} modelStatus={appState.modelStatus} />}
            />
            <Route
              path="/settings"
              element={
                <SettingsPage
                  backendHealth={backendHealth}
                  clearAllMemories={appState.clearAllMemories}
                  memoryCount={appState.memories.length}
                  modelStatus={appState.modelStatus}
                />
              }
            />
          </Routes>
        </main>

        <BottomNav />
      </div>

      <Toaster position="top-center" />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <MemoryCapsuleShell />
    </BrowserRouter>
  );
}
