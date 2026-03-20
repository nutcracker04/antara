export class WakeLockManager {
  constructor() {
    this.sentinel = null;
  }

  isSupported() {
    return "wakeLock" in navigator;
  }

  isLocked() {
    return Boolean(this.sentinel);
  }

  async requestWakeLock() {
    if (!this.isSupported()) {
      return false;
    }

    try {
      this.sentinel = await navigator.wakeLock.request("screen");
      this.sentinel.addEventListener("release", () => {
        this.sentinel = null;
      });
      return true;
    } catch {
      return false;
    }
  }

  async releaseWakeLock() {
    if (!this.sentinel) {
      return;
    }

    try {
      await this.sentinel.release();
    } catch {
      /* ignore */
    }

    this.sentinel = null;
  }

  async handleVisibilityChange(isRecording) {
    if (!isRecording || !this.isSupported()) {
      return;
    }

    if (document.visibilityState === "visible" && !this.sentinel) {
      await this.requestWakeLock();
    }
  }
}
