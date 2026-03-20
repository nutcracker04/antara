import { openDB } from "idb";

const DB_NAME = "memory-capsule-db";
const DB_VERSION = 1;
const MEMORY_STORE = "memories";

const databasePromise = openDB(DB_NAME, DB_VERSION, {
  upgrade(database) {
    if (!database.objectStoreNames.contains(MEMORY_STORE)) {
      const store = database.createObjectStore(MEMORY_STORE, { keyPath: "id" });
      store.createIndex("createdAt", "createdAt");
      store.createIndex("emotion", "emotion");
    }
  },
});

export async function saveMemory(memory) {
  const database = await databasePromise;
  await database.put(MEMORY_STORE, memory);
  return memory;
}

export async function getMemories() {
  const database = await databasePromise;
  const memories = await database.getAll(MEMORY_STORE);

  return memories.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export async function clearMemories() {
  const database = await databasePromise;
  await database.clear(MEMORY_STORE);
}

export async function deleteMemory(id) {
  const database = await databasePromise;
  await database.delete(MEMORY_STORE, id);
}