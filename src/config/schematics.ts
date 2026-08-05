import { createConfigSchematics } from "@lmstudio/sdk";

export const configSchematics = createConfigSchematics()
  .field(
    "researchMode",
    "select",
    {
      displayName: "Research mode",
      hint: "normal = fast search; osint = deep multi-pass investigation",
      options: [
        { value: "normal", displayName: "Normal" },
        { value: "osint", displayName: "OSINT (deep)" },
      ],
    },
    "normal",
  )
  .field(
    "resultsPerSearch",
    "numeric",
    {
      displayName: "Results per search",
      hint: "How many links to return after merging engines.",
      min: 5,
      max: 30,
      int: true,
    },
    12,
  )
  .field(
    "safeSearch",
    "select",
    {
      displayName: "Safe search",
      hint:
        "Sent explicitly to every traditional engine (DDG/Bing/Yandex/Brave/Yahoo/Google/SearX/…). Default Off. NSFW mode also forces Off.",
      options: [
        { value: "off", displayName: "Off (default)" },
        { value: "moderate", displayName: "Moderate" },
        { value: "strict", displayName: "Strict" },
      ],
    },
    "off",
  )
  .field(
    "politeDelayMs",
    "numeric",
    {
      displayName: "Delay between requests (ms)",
      hint: "0 = fastest. Default 250.",
      min: 0,
      max: 5000,
      int: true,
    },
    250,
  )
  .field(
    "maxContentChars",
    "numeric",
    {
      displayName: "Max page text chars",
      min: 1000,
      max: 50000,
      int: true,
    },
    12000,
  )
  .field(
    "jinaFallback",
    "boolean",
    {
      displayName: "Jina fallback on block",
      hint: "If direct fetch is blocked, try r.jina.ai",
    },
    true,
  )
  .field(
    "allowSiteScraping",
    "boolean",
    {
      displayName: "Allow site scraping",
      hint:
        "Enable visit / crawl and page harvest inside image_search & OSINT. " +
        "Off = search-only (no page open/scrape).",
    },
    true,
  )
  .field(
    "allowChromeDevtools",
    "boolean",
    {
      displayName: "Chrome DevTools (user permission)",
      hint:
        "OFF by default. When ON, if direct/Jina fail or page is JS shell, " +
        "use local Chrome via remote debugging (start Chrome with --remote-debugging-port=9222). " +
        "Requires Allow site scraping.",
    },
    false,
  )
  .field(
    "chromeDebugPort",
    "numeric",
    {
      displayName: "Chrome debug port",
      hint: "Remote debugging port (default 9222). Only used if Chrome DevTools is allowed.",
      min: 1,
      max: 65535,
      int: true,
    },
    9222,
  )
  .field(
    "googleApiKey",
    "string",
    {
      displayName: "Google / Serper API key",
      hint: "Optional. Enables Google in auto search.",
    },
    "",
  )
  .field(
    "googleCx",
    "string",
    {
      displayName: "Google CX (Programmable Search ID)",
      hint: "Required only for googleProvider=custom_search",
    },
    "",
  )
  .field(
    "googleProvider",
    "select",
    {
      displayName: "Google provider",
      options: [
        { value: "custom_search", displayName: "Google Custom Search (key+cx)" },
        { value: "serper", displayName: "Serper.dev" },
        { value: "serpapi", displayName: "SerpAPI" },
      ],
    },
    "custom_search",
  )
  // ── Search mode: sfw | auto | auto_unsafe | nsfw ─
  .field(
    "nsfwMode",
    "select",
    {
      displayName: "Search mode",
      hint:
        "sfw = never NSFW. auto = strong detect only. " +
        "auto_unsafe = soft keywords also trigger + SafeSearch Off. " +
        "nsfw = always NSFW pipeline. Default: auto.",
      options: [
        { value: "sfw", displayName: "sfw — Safe for work only" },
        { value: "auto", displayName: "auto — detect (strong signals)" },
        {
          value: "auto_unsafe",
          displayName: "auto_unsafe — looser detect + SafeSearch Off",
        },
        { value: "nsfw", displayName: "nsfw — always NSFW search" },
      ],
    },
    "auto",
  )
  .field(
    "nsfwExtraKeywords",
    "string",
    {
      displayName: "NSFW dictionary extras",
      hint: "Optional comma-separated words for auto-detect and NSFW query expansion.",
    },
    "",
  )
  .field(
    "imageMinShortSide",
    "numeric",
    {
      displayName: "Image min short side (px)",
      hint: "Save photos with short side at least this (default 240; was too strict at 480).",
      min: 120,
      max: 1080,
      int: true,
    },
    240,
  )
  .build();
