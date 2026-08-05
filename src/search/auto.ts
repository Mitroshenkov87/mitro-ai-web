import type { EngineContext, SearchEngineId, SearchHit, SearchResult } from "./types";
import { mergeHits } from "./merge";
import { searchDdg } from "./engines/ddg";
import { searchBing } from "./engines/bing";
import { searchYandex } from "./engines/yandex";
import { searchYahoo } from "./engines/yahoo";
import { searchBrave } from "./engines/brave";
import { searchWikipedia } from "./engines/wikipedia";
import { searchGoogle } from "./engines/google";
import { searchQwant } from "./engines/qwant";
import { searchMojeek } from "./engines/mojeek";
import { searchSearx } from "./engines/searx";
import { searchNudevista } from "./engines/nudevista";
import { searchXnxx } from "./engines/xnxx";
import { searchXvideos } from "./engines/xvideos";
import { searchEporner } from "./engines/eporner";
import { searchHqporner } from "./engines/hqporner";
import {
  searchPornmd,
  searchIxxx,
  searchFuq,
} from "./engines/adultAggregators";
import {
  type NsfwDecision,
  type NsfwIntensity,
} from "../nsfw/keywords";
import {
  extractSubjectTokens,
  filterByIdentity,
} from "./identity";
import {
  ADULT_AGGREGATORS,
  applyPlanToCtx,
  buildSearchPlan,
} from "./plan";

type Runner = (q: string, ctx: EngineContext) => Promise<SearchHit[]>;

const RUNNERS: Record<string, Runner> = {
  ddg: searchDdg,
  bing: searchBing,
  yandex: searchYandex,
  yahoo: searchYahoo,
  brave: searchBrave,
  wikipedia: searchWikipedia,
  qwant: searchQwant,
  mojeek: searchMojeek,
  searx: searchSearx,
  google: searchGoogle,
  // Adult / XXX (use when NSFW active — traditional SERPs filter hard)
  nudevista: searchNudevista,
  xnxx: searchXnxx,
  xvideos: searchXvideos,
  eporner: searchEporner,
  hqporner: searchHqporner,
  pornmd: searchPornmd,
  ixxx: searchIxxx,
  fuq: searchFuq,
};

/** Engines that often hang or hard-block adult queries — skip in NSFW auto. */
const NSFW_SKIP_ENGINES = new Set(["qwant", "brave"]);

const ENGINE_TIMEOUT_MS = 12_000;

export interface WebSearchOptions {
  osintBoost?: boolean;
  nsfw?: boolean;
  nsfwMode?: NsfwIntensity;
  nsfwExtraKeywords?: string;
}

/**
 * Hard wall-clock budget per engine. Also aborts the underlying fetch via
 * AbortSignal so a stuck host (Qwant NSFW wall) cannot pin the event loop forever.
 */
function withTimeoutAbort<T>(
  factory: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string,
  parentSignal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const ac = new AbortController();
    const onParent = () => ac.abort();
    if (parentSignal) {
      if (parentSignal.aborted) {
        reject(new Error(`${label} aborted`));
        return;
      }
      parentSignal.addEventListener("abort", onParent, { once: true });
    }
    const t = setTimeout(() => {
      ac.abort();
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    factory(ac.signal).then(
      (v) => {
        clearTimeout(t);
        parentSignal?.removeEventListener("abort", onParent);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        parentSignal?.removeEventListener("abort", onParent);
        reject(e);
      },
    );
  });
}

async function runEnginesOnce(
  query: string,
  list: string[],
  ctx: EngineContext,
  timeoutMs: number = ENGINE_TIMEOUT_MS,
): Promise<{
  groups: SearchHit[][];
  enginesUsed: string[];
  enginesFailed: Array<{ engine: string; error: string }>;
}> {
  const enginesUsed: string[] = [];
  const enginesFailed: Array<{ engine: string; error: string }> = [];

  // Parallel but each engine has a hard timeout+abort so one hang cannot freeze search
  const settled = await Promise.all(
    list.map(async (id) => {
      const runner = RUNNERS[id];
      if (!runner) {
        return { id, hits: [] as SearchHit[], error: "unknown engine" };
      }
      try {
        const hits = await withTimeoutAbort(
          (signal) =>
            runner(query, {
              ...ctx,
              signal,
              limit: Math.max(ctx.limit, 8),
            }),
          timeoutMs,
          id,
          ctx.signal,
        );
        return { id, hits, error: null as string | null };
      } catch (e) {
        return {
          id,
          hits: [],
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }),
  );

  const groups: SearchHit[][] = [];
  for (const s of settled) {
    if (s.error) {
      // Distinguish timeout vs other fetch errors (empty SERP is separate below)
      const err = s.error;
      const label = /timed out/i.test(err)
        ? `timeout: ${err}`
        : /abort/i.test(err)
          ? `aborted: ${err}`
          : err;
      enginesFailed.push({ engine: s.id, error: label });
    } else if (s.hits.length) {
      enginesUsed.push(s.id);
      groups.push(s.hits);
    } else {
      enginesFailed.push({ engine: s.id, error: "empty SERP" });
    }
  }
  return { groups, enginesUsed, enginesFailed };
}

export async function webSearch(
  query: string,
  engine: SearchEngineId,
  ctx: EngineContext,
  osintBoostOrOpts: boolean | WebSearchOptions = false,
): Promise<
  SearchResult & {
    nsfw?: NsfwDecision;
    queriesRun?: string[];
    identityTokens?: string[];
    searchPlan?: {
      mode: string;
      safeSearch: string;
      webEngines: string[];
      webQueries: string[];
    };
  }
> {
  const opts: WebSearchOptions =
    typeof osintBoostOrOpts === "boolean"
      ? { osintBoost: osintBoostOrOpts }
      : osintBoostOrOpts;

  // Single plan: SFW/NSFW engines, queries, SafeSearch — one place
  const plan = buildSearchPlan(query, {
    nsfw: opts.nsfw,
    nsfwMode: opts.nsfwMode,
    nsfwExtraKeywords: opts.nsfwExtraKeywords,
    pluginSafeSearch: ctx.safeSearch,
    osintBoost: opts.osintBoost,
    hasGoogleKey: Boolean((ctx.googleApiKey || "").trim()),
    engine,
  });
  const nsfw = plan.nsfw;
  const ctxEff = applyPlanToCtx(ctx, plan);

  if (engine === "google" && !(ctxEff.googleApiKey || "").trim()) {
    return {
      query,
      results: [],
      enginesUsed: [],
      enginesSkipped: [
        "google: no api key — set googleApiKey in plugin settings",
      ],
      enginesFailed: [],
      count: 0,
      nsfw,
      queriesRun: [query],
    };
  }

  let list = plan.webEngines.filter(
    (id) => !(nsfw.active && NSFW_SKIP_ENGINES.has(id)),
  );
  list = [...new Set(list)];
  const enginesSkipped = [...plan.enginesSkipped];

  const searchBudgetMs = plan.webBudgetMs;
  const searchT0 = Date.now();
  const budgetLeft = () => Math.max(0, searchBudgetMs - (Date.now() - searchT0));

  const queries = plan.webQueries;
  const allGroups: SearchHit[][] = [];
  const enginesUsed = new Set<string>();
  const enginesFailed: Array<{ engine: string; error: string }> = [];

  // First variant: all engines. Later variants: only engines that returned hits.
  let activeList = list;
  const queriesRun: string[] = [];
  for (let qi = 0; qi < queries.length; qi++) {
    const left = budgetLeft();
    if (qi > 0 && left < 2_000) break;

    const q = queries[qi];
    queriesRun.push(q);
    const engineMs = Math.min(
      ENGINE_TIMEOUT_MS,
      Math.max(2_000, left || ENGINE_TIMEOUT_MS),
    );
    const { groups, enginesUsed: used, enginesFailed: failed } =
      await runEnginesOnce(
        q,
        activeList,
        {
          ...ctxEff,
          limit: Math.max(6, Math.ceil(ctxEff.limit / queries.length)),
        },
        engineMs,
      );
    allGroups.push(...groups);
    used.forEach((u) => enginesUsed.add(u));
    enginesFailed.push(...failed);
    if (qi === 0) {
      if (used.length > 0) activeList = used;
      else break;
    }
    if (mergeHits(allGroups, ctxEff.limit).length >= ctxEff.limit) break;
  }

  // Thin SERP extras (same plan: NSFW → aggregators; SFW → mojeek/searx/…)
  if (
    budgetLeft() >= 3_000 &&
    mergeHits(allGroups, ctxEff.limit).length < Math.min(3, ctxEff.limit) &&
    engine === "auto"
  ) {
    const extras = nsfw.active
      ? [...ADULT_AGGREGATORS]
      : (["mojeek", "searx", "yahoo", "wikipedia"] as const);

    for (const extra of extras) {
      if (list.includes(extra) || enginesUsed.has(extra)) continue;
      if (budgetLeft() < 2_000) break;
      try {
        const hits = await withTimeoutAbort(
          (signal) => RUNNERS[extra](query, { ...ctxEff, signal }),
          Math.min(ENGINE_TIMEOUT_MS, budgetLeft()),
          extra,
          ctxEff.signal,
        );
        if (hits.length) {
          enginesUsed.add(extra);
          allGroups.push(hits);
        } else {
          enginesFailed.push({ engine: extra, error: "empty SERP" });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        enginesFailed.push({
          engine: extra,
          error: /timed out/i.test(msg) ? `timeout: ${msg}` : msg,
        });
      }
    }
  }

  const failMap = new Map<string, string>();
  for (const f of enginesFailed) {
    if (!failMap.has(f.engine)) failMap.set(f.engine, f.error);
  }

  // Identity: NSFW never falls back to unrelated tube noise
  let results = mergeHits(allGroups, Math.max(ctxEff.limit * 2, 12));
  results = filterByIdentity(results, query, {
    strict: nsfw.active,
  }).slice(0, ctxEff.limit);
  return {
    query,
    results,
    enginesUsed: [...enginesUsed],
    enginesSkipped,
    enginesFailed: [...failMap.entries()].map(([engine, error]) => ({
      engine,
      error,
    })),
    count: results.length,
    nsfw,
    searchPlan: {
      mode: plan.imagePipeline,
      safeSearch: plan.safeSearch,
      webEngines: plan.webEngines,
      webQueries: plan.webQueries,
    },
    queriesRun,
    identityTokens: extractSubjectTokens(query),
  };
}
