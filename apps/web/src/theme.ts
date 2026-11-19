/** Light or dark. With no stored choice the page follows the system setting. */
export type Theme = "light" | "dark";

const STORAGE_KEY = "cashlet-theme";

function systemTheme(): Theme {
  return globalThis.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** The visitor's saved choice, if any. Only this preference is stored, never any key. */
export function storedTheme(): Theme | null {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

export function currentTheme(): Theme {
  return storedTheme() ?? systemTheme();
}

/** Apply a theme to the page and remember it. */
export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable (private mode); the theme still applies for this visit.
  }
}

/** Apply the saved choice, or the system theme, before the first render. */
export function applyInitialTheme(): void {
  document.documentElement.dataset.theme = currentTheme();
}
