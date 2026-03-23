import { useEffect, useMemo, useState } from "react";

import { captureInstallPrompt, getInstallInstructions, isInstalledPWA, promptInstall } from "@/lib/pwa-install";

export function usePwaInstall() {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(() => (typeof window !== "undefined" ? isInstalledPWA() : false));

  useEffect(() => {
    const handleBeforeInstall = (event) => {
      setInstallPrompt(captureInstallPrompt(event));
    };

    const handleInstalled = () => {
      setInstallPrompt(null);
      setIsInstalled(true);
    };

    const handleVisibility = () => {
      setIsInstalled(isInstalledPWA());
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleInstalled);
    window.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleInstalled);
      window.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const installHelp = useMemo(() => getInstallInstructions(), []);

  const canInstall = Boolean(installPrompt) && !isInstalled;

  const triggerInstall = async () => {
    const outcome = await promptInstall(installPrompt);
    if (outcome === "accepted") {
      setInstallPrompt(null);
      setIsInstalled(true);
    }

    return outcome;
  };

  return {
    canInstall,
    installHelp,
    isInstalled,
    triggerInstall,
  };
}
