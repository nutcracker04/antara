function getServiceWorkerUrl() {
  return `${process.env.PUBLIC_URL || ""}/service-worker.js`;
}

export function registerServiceWorker() {
  if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) {
    return;
  }

  const isLocalhost = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
  const isSecureOrigin = window.isSecureContext || isLocalhost;

  if (!isSecureOrigin) {
    console.warn("[PWA] Service workers require HTTPS outside localhost.");
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(getServiceWorkerUrl())
      .then((registration) => {
        registration.update().catch(() => undefined);

        registration.addEventListener("updatefound", () => {
          const installingWorker = registration.installing;
          if (!installingWorker) {
            return;
          }

          installingWorker.addEventListener("statechange", () => {
            if (installingWorker.state === "installed" && navigator.serviceWorker.controller) {
              console.info("[PWA] A new version is ready and will be used on the next reload.");
            }
          });
        });
      })
      .catch((error) => {
        console.error("Service worker registration failed", error);
      });
  });
}
