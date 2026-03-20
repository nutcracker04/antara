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
  }
}

let dbPromise;

async function openDatabase() {
  const db = new MemoryCapsuleDB();
  await migrateLegacyMemoriesIfNeeded(db);
  await migrateLocalStoragePreferencesOnce(db);
  return db;
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
    transcriptionModel: memory.transcriptionModel || "whisper-tiny",
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
