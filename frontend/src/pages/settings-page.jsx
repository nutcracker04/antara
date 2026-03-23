import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InstallCallout } from "@/components/ui/install-callout";
import { isPromptApiAvailable } from "@/lib/prompt-api";

const PREFERENCE_ITEMS = [
  {
    description: "Use softer language and a calmer feel across the app.",
    key: "gentleMode",
    title: "Gentle mode",
  },
  {
    description: "Lead each saved memory with the short takeaway before the full transcript.",
    key: "showSummariesFirst",
    title: "Summaries first",
  },
  {
    description: "Show a gentle prompt on the home screen when you want help starting.",
    key: "captureReminders",
    title: "Capture reminders",
  },
  {
    description: "When supported (Chrome with on-device AI), use the browser’s built-in model for summaries. Otherwise we keep the simple local summary.",
    key: "useGeminiNano",
    title: "On-device summaries",
    requiresPromptApi: true,
  },
];

export default function SettingsPage({ clearAllMemories, memoryCount, preferences, pwaInstall, updatePreference }) {
  const [promptApiReady, setPromptApiReady] = useState(false);

  useEffect(() => {
    isPromptApiAvailable().then(setPromptApiReady).catch(() => setPromptApiReady(false));
  }, []);

  const capsuleSize = useMemo(() => `${memoryCount} saved ${memoryCount === 1 ? "memory" : "memories"}`, [memoryCount]);

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
              Your capsule
            </p>
            <p className="mt-3 text-sm leading-relaxed text-[#4A4844]" data-testid="privacy-card-text">
              Keep your memories close, shape the feel of the app, and make this space work the way you remember best.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[22px] bg-[#F2EFE9] p-4" data-testid="storage-estimate-card">
              <p className="editorial-label">Saved so far</p>
              <p className="mt-2 text-lg text-[#1A1918]">{capsuleSize}</p>
            </div>
            <div className="rounded-[22px] bg-[#F2EFE9] p-4" data-testid="privacy-promise-card">
              <p className="editorial-label">Privacy promise</p>
              <p className="mt-2 text-lg text-[#1A1918]">Private by default</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-[28px] border-[#E8E4DB] bg-[#FDFBF7]/85 shadow-[0_8px_32px_rgba(26,25,24,0.04)]">
        <CardContent className="space-y-4 p-5">
          <InstallCallout
            canInstall={pwaInstall.canInstall}
            installHelp={pwaInstall.installHelp}
            isInstalled={pwaInstall.isInstalled}
            onInstall={() => void pwaInstall.triggerInstall()}
            variant="compact"
          />
        </CardContent>
      </Card>

      <Card className="rounded-[28px] border-[#E8E4DB] bg-[#FDFBF7]/85 shadow-[0_8px_32px_rgba(26,25,24,0.04)]">
        <CardContent className="space-y-4 p-5">
          <div>
            <p className="editorial-label" data-testid="models-card-label">
              App feel
            </p>
            <p className="mt-3 text-sm leading-relaxed text-[#4A4844]" data-testid="models-card-text">
              Choose how Memory Capsule should greet, organize, and support you.
            </p>
          </div>

          <div className="space-y-3" data-testid="preferences-list">
            {PREFERENCE_ITEMS.map((item) => {
              const enabled = preferences[item.key];
              const disabledByApi = item.requiresPromptApi && !promptApiReady;

              return (
                <div className="flex items-center justify-between gap-3 rounded-[22px] bg-[#F2EFE9] p-4" data-testid={`preference-row-${item.key}`} key={item.key}>
                  <div>
                    <p className="text-base text-[#1A1918]">{item.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-[#4A4844]">{item.description}</p>
                    {disabledByApi ? (
                      <p className="mt-2 text-xs text-[#6F6A62]">Not available in this browser yet. We will use the built-in short summary instead.</p>
                    ) : null}
                  </div>
                  <button
                    className={`min-w-[88px] rounded-full px-3 py-2 text-xs font-semibold transition-transform duration-200 ${enabled ? "bg-[#2A2928] text-[#FDFBF7]" : "bg-white text-[#1A1918]"} ${disabledByApi ? "opacity-50" : ""}`}
                    data-testid={`preference-toggle-${item.key}`}
                    disabled={disabledByApi}
                    onClick={() => updatePreference(item.key, !enabled)}
                    type="button"
                  >
                    {enabled ? "On" : "Off"}
                  </button>
                </div>
              );
            })}
          </div>

          <Button
            className="h-12 rounded-2xl bg-[#2A2928] text-[#FDFBF7] hover:bg-[#1A1918]"
            data-testid="clear-memories-button"
            onClick={handleClear}
            type="button"
          >
            Clear all memories
          </Button>
        </CardContent>
      </Card>
    </section>
  );
}
