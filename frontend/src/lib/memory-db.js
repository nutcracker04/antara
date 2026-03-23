import Dexie from "dexie";
import { openDB } from "idb";

import { DEFAULT_PREFERENCES } from "@/lib/preferences-defaults";

const LEGACY_DB_NAME = "memory-capsule-db";
const DB_NAME = "memory-capsule-app";
const MIGRATION_FLAG = "memory-capsule-dexie-migrated";

class MemoryCapsuleDB extends Dexie {
  constructor() {
    super(DB_NAME);
    this.version(1).stores({
      memories: "id, createdAt, emotion, *tags, durationMs",
      preferences: "key",
    });
    // Version 2: Add embeddingModel field for migration tracking
    this.version(2).stores({
      memories: "id, createdAt, emotion, *tags, durationMs, embeddingModel",
      preferences: "key",
    }).upgrade(async (tx) => {
      // Mark all existing memories as needing re-embedding
      const memories = await tx.table("memories").toArray();
      console.log(`[Migration] Marking ${memories.length} memories for re-embedding`);
      
      for (const memory of memories) {
        if (!memory.embeddingModel || memory.embeddingModel === "all-MiniLM-L6-v2") {
          await tx.table("memories").update(memory.id, {
            embeddingModel: "needs-migration",
          });
        }
      }
    });
  }
}

let dbPromise;

async function openDatabase() {
  const db = new MemoryCapsuleDB();
  await migrateLegacyMemoriesIfNeeded(db);
  await migrateLocalStoragePreferencesOnce(db);
  await migrateEmbeddingsInBackground(db);
  return db;
}

/**
 * Re-embed memories that were created with the old model
 * Runs lazily in the background using requestIdleCallback
 */
async function migrateEmbeddingsInBackground(db) {
  try {
    const stale = await db.memories
      .where("embeddingModel")
      .equals("needs-migration")
      .toArray();

    if (stale.length === 0) {
      return;
    }

    console.log(`[Migration] Re-embedding ${stale.length} memories`);

    // Process in batches of 3 during idle time
    const processBatch = async (batch) => {
      for (const memory of batch) {
        // Wipe the stale embedding — hybridSearch will skip it (filter checks array length)
        // BM25 still works. Vector search skips until re-embedded.
        await db.memories.update(memory.id, {
          embedding: null,
          embeddingModel: "pending-reembed",
        });
      }
    };

    // Use requestIdleCallback so this doesn't block app startup
    const runWhenIdle = (memories) => {
      if (!memories.length) return;
      const batch = memories.splice(0, 3);
      if (typeof requestIdleCallback !== "undefined") {
        requestIdleCallback(async () => {
          await processBatch(batch);
          runWhenIdle(memories);
        }, { timeout: 5000 });
      } else {
        // Fallback for browsers without requestIdleCallback
        setTimeout(async () => {
          await processBatch(batch);
          runWhenIdle(memories);
        }, 100);
      }
    };

    runWhenIdle([...stale]);
  } catch (error) {
    console.error("[Migration] Embedding migration failed:", error);
  }
}

export async function initMemoryDb() {
  if (!dbPromise) {
    dbPromise = openDatabase();
  }

  return dbPromise;
}

async function migrateLegacyMemoriesIfNeeded(db) {
  if (typeof localStorage !== "undefined" && localStorage.getItem(MIGRATION_FLAG)) {
    return;
  }

  const existing = await db.memories.count();
  if (existing > 0) {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(MIGRATION_FLAG, "1");
    }

    try {
      indexedDB.deleteDatabase(LEGACY_DB_NAME);
    } catch {
      /* ignore */
    }

    return;
  }

  try {
    const legacy = await openDB(LEGACY_DB_NAME, 1);
    const oldMemories = await legacy.getAll("memories");
    await legacy.close();

    if (oldMemories.length) {
      await db.transaction("rw", db.memories, async () => {
        for (const memory of oldMemories) {
          await db.memories.put(upgradeMemoryRecord(memory));
        }
      });
    }
  } catch {
    /* legacy db missing */
  }

  try {
    indexedDB.deleteDatabase(LEGACY_DB_NAME);
  } catch {
    /* ignore */
  }

  if (typeof localStorage !== "undefined") {
    localStorage.setItem(MIGRATION_FLAG, "1");
  }
}

function upgradeMemoryRecord(memory) {
  return {
    ...memory,
    summarySource: memory.summarySource || "rule-based",
    transcriptionDuration: memory.transcriptionDuration ?? 0,
    transcriptionModel: memory.transcriptionModel || "Xenova/whisper-base.en",
    embeddingModel: memory.embeddingModel || "needs-migration",
    version: memory.version ?? 2,
  };
}

async function migrateLocalStoragePreferencesOnce(db) {
  if (typeof localStorage === "undefined") {
    return;
  }

  const raw = localStorage.getItem("memory-capsule-preferences");
  if (!raw) {
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    await db.transaction("rw", db.preferences, async () => {
      for (const [key, value] of Object.entries(parsed)) {
        if (Object.prototype.hasOwnProperty.call(DEFAULT_PREFERENCES, key)) {
          await db.preferences.put({ key, value });
        }
      }
    });
  } catch {
    /* ignore */
  }

  localStorage.removeItem("memory-capsule-preferences");
}

export async function loadPreferencesFromDb() {
  const db = await initMemoryDb();
  const rows = await db.preferences.toArray();
  const fromDb = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return { ...DEFAULT_PREFERENCES, ...fromDb };
}

export async function savePreferencesToDb(preferences) {
  const db = await initMemoryDb();
  await db.transaction("rw", db.preferences, async () => {
    for (const [key, value] of Object.entries(preferences)) {
      await db.preferences.put({ key, value });
    }
  });
}

export async function saveMemory(memory) {
  const db = await initMemoryDb();
  const record = upgradeMemoryRecord(memory);
  await db.memories.put(record);
  return record;
}

export async function getMemories() {
  const db = await initMemoryDb();
  const memories = await db.memories.toArray();
  return memories.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export async function clearMemories() {
  const db = await initMemoryDb();
  await db.memories.clear();
}

export async function deleteMemory(id) {
  const db = await initMemoryDb();
  await db.memories.delete(id);
}
