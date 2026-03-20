export const DEFAULT_PREFERENCES = {
  captureReminders: false,
  gentleMode: true,
  showSummariesFirst: true,
};

const STORAGE_KEY = "memory-capsule-preferences";

export function loadPreferences() {
  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY);
    if (!rawValue) {
      return DEFAULT_PREFERENCES;
    }

    return { ...DEFAULT_PREFERENCES, ...JSON.parse(rawValue) };
  } catch (error) {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(preferences) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}