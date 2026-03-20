import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function SettingsPage({ backendHealth, clearAllMemories, memoryCount, modelStatus }) {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(window.matchMedia("(display-mode: standalone)").matches);

  useEffect(() => {
    const handleBeforeInstall = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };

    const handleInstalled = () => setIsInstalled(true);

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  const storageEstimate = useMemo(() => `${memoryCount} local items`, [memoryCount]);

  const handleInstall = async () => {
    if (!installPrompt) {
      return;
    }

    await installPrompt.prompt();
    setInstallPrompt(null);
  };

  const handleClear = async () => {
    if (!window.confirm("Clear every local memory on this device?")) {
      return;
    }

    await clearAllMemories();
  };

  return (
    <section className="page-enter space-y-5 pb-6" data-testid="settings-page">
      <Card className="rounded-[28px] border-[#E8E4DB] bg-[#FDFBF7]/85 shadow-[0_8px_32px_rgba(26,25,24,0.04)]">
        <CardContent className="space-y-4 p-5">
          <div>
            <p className="editorial-label" data-testid="privacy-card-label">
              Privacy and storage
            </p>
            <p className="mt-3 text-sm leading-relaxed text-[#4A4844]" data-testid="privacy-card-text">
              Your recordings, transcripts, summaries, and search vectors are kept in local browser storage first.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[22px] bg-[#F2EFE9] p-4" data-testid="storage-estimate-card">
              <p className="editorial-label">Local storage</p>
              <p className="mt-2 text-lg text-[#1A1918]">{storageEstimate}</p>
            </div>
            <div className="rounded-[22px] bg-[#F2EFE9] p-4" data-testid="backend-health-card">
              <p className="editorial-label">Backend status</p>
              <p className="mt-2 text-lg text-[#1A1918]">{backendHealth.label}</p>
            </div>
          </div>

          <Button
            className="h-12 rounded-2xl bg-[#2A2928] text-[#FDFBF7] hover:bg-[#1A1918]"
            data-testid="clear-memories-button"
            onClick={handleClear}
            type="button"
          >
            Clear local memories
          </Button>
        </CardContent>
      </Card>

      <Card className="rounded-[28px] border-[#E8E4DB] bg-[#FDFBF7]/85 shadow-[0_8px_32px_rgba(26,25,24,0.04)]">
        <CardContent className="space-y-4 p-5">
          <div>
            <p className="editorial-label" data-testid="install-card-label">
              Installable app
            </p>
            <p className="mt-3 text-sm leading-relaxed text-[#4A4844]" data-testid="install-card-text">
              Save Memory Capsule to your home screen for a more focused, app-like experience.
            </p>
          </div>

          <Button
            className="h-12 rounded-2xl border border-[#E8E4DB] bg-white/80 text-[#1A1918] hover:bg-[#F2EFE9]"
            data-testid="install-app-button"
            disabled={!installPrompt || isInstalled}
            onClick={handleInstall}
            type="button"
            variant="outline"
          >
            {isInstalled ? "Already installed" : installPrompt ? "Install app" : "Install prompt not ready yet"}
          </Button>
        </CardContent>
      </Card>

      <Card className="rounded-[28px] border-[#E8E4DB] bg-[#FDFBF7]/85 shadow-[0_8px_32px_rgba(26,25,24,0.04)]">
        <CardContent className="space-y-4 p-5">
          <div>
            <p className="editorial-label" data-testid="models-card-label">
              Local AI status
            </p>
            <p className="mt-3 text-sm leading-relaxed text-[#4A4844]" data-testid="models-card-text">
              {modelStatus.label}
            </p>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}