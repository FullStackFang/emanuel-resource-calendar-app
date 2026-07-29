// src/utils/layoutPreference.js
//
// Per-device layout override consumed by useDeviceType. Width-based detection
// misclassifies real desktops whose CSS viewport shrinks under 480px (browser
// zoom, a narrow installed-PWA window, display scaling), so users need the
// last word. Stored in localStorage — not account preferences — because the
// right layout is a property of the device, not the person: forcing desktop
// on a misclassifying computer must not also force it on that user's phone.

export const LAYOUT_PREFERENCE_KEY = 'templeEvents:layoutPreference';
export const LAYOUT_PREFERENCE_EVENT = 'templeEvents:layoutPreferenceChange';

const VALID_PREFERENCES = ['auto', 'desktop', 'mobile'];

/** @returns {'auto' | 'desktop' | 'mobile'} */
export function getLayoutPreference() {
  try {
    const stored = window.localStorage.getItem(LAYOUT_PREFERENCE_KEY);
    return VALID_PREFERENCES.includes(stored) ? stored : 'auto';
  } catch {
    return 'auto';
  }
}

export function setLayoutPreference(preference) {
  if (!VALID_PREFERENCES.includes(preference)) return;
  try {
    window.localStorage.setItem(LAYOUT_PREFERENCE_KEY, preference);
  } catch {
    // localStorage unavailable (private mode) — the event below still flips
    // the current tab, the choice just won't survive a reload.
  }
  window.dispatchEvent(new Event(LAYOUT_PREFERENCE_EVENT));
}
