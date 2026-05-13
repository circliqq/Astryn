import { readAppSettings } from "./app-settings";

/** Read the timezone the user has saved in Settings (falls back to UTC). */
export function getUserTimezone(): string {
  if (typeof window === "undefined") return "UTC";
  return readAppSettings().appearance.timezone ?? "UTC";
}

/** Full date+time with seconds: "5/14/2026, 04:00:00 PM IST" */
export function formatDateFull(isoString: string, timezone?: string): string {
  const tz = timezone ?? getUserTimezone();
  return new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: tz,
    timeZoneName: "short",
  }).format(new Date(isoString));
}

/** Short date+time without seconds: "5/14/2026, 04:00 PM IST" */
export function formatDateShort(isoString: string, timezone?: string): string {
  const tz = timezone ?? getUserTimezone();
  return new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
    timeZoneName: "short",
  }).format(new Date(isoString));
}

/** Time only: "04:00 PM IST" */
export function formatTimeOnly(isoString: string, timezone?: string): string {
  const tz = timezone ?? getUserTimezone();
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: tz,
    timeZoneName: "short",
  }).format(new Date(isoString));
}
