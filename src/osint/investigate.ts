import { webSearch } from "../search/auto";
import type { EngineContext } from "../search/types";
import { fetchPage } from "../page/fetchPage";
import { extractPage } from "../page/extract";
import { harvestFromText } from "./entities";
import {
  decideNsfw,
  expandNsfwQueries,
  type NsfwIntensity,
} from "../nsfw/keywords";

export interface OsintOptions {
  query: string;
  maxPasses?: number;
  maxPages?: number;
  ctx: EngineContext;
  jinaFallback?: boolean;
  /** When false, only search — no visit pages. */
  allowSiteScraping?: boolean;
  allowChromeDevtools?: boolean;
  chromeDebugPort?: number;
  maxContentChars?: number;
  status?: (s: string) => void;
  nsfw?: boolean;
  nsfwMode?: NsfwIntensity;
  nsfwExtraKeywords?: string;
  /** Hard wall-clock budget for the whole OSINT run (ms). */
  budgetMs?: number;
}

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

export async function osintInvestigate(opts: OsintOptions) {
  const nsfw = decideNsfw(
    opts.query,
    opts.nsfwMode ?? "auto",
    opts.nsfw,
    opts.nsfwExtraKeywords,
  );

  // NSFW / image-ish OSINT must stay lean — models often misuse this for "find images"
  const maxPasses = Math.max(
    1,
    Math.min(opts.maxPasses ?? (nsfw.active ? 2 : 3), nsfw.active ? 2 : 4),
  );
  const maxPages = Math.max(
    2,
    Math.min(opts.maxPages ?? (nsfw.active ? 4 : 8), nsfw.active ? 6 : 12),
  );
  const contentLimit = Math.min(opts.maxContentChars ?? 8000, nsfw.active ? 4000 : 8000);
  const status = opts.status ?? (() => undefined);
  const budgetMs = opts.budgetMs ?? (nsfw.active ? 35_000 : 50_000);
  const pageTimeoutMs = nsfw.active ? 6_000 : 8_000;
  const t0 = Date.now();
  const budgetLeft = () => Math.max(0, budgetMs - (Date.now() - t0));
  const overBudget = () => Date.now() - t0 >= budgetMs;

  const ctx: EngineContext = nsfw.active
    ? { ...opts.ctx, safeSearch: "off", politeDelayMs: Math.min(opts.ctx.politeDelayMs, 80) }
    : { ...opts.ctx, politeDelayMs: Math.min(opts.ctx.politeDelayMs, 150) };

  const allSources: Array<{
    url: string;
    title: string;
    engine?: string;
    excerpt: string;
    pass: number;
  }> = [];
  const allEntities = new Set<string>();
  const allEmails = new Set<string>();
  const queriesRun: string[] = [];
  const openQuestions: string[] = [];

  status(
    nsfw.active
      ? `OSINT pass 1: search (NSFW ${nsfw.intensity}, budget ${Math.round(budgetMs / 1000)}s)`
      : `OSINT pass 1: multi-engine search (budget ${Math.round(budgetMs / 1000)}s)`,
  );
  queriesRun.push(opts.query);

  // NSFW: do NOT fan out extra free engines (osintBoost) — they mostly timeout
  const search1 = await webSearch(
    opts.query,
    "auto",
    {
      ...ctx,
      limit: Math.min(Math.max(ctx.limit, 10), nsfw.active ? 12 : 16),
    },
    {
      osintBoost: !nsfw.active,
      nsfw: opts.nsfw,
      nsfwMode: opts.nsfwMode,
      nsfwExtraKeywords: opts.nsfwExtraKeywords,
    },
  );

  let candidateUrls = search1.results.map((r) => ({
    url: r.url,
    title: r.title,
    engine: r.engine,
  }));

  if (maxPasses >= 2 && !overBudget() && candidateUrls.length < maxPages) {
    const alts = nsfw.active
      ? expandNsfwQueries(opts.query, nsfw).slice(1, 2) // one alt only
      : [`${opts.query} overview OR profile OR company OR person`];

    for (const alt of alts) {
      if (overBudget()) break;
      queriesRun.push(alt);
      status(`OSINT pass 1b: ${alt.slice(0, 50)} (${Math.round(budgetLeft() / 1000)}s left)`);
      const searchAlt = await webSearch(alt, "auto", ctx, {
        osintBoost: false,
        nsfw: nsfw.active ? true : opts.nsfw,
        nsfwMode: opts.nsfwMode,
        nsfwExtraKeywords: opts.nsfwExtraKeywords,
      });
      for (const r of searchAlt.results) {
        if (!candidateUrls.some((c) => c.url === r.url)) {
          candidateUrls.push({ url: r.url, title: r.title, engine: r.engine });
        }
      }
    }
  }

  const toVisit = candidateUrls.slice(0, maxPages);
  // Use jina only when explicitly enabled and we still have budget (often hangs on NSFW sites)
  const allowScrape = opts.allowSiteScraping !== false;
  const useJina = Boolean(opts.jinaFallback) && !nsfw.active;
  const chromeOpts = {
    allowChromeDevtools: Boolean(opts.allowChromeDevtools) && allowScrape,
    chromeDebugPort: opts.chromeDebugPort ?? 9222,
  };

  if (!allowScrape) {
    openQuestions.push(
      "Site scraping is OFF — search-only OSINT (enable Allow site scraping to visit pages).",
    );
    toVisit.length = 0;
  }

  status(
    `OSINT pass 2: harvest ${toVisit.length} pages (${Math.round(budgetLeft() / 1000)}s left)`,
  );

  if (toVisit.length === 0 && allowScrape) {
    openQuestions.push(
      "No search hits to visit — try image_search for photos, or web_search with a simpler query.",
    );
  }

  for (let i = 0; i < toVisit.length; i++) {
    if (ctx.signal?.aborted || overBudget()) {
      openQuestions.push(
        overBudget()
          ? `OSINT budget ${budgetMs}ms exhausted during page harvest — partial results returned.`
          : "OSINT aborted by client.",
      );
      break;
    }
    const item = toVisit[i];
    status(`OSINT pass 2: page ${i + 1}/${toVisit.length} ${item.url.slice(0, 48)}`);
    try {
      const page = await withTimeoutAbort(
        (signal) =>
          fetchPage(item.url, {
            signal,
            politeDelayMs: ctx.politeDelayMs,
            jinaFallback: useJina,
            allowChromeDevtools: chromeOpts.allowChromeDevtools,
            chromeDebugPort: chromeOpts.chromeDebugPort,
            timeoutMs: Math.min(pageTimeoutMs, budgetLeft()),
            retries: 1,
          }),
        Math.min(pageTimeoutMs + 500, budgetLeft() || pageTimeoutMs),
        `page ${item.url.slice(0, 40)}`,
        ctx.signal,
      );
      const ex = extractPage(page.head, page.body, page.finalUrl, {
        maxLinks: 15,
        maxImages: 0,
        contentLimit,
      });
      const harvest = harvestFromText(
        ex.content + " " + ex.links.map((l) => l[1]).join(" "),
      );
      harvest.entities.forEach((e) => allEntities.add(e));
      harvest.emails.forEach((e) => allEmails.add(e));
      allSources.push({
        url: page.finalUrl,
        title: ex.title || item.title,
        engine: item.engine,
        excerpt: ex.content.slice(0, 1200),
        pass: 2,
      });
      // Don't expand link fan-out on NSFW — it multiplies hanging page visits
      if (!nsfw.active) {
        for (const [, href] of ex.links.slice(0, 3)) {
          if (
            !candidateUrls.some((c) => c.url === href) &&
            candidateUrls.length < maxPages + 6
          ) {
            candidateUrls.push({ url: href, title: href, engine: "follow" });
          }
        }
      }
    } catch (e) {
      allSources.push({
        url: item.url,
        title: item.title,
        engine: item.engine,
        excerpt: "",
        pass: 2,
      });
      openQuestions.push(
        `Failed to open ${item.url}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Pass 3 only for SFW deep research with budget left
  if (maxPasses >= 3 && !nsfw.active && allEntities.size > 0 && !overBudget()) {
    status("OSINT pass 3: entity expansion search");
    const topEntities = [...allEntities].slice(0, 3);
    for (const ent of topEntities) {
      if (overBudget()) break;
      const q = `${ent} ${opts.query}`;
      const qTrim = q.slice(0, 120);
      if (queriesRun.includes(qTrim)) continue;
      queriesRun.push(qTrim);
      try {
        const s = await webSearch(qTrim, "auto", { ...ctx, limit: 6 }, {
          osintBoost: false,
          nsfw: opts.nsfw,
          nsfwMode: opts.nsfwMode,
          nsfwExtraKeywords: opts.nsfwExtraKeywords,
        });
        for (const r of s.results.slice(0, 2)) {
          if (overBudget()) break;
          if (allSources.some((x) => x.url === r.url)) continue;
          if (allSources.length >= maxPages + 4) break;
          try {
            const page = await withTimeoutAbort(
              (signal) =>
                fetchPage(r.url, {
                  signal,
                  politeDelayMs: ctx.politeDelayMs,
                  jinaFallback: useJina,
                  allowChromeDevtools: chromeOpts.allowChromeDevtools,
                  chromeDebugPort: chromeOpts.chromeDebugPort,
                  timeoutMs: Math.min(pageTimeoutMs, budgetLeft()),
                  retries: 1,
                }),
              Math.min(pageTimeoutMs + 500, budgetLeft() || pageTimeoutMs),
              `entity page`,
              ctx.signal,
            );
            const ex = extractPage(page.head, page.body, page.finalUrl, {
              maxLinks: 8,
              maxImages: 0,
              contentLimit: Math.min(contentLimit, 4000),
            });
            harvestFromText(ex.content).entities.forEach((e) =>
              allEntities.add(e),
            );
            allSources.push({
              url: page.finalUrl,
              title: ex.title || r.title,
              engine: r.engine,
              excerpt: ex.content.slice(0, 800),
              pass: 3,
            });
          } catch {
            /* skip */
          }
        }
      } catch {
        /* skip entity query */
      }
    }
  }

  if (allSources.length < 2) {
    openQuestions.push(
      "Few sources collected — for photos use image_search; for web facts use web_search. Optional: Google API key.",
    );
  }

  const recommended_next_queries = nsfw.active
    ? [
        ...expandNsfwQueries(opts.query, nsfw).slice(1, 4),
        ...[...allEntities].slice(0, 2).map((e) => `${e} artistic nude`),
      ].slice(0, 6)
    : [
        ...[...allEntities].slice(0, 3).map((e) => `${e} ${opts.query}`),
        `"${opts.query}" site:linkedin.com OR site:github.com OR site:wikipedia.org`,
      ].slice(0, 6);

  return {
    mode: "osint",
    query: opts.query,
    nsfw,
    passes: maxPasses,
    elapsedMs: Date.now() - t0,
    budgetMs,
    queriesRun,
    enginesUsed: search1.enginesUsed,
    enginesSkipped: search1.enginesSkipped,
    enginesFailed: search1.enginesFailed,
    entities: [...allEntities].slice(0, 40),
    emails: [...allEmails].slice(0, 15),
    sources: allSources,
    open_questions: openQuestions,
    recommended_next_queries,
    hint:
      "Use sources[].excerpt and entities to write a structured report with citations. " +
      "For finding/saving photos prefer image_search (not osint_investigate)." +
      (nsfw.active
        ? " NSFW mode was active — expect adult/artistic photography sources."
        : ""),
  };
}
