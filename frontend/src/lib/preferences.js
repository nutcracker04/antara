import { loadPreferencesFromDb, savePreferencesToDb } from "@/lib/memory-db";

export { DEFAULT_PREFERENCES } from "@/lib/preferences-defaults";

export async function loadPreferences() {
  return loadPreferencesFromDb();
}

export async function savePreferences(preferences) {
  return savePreferencesToDb(preferences);
}
