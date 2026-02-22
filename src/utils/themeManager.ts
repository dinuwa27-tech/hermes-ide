import { updateSettings } from "../terminal/TerminalPool";

export const THEME_OPTIONS = [
  { id: "dark", label: "Dark (Default)" },
  { id: "hacker", label: "Hacker" },
  { id: "designer", label: "Atelier" },
  { id: "data", label: "Deep Lab" },
  { id: "corporate", label: "Enterprise" },
  { id: "nightowl", label: "Night Owl" },
  { id: "solarized", label: "Solarized Light" },
] as const;

export function applyTheme(themeId: string, allSettings: Record<string, string>): void {
  // Set data-theme on <html> — CSS does the rest
  if (themeId === "dark") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = themeId;
  }
  // Sync terminal colors
  updateSettings({ ...allSettings, theme: themeId });
}
