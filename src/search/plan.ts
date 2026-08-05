/**
 * Unified SFW / NSFW search plan.
 * One decision object drives web_search, image_search, and OSINT —
 * so SafeSearch, engines, and query expansion never drift apart.
 */
import {
  decideNsfw,
  expandNsfwImageQueries,
  expandNsfwQueries,
  expandSfwQueries,
  type NsfwDecision,
  type NsfwIntensity,
} from "../nsfw/keywords";
import type { EngineContext, SearchEngineId } from "./types";
import { normalizeSafeLevel, type SafeLevel } from "./safeSearch";

export interface SearchPlanOptions {
  nsfw?: boolean;
  nsfwMode?: NsfwIntensity;
  nsfwExtraKeywords?: string;
  /** Plugin SafeSearch setting (SFW may still use moderate/strict). */
  pluginSafeSearch?: SafeLevel | string;
  osintBoost?: boolean;
  hasGoogleKey?: boolean;
  /** Requested engine (auto or specific). */
  engine?: SearchEngineId | string;
}

export interface SearchPlan {
  nsfw: NsfwDecision;
  /** Effective SafeSearch sent to traditional engines. */
  safeSearch: SafeLevel;
  /** Web query variants for engines. */
  webQueries: string[];
  /** Image query variants. */
  imageQueries: string[];
  /** Engines for web_search auto / explicit. */
  webEngines: string[];
  enginesSkipped: string[];
  /** image_search pipeline mode. */
  imagePipeline: "sfw" | "nsfw";
  /** Wall budgets (ms). */
  webBudgetMs: number;
  imageBudgetMs: number;
  /** Apply to EngineContext. */
  ctxPatch: Partial<EngineContext>;
}

/** Traditional free engines — always get explicit SafeSearch params. */
export const TRADITIONAL_ENGINES = [
  "ddg",
  "bing",
  "yandex",
  "brave",
  "yahoo",
  "mojeek",
  "searx",
  "qwant",
  "wikipedia",
  "google",
] as const;

/** Adult indexes — only when NSFW active. */
export const ADULT_WEB_ENGINES = [
  "nudevista",
  "xnxx",
  "xvideos",
  "eporner",
  "hqporner",
] as const;

export const ADULT_AGGREGATORS = ["pornmd", "ixxx", "fuq"] as const;

/**
 * Build one coherent plan from user query + plugin/tool options.
 */
export function buildSearchPlan(
  query: string,
  opts: SearchPlanOptions = {},
): SearchPlan {
  const nsfw = decideNsfw(
    query,
    opts.nsfwMode ?? "auto",
    opts.nsfw,
    opts.nsfwExtraKeywords,
  );

  const pluginSafe = normalizeSafeLevel(opts.pluginSafeSearch);
  // NSFW active OR auto_unsafe → SafeSearch Off on traditional engines.
  // Plain SFW uses plugin setting (default off).
  const safeSearch: SafeLevel =
    nsfw.active || nsfw.forceSafeSearchOff ? "off" : pluginSafe;

  const enginesSkipped: string[] = [];
  let webEngines: string[];
  const engine = opts.engine || "auto";

  if (engine === "auto") {
    if (nsfw.active) {
      // Adult first, then traditional with SafeSearch off
      webEngines = [...ADULT_WEB_ENGINES, "ddg", "bing", "yandex"];
      enginesSkipped.push("brave: skipped in NSFW (hard safe filter)");
      enginesSkipped.push("qwant: skipped in NSFW (blocks/hangs)");
    } else {
      webEngines = ["ddg", "bing", "yandex", "brave"];
    }
    if (opts.hasGoogleKey) webEngines.push("google");
    else enginesSkipped.push("google: no api key (optional)");
    if (opts.osintBoost && !nsfw.active) {
      webEngines.push("mojeek", "searx", "yahoo", "wikipedia");
    }
  } else if (engine === "qwant" && nsfw.active) {
    enginesSkipped.push("qwant: poor NSFW — redirected to adult+ddg/bing");
    webEngines = [...ADULT_WEB_ENGINES, "ddg", "bing"];
  } else {
    webEngines = [String(engine)];
  }

  webEngines = [...new Set(webEngines)];

  let webQueries: string[];
  let imageQueries: string[];
  if (nsfw.active) {
    webQueries = expandNsfwQueries(query, nsfw).slice(0, 4);
    imageQueries = expandNsfwImageQueries(query, nsfw);
  } else {
    webQueries = expandSfwQueries(query);
    if (!webQueries.length) webQueries = [query.trim()].filter(Boolean);
    webQueries = webQueries.slice(0, 2);
    imageQueries = expandSfwQueries(query, { forImages: true });
    if (!imageQueries.length) {
      imageQueries = webQueries.slice(0, 2);
    }
  }

  return {
    nsfw,
    safeSearch,
    webQueries,
    imageQueries,
    webEngines,
    enginesSkipped,
    imagePipeline: nsfw.active ? "nsfw" : "sfw",
    webBudgetMs: nsfw.active ? 28_000 : 18_000,
    imageBudgetMs: nsfw.active ? 48_000 : 35_000,
    ctxPatch: {
      safeSearch,
      politeDelayMs: nsfw.active ? 80 : undefined,
    },
  };
}

/** Merge plan into engine context. */
export function applyPlanToCtx(
  ctx: EngineContext,
  plan: SearchPlan,
): EngineContext {
  return {
    ...ctx,
    safeSearch: plan.safeSearch,
    politeDelayMs:
      plan.ctxPatch.politeDelayMs ?? Math.min(ctx.politeDelayMs, 250),
  };
}
