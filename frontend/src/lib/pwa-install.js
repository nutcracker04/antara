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
  const isLocalhost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const isSecureOrigin = window.isSecureContext || isLocalhost;
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
      note: isSecureOrigin ? "Use Safari on iPhone to add this app to your home screen." : "Install to home screen on iPhone works only from a secure HTTPS site.",
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
      canAutoPrompt: isSecureOrigin,
      note: isSecureOrigin ? "Chrome can usually show the install prompt automatically." : "Install prompts on Android need the site to be served over HTTPS.",
      steps: [
        "Open the browser menu (⋮).",
        'Tap "Install app" or "Add to Home screen".',
        "Confirm to install Memory Capsule.",
      ],
    };
  }

  return {
    platform,
    canAutoPrompt: isSecureOrigin,
    note: isSecureOrigin ? "Look for the browser's install action to pin the app." : "Desktop/browser installs need the site to be served over HTTPS.",
    steps: [
      "Look for the install icon in the address bar, or open the browser menu.",
      "Choose Install Memory Capsule or Add to Home screen.",
      "Confirm to pin the app for quick access.",
    ],
  };
}
