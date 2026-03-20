# Device testing (PWA + client STT)

Use these checks after changing the service worker, recording flow, or local models.

## PWA install

Production builds use **Workbox `GenerateSW`** (`service-worker.js` + precache + runtime caches). Dev (`npm start`) does not register a service worker.

- **Chrome (Android)**: Open the deployed HTTPS URL, confirm install prompt or menu “Install app”, launch from home screen in standalone mode, verify routes (`/`, `/memories`, `/settings`) work offline after the first load.
- **Safari (iOS)**: Use “Add to Home Screen”. Confirm standalone launch, microphone permission, and that the **shortcut** `/?action=record` starts a capture from the installed icon (if supported).
- **Desktop Chrome**: Install from address bar; confirm `service-worker.js` registers (Application → Service Workers) and precache lists populated.

## Recording + Wake Lock

- Start a recording and confirm the **screen stays on** on Chrome/Android where Wake Lock is supported.
- On **iOS Safari**, Wake Lock may be unavailable; confirm copy on the home screen explains keeping the session active.
- Stop recording and confirm the device can sleep again (no stuck wake state).

## Client-side transcription

- First run downloads Whisper/MiniLM assets; repeat visit should be faster (browser cache + service worker runtime caches).
- On **Chrome with WebGPU**, expect `whisper-base` path; otherwise **WASM + whisper-tiny** is normal.
- Watch the status chips during capture: transcribing progress should advance, then embedding, then saved.

## Summaries (Chrome Prompt API)

- Toggle **Settings → On-device summaries** only when the browser reports the Prompt API; otherwise the toggle stays off with helper text.
- With the toggle on and a supported Chrome build, new memories should store `summarySource` from the on-device path when it succeeds; otherwise rule-based summaries apply.

## IndexedDB migration

- Existing users with the legacy `memory-capsule-db` store should see memories preserved after upgrade; preferences migrate from `localStorage` once into Dexie.

## Service worker updates

- After deploy, open the app twice or use “Update on reload” in DevTools to verify the new `service-worker.js` activates and old caches are replaced as expected.
