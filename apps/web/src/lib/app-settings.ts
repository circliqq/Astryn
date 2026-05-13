export type ThemeMode = "dark" | "light" | "system";

export interface AppSettings {
  profile: {
    displayName: string;
  };
  appearance: {
    themeMode: ThemeMode;
    compactMode: boolean;
    timezone: string;
  };
  notifications: {
    mintStatus: boolean;
    gasAlerts: boolean;
    securityAlerts: boolean;
    weeklyDigest: boolean;
  };
  autoConsolidation: {
    enabled: boolean;
    coldWalletAddress: string;
    onlyAfterConfirmedMint: boolean;
  };
  privacy: {
    hideWalletAddresses: boolean;
    blurBalances: boolean;
    analyticsOptOut: boolean;
  };
}

export const APP_SETTINGS_KEY = "astryn_settings";

export const DEFAULT_APP_SETTINGS: AppSettings = {
  profile: {
    displayName: ""
  },
  appearance: {
    themeMode: "dark",
    compactMode: false,
    timezone: "UTC"
  },
  notifications: {
    mintStatus: true,
    gasAlerts: true,
    securityAlerts: true,
    weeklyDigest: false
  },
  autoConsolidation: {
    enabled: false,
    coldWalletAddress: "",
    onlyAfterConfirmedMint: true
  },
  privacy: {
    hideWalletAddresses: false,
    blurBalances: false,
    analyticsOptOut: false
  }
};

function mergeSettings(raw: Partial<AppSettings>): AppSettings {
  return {
    profile: { ...DEFAULT_APP_SETTINGS.profile, ...raw.profile },
    appearance: { ...DEFAULT_APP_SETTINGS.appearance, ...raw.appearance },
    notifications: { ...DEFAULT_APP_SETTINGS.notifications, ...raw.notifications },
    autoConsolidation: { ...DEFAULT_APP_SETTINGS.autoConsolidation, ...raw.autoConsolidation },
    privacy: { ...DEFAULT_APP_SETTINGS.privacy, ...raw.privacy }
  };
}

export function readAppSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_APP_SETTINGS;

  const stored = localStorage.getItem(APP_SETTINGS_KEY);
  if (!stored) return DEFAULT_APP_SETTINGS;

  try {
    return mergeSettings(JSON.parse(stored) as Partial<AppSettings>);
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

export function writeAppSettings(settings: AppSettings): void {
  localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(settings));
  applyAppPreferences(settings);
}

export function applyAppPreferences(settings: AppSettings): void {
  if (typeof document === "undefined") return;

  const html = document.documentElement;

  // Resolve to concrete dark / light
  const resolved: "dark" | "light" =
    settings.appearance.themeMode === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : settings.appearance.themeMode;

  // Toggle the Tailwind `dark` class (tailwind.config darkMode: ["class"])
  if (resolved === "dark") {
    html.classList.add("dark");
    html.style.colorScheme = "dark";
  } else {
    html.classList.remove("dark");
    html.style.colorScheme = "light";
  }

  // Keep data-attrs for CSS overrides and privacy features
  html.dataset.themeMode            = resolved;
  html.dataset.settingsTheme        = settings.appearance.themeMode;
  html.dataset.hideWalletAddresses  = String(settings.privacy.hideWalletAddresses);
  html.dataset.blurBalances         = String(settings.privacy.blurBalances);
  html.dataset.compactMode          = String(settings.appearance.compactMode);
}
