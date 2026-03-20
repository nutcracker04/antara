export function isInstalledPWA() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

export function captureInstallPrompt(event) {
  event.preventDefault();
  return event;
}

export async function promptInstall(installEvent) {
  if (!installEvent || typeof installEvent.prompt !== "function") {
    return "unavailable";
  }

  await installEvent.prompt();
  const { outcome } = await installEvent.userChoice;
  return outcome === "accepted" ? "accepted" : "dismissed";
}

export function getInstallInstructions() {
  const platform =
    /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
      ? "ios"
      : /Android/i.test(navigator.userAgent)
        ? "android"
        : "desktop";

  if (platform === "ios") {
    return {
      platform,
      canAutoPrompt: false,
      steps: [
        "Tap the Share button in Safari.",
        'Scroll and tap "Add to Home Screen".',
        "Confirm to install Memory Capsule.",
      ],
    };
  }

  if (platform === "android") {
    return {
      platform,
      canAutoPrompt: true,
      steps: [
        "Open the browser menu (⋮).",
        'Tap "Install app" or "Add to Home screen".',
        "Confirm to install Memory Capsule.",
      ],
    };
  }

  return {
    platform,
    canAutoPrompt: true,
    steps: [
      "Look for the install icon in the address bar, or open the browser menu.",
      "Choose Install Memory Capsule or Add to Home screen.",
      "Confirm to pin the app for quick access.",
    ],
  };
}
