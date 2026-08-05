/**
 * Map plugin safeSearch level → engine URL / API parameters.
 * Always set an explicit value (never leave engine defaults — many default to ON).
 */
export type SafeLevel = "off" | "moderate" | "strict";

export function normalizeSafeLevel(
  level: string | undefined | null,
): SafeLevel {
  if (level === "strict" || level === "moderate" || level === "off") return level;
  return "off";
}

/** DuckDuckGo: kp=-2 off, -1 moderate, 1 strict */
export function ddgKp(level: SafeLevel): string {
  if (level === "strict") return "1";
  if (level === "moderate") return "-1";
  return "-2";
}

/** DDG images i.js: p=1 off-ish, p=-1 moderate/strict */
export function ddgImageP(level: SafeLevel): string {
  return level === "strict" ? "-1" : "1";
}

/** Bing: adlt=off | moderate | strict */
export function bingAdlt(level: SafeLevel): string {
  if (level === "strict") return "strict";
  if (level === "moderate") return "moderate";
  return "off";
}

/** Google CSE / SerpAPI: safe=off | active */
export function googleSafe(level: SafeLevel): string {
  return level === "strict" || level === "moderate" ? "active" : "off";
}

/** SearXNG: 0 off, 1 moderate, 2 strict */
export function searxSafe(level: SafeLevel): string {
  if (level === "strict") return "2";
  if (level === "moderate") return "1";
  return "0";
}

/** Qwant: safesearch 0/1/2 */
export function qwantSafe(level: SafeLevel): string {
  if (level === "strict") return "2";
  if (level === "moderate") return "1";
  return "0";
}

/** Yahoo: vm=r relaxed (off), vm=i moderate?, vm=p strict */
export function yahooVm(level: SafeLevel): string {
  if (level === "strict") return "p";
  if (level === "moderate") return "i";
  return "r";
}

/** Brave Search: safesearch=off|moderate|strict */
export function braveSafe(level: SafeLevel): string {
  if (level === "strict") return "strict";
  if (level === "moderate") return "moderate";
  return "off";
}

/**
 * Yandex family filter cookie fragment.
 * fy=0 → adult allowed (family off); fy=1 → family on.
 */
export function yandexFamilyCookie(level: SafeLevel): string {
  const fy = level === "off" ? "0" : "1";
  // yp cookie shape: timestamp.fy.N — engines accept minimal form
  return `yp=${Math.floor(Date.now() / 1000)}.fy.${fy}`;
}
