"use client";

import { useEffect } from "react";
import { readAppSettings, applyAppPreferences, APP_SETTINGS_KEY } from "@/lib/app-settings";

/**
 * Reads the saved theme from localStorage on every mount and applies it.
 * Also wires up a listener so that "system" mode reacts to OS-level changes.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const settings = readAppSettings();
    applyAppPreferences(settings);

    // For system mode: re-apply whenever the OS color scheme changes
    if (settings.appearance.themeMode === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => applyAppPreferences(readAppSettings());
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }

    // For other modes: listen for cross-tab settings changes
    const storageHandler = (e: StorageEvent) => {
      if (e.key === APP_SETTINGS_KEY) applyAppPreferences(readAppSettings());
    };
    window.addEventListener("storage", storageHandler);
    return () => window.removeEventListener("storage", storageHandler);
  }, []);

  return <>{children}</>;
}

/**
 * Inline script injected into <head> — runs before React hydrates so there
 * is no flash of the wrong theme. Keep this serialisable (no imports).
 */
export const themeScript = `
(function () {
  try {
    var raw = localStorage.getItem("astryn_settings");
    var mode = raw ? (JSON.parse(raw).appearance || {}).themeMode || "dark" : "dark";
    var resolved = mode === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : mode;
    if (resolved === "dark") {
      document.documentElement.classList.add("dark");
      document.documentElement.style.colorScheme = "dark";
    } else {
      document.documentElement.classList.remove("dark");
      document.documentElement.style.colorScheme = "light";
    }
  } catch (e) {
    document.documentElement.classList.add("dark");
  }
})();
`.trim();
