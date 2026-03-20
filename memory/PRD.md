# Memory Capsule PRD

## Original Problem Statement
Build **Memory Capsule**, a mobile-first Progressive Web App (PWA) that captures, processes, and interacts with human memories using **voice as the primary input**. The required architecture is local-first: MediaRecorder for capture, Whisper transcription in a Web Worker, local embeddings, IndexedDB storage, local semantic search, and a privacy-first assistant flow.

## User Choices
- Cloud AI assistant wiring is deferred for now
- No external AI key provided
- Payments deferred to the next phase
- Design direction: calm, minimal, soft motion
- MVP priority: voice capture plus local memory storage

## Architecture Decisions
- **Frontend-first local experience:** React app drives the full UX with mobile-first routing, bottom navigation, PWA manifest, and service worker shell
- **Recording pipeline:** MediaRecorder + Web Audio analyser for amplitude/frequency-driven wave behavior
- **On-device AI:** module Web Worker in `frontend/public/ai-worker.js` using pinned `@huggingface/transformers@3.8.1` from CDN
- **Transcription model:** `Xenova/whisper-tiny`
- **Embedding model:** `Xenova/all-MiniLM-L6-v2`
- **Storage:** IndexedDB via `idb` for local memory objects including transcript, summary, tags, emotion, embeddings, and audio blob
- **Assistant:** local semantic retrieval and template-based local answers from saved memories only in this phase
- **Backend:** FastAPI health/info endpoints retained for full-stack integrity; no cloud LLM proxy or payment endpoints in this phase

## User Personas
- People capturing fleeting personal thoughts or ADHD reminders
- Users doing emotional journaling and reflection
- Families preserving conversations and spoken memories
- Professionals saving quick meeting notes and recall snippets
- Students capturing lecture insights for later review

## Core Requirements
- Voice-first capture with tap and hold interactions
- Wave-based calm home experience
- On-device transcription in a worker
- Local storage for transcript-centered memories
- Local semantic retrieval across saved memories
- Privacy-first, installable mobile PWA shell
- Simple assistant interface for local answers and references

## What Has Been Implemented
### 2026-03-20
- Replaced starter UI with a calm, mobile-first Memory Capsule experience across Capture, Memories, Assistant, and Settings routes
- Built animated voice wave UI with amplitude/frequency-driven visual behavior and tap/hold recording interactions
- Added MediaRecorder capture hook with live audio analysis and local processing states
- Added on-device AI worker for Whisper transcription and MiniLM embeddings
- Implemented IndexedDB local memory storage for transcript, summary, tags, emotion, embeddings, audio blob, and timestamps
- Implemented local semantic search and local assistant answer generation with references
- Added PWA essentials: manifest, service worker shell, install affordance, custom icon, and install/settings surface
- Updated FastAPI backend with app info and health endpoints
- Ran self-tests, screenshots, backend health checks, and a full testing-agent pass
- Pinned Transformers CDN dependency to `3.8.1` for runtime stability

## Prioritized Backlog
### P0
- Validate the full microphone → Whisper → IndexedDB save path on a real mobile device/browser with spoken input
- Improve confidence around long recordings and progressive transcription feedback

### P1
- Add optional cloud assistant proxy for richer answers when user enables it
- Add richer memory filtering and grouped timeline views
- Improve assistant reasoning for weekly summaries, stress patterns, and memory references
- Add export/share options for saved memories

### P2
- Add subscription/paywall flow for Pro features
- Add cross-device sync and account system
- Add richer emotion inference and advanced summarization
- Add meeting/lecture specialized templates and insights

## Next Tasks List
1. Real-device recording validation
2. Cloud assistant opt-in phase
3. Pro plan/payments phase
4. Sync/export enhancements
