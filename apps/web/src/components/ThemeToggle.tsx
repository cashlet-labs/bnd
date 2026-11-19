import { useState } from "react";
import { currentTheme, setTheme, type Theme } from "../theme";

/** Switches between the light and dark themes. */
export function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>(currentTheme);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => {
        setTheme(next);
        setThemeState(next);
      }}
    >
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
