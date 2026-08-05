import { fetchText, delay } from "../net/http";
import { browserHeaders } from "../net/headers";
import { searchDdg } from "../search/engines/ddg";
import { searchBing } from "../search/engines/bing";
import { fetchPage } from "../page/fetchPage";
import { extractPage } from "../page/extract";
import { downloadImages } from "./download";
import { preferFullImageUrl } from "./qualityProbe";
import { bingImageUrls } from "./bingImages";
import {
  recoverGalleryImages,
  galleryHostScore,
  harvestImageUrlsFromHtml,
} from "./galleryRecover";
import { collectAdultImageUrls } from "./adultImageSources";
import { type NsfwIntensity } from "../nsfw/keywords";
import { extractSubjectTokens, filterByIdentity } from "../search/identity";
import type { EngineContext } from "../search/types";
import { ddgImageP, ddgKp, normalizeSafeLevel } from "../search/safeSearch";
import { applyPlanToCtx, buildSearchPlan } from "../search/plan";
import { searchNudevista } from "../search/engines/nudevista";
import { searchXnxx } from "../search/engines/xnxx";

function extractVqd(html: string): string | null {
  return (
    html.match(/vqd=['"]([^'"]+)['"]/)?.[1] ||
    html.match(/vqd=([\d-]+)/)?.[1] ||
    html.match(/vqd=([\d-]+)&/)?.[1] ||
    null
  );
}

async function ddgImageUrls(
  query: string,
  ctx: EngineContext,
  cap: number,
): Promise<string[]> {
  const urls: string[] = [];
  const headers = browserHeaders({
    mode: "document",
    referer: "https://duckduckgo.com/",
  });
  const initialUrl = new URL("https://duckduckgo.com/");
  const safe = normalizeSafeLevel(ctx.safeSearch);
  initialUrl.searchParams.set("q", query);
  initialUrl.searchParams.set("iax", "images");
  initialUrl.searchParams.set("ia", "images");
  // Always explicit SafeSearch (kp=-2 off by default)
  initialUrl.searchParams.set("kp", ddgKp(safe));

  const initial = await fetchText(initialUrl.toString(), {
    signal: ctx.signal,
    politeDelayMs: Math.min(ctx.politeDelayMs, 100),
    headers,
    timeoutMs: 10_000,
    retries: 1,
  });
  if (/anomaly|captcha/i.test(initial.text) && initial.text.length < 20000) {
    return urls;
  }
  const vqd = extractVqd(initial.text);
  if (!vqd) return urls;

  await delay(150 + Math.floor(Math.random() * 100));
  const searchUrl = new URL("https://duckduckgo.com/i.js");
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("o", "json");
  searchUrl.searchParams.set("l", "us-en");
  searchUrl.searchParams.set("vqd", vqd);
  searchUrl.searchParams.set("f", ",,,,,");
  // DDG images: p=1 off-ish; always set
  searchUrl.searchParams.set("p", ddgImageP(safe));

  const imgRes = await fetchText(searchUrl.toString(), {
    signal: ctx.signal,
    politeDelayMs: Math.min(ctx.politeDelayMs, 80),
    mode: "json",
    timeoutMs: 10_000,
    retries: 1,
    headers: {
      ...browserHeaders({ mode: "json", referer: initialUrl.toString() }),
    },
    retryStatus: [403, 429, 500, 502, 503, 504],
  });
  if (!imgRes.ok) return urls;

  try {
    const data = JSON.parse(imgRes.text) as {
      results?: Array<{
        image?: string;
        thumbnail?: string;
        title?: string;
        width?: number;
        height?: number;
      }>;
    };
    for (const r of data.results || []) {
      const u = preferFullImageUrl(r.image, r.thumbnail);
      if (u) urls.push(u);
      if (urls.length >= cap) break;
    }
  } catch {
    /* ignore parse */
  }
  return urls;
}

/** Build leak-profile URLs from subject name (fapello / masterfap / …). */
function leakProfileUrls(query: string): string[] {
  const tokens = extractSubjectTokens(query);
  if (tokens.length < 2) return [];
  // Prefer latin slug pairs: zhenya-belaya style
  const latin = tokens.filter((t) => /^[a-z0-9'-]+$/i.test(t));
  const slugs: string[] = [];
  if (latin.length >= 2) {
    slugs.push(latin.slice(0, 2).join("-"));
    if (latin.length >= 3) slugs.push(latin.slice(0, 3).join("-"));
  }
  // Also full token slug
  if (tokens.length >= 2) {
    slugs.push(tokens.slice(0, 2).join("-"));
  }
  const uniq = [...new Set(slugs.map((s) => s.toLowerCase().replace(/'+/g, "")))];
  const out: string[] = [];
  for (const slug of uniq.slice(0, 3)) {
    out.push(`https://fapello.com/${slug}/`);
    out.push(`https://www.masterfap.net/profile/${slug}/`);
    out.push(`https://wildskirts.com/${slug}`);
    out.push(`https://thotslife.com/${slug}/`);
  }
  return out;
}

export async function imageSearch(opts: {
  query: string;
  limit: number;
  workingDirectory: string;
  ctx: EngineContext;
  jinaFallback?: boolean;
  allowSiteScraping?: boolean;
  allowChromeDevtools?: boolean;
  chromeDebugPort?: number;
  minShortSide?: number;
  nsfw?: boolean;
  nsfwMode?: NsfwIntensity;
  nsfwExtraKeywords?: string;
}): Promise<Record<string, unknown>> {
  const { query, limit, workingDirectory } = opts;

  // Same plan as web_search — SFW/NSFW cannot drift
  const plan = buildSearchPlan(query, {
    nsfw: opts.nsfw,
    nsfwMode: opts.nsfwMode,
    nsfwExtraKeywords: opts.nsfwExtraKeywords,
    pluginSafeSearch: opts.ctx.safeSearch,
  });
  const nsfw = plan.nsfw;
  const ctx = applyPlanToCtx(
    {
      ...opts.ctx,
      politeDelayMs: Math.min(
        opts.ctx.politeDelayMs,
        nsfw.active ? 80 : 100,
      ),
    },
    plan,
  );

  const queries = plan.imageQueries;
  let imageUrls: string[] = [];
  const sourcesUsed: string[] = [];
  const t0 = Date.now();
  const budgetMs = plan.imageBudgetMs;
  const need = Math.max(limit * 3, 12);
  const enoughForDownload = () => imageUrls.length >= need;
  const allowScrape = opts.allowSiteScraping !== false;
  const pageFetchOpts = {
    jinaFallback: opts.jinaFallback,
    allowChromeDevtools:
      Boolean(opts.allowChromeDevtools) && allowScrape,
    chromeDebugPort: opts.chromeDebugPort ?? 9222,
  };

  // ── Unified pipeline (SFW & NSFW share order; NSFW adds adult/leak steps) ──
  // 1) Bing Images FIRST always (SafeSearch from plan — off in NSFW).
  //    Conversation showed tube thumbs 404; Bing often still has model stills.
  const bingFirst = queries.slice(0, 2);
  const bingRest = queries.slice(2);
  if (bingFirst.length && Date.now() - t0 <= budgetMs && !enoughForDownload()) {
    try {
      const batches = await Promise.all(
        bingFirst.map(async (q) => {
          try {
            return await bingImageUrls(q, ctx, need);
          } catch {
            return [] as string[];
          }
        }),
      );
      for (const batch of batches) {
        if (batch.length) {
          if (!sourcesUsed.includes("bing_images")) sourcesUsed.push("bing_images");
          imageUrls.push(...batch);
        }
      }
      imageUrls = [...new Set(imageUrls)];
    } catch {
      /* ignore */
    }
  }
  for (const q of bingRest) {
    if (Date.now() - t0 > budgetMs || enoughForDownload()) break;
    try {
      const batch = await bingImageUrls(q, ctx, need);
      if (batch.length) {
        if (!sourcesUsed.includes("bing_images")) sourcesUsed.push("bing_images");
        imageUrls.push(...batch);
        imageUrls = [...new Set(imageUrls)];
      }
    } catch {
      /* next */
    }
  }

  // 2) DDG images — only if still thin
  if (!enoughForDownload() && Date.now() - t0 < budgetMs - 6_000) {
    for (const q of queries.slice(0, 2)) {
      if (Date.now() - t0 > budgetMs || enoughForDownload()) break;
      try {
        const batch = await ddgImageUrls(q, ctx, need);
        if (batch.length) {
          if (!sourcesUsed.includes("ddg_images")) sourcesUsed.push("ddg_images");
          imageUrls.push(...batch);
          imageUrls = [...new Set(imageUrls)];
        }
      } catch {
        /* next */
      }
    }
  }

  // 3) NSFW: specialized profile pages — real photos, not tube thumbs
  if (
    allowScrape &&
    nsfw.active &&
    !enoughForDownload() &&
    Date.now() - t0 < budgetMs - 8_000
  ) {
    const profiles = leakProfileUrls(query);
    if (profiles.length) {
      if (!sourcesUsed.includes("leak_profiles")) sourcesUsed.push("leak_profiles");
      for (const url of profiles) {
        if (Date.now() - t0 > budgetMs || enoughForDownload()) break;
        try {
          const page = await fetchPage(url, {
            signal: ctx.signal,
            politeDelayMs: Math.min(ctx.politeDelayMs, 60),
            jinaFallback: pageFetchOpts.jinaFallback !== false,
            allowChromeDevtools: pageFetchOpts.allowChromeDevtools,
            chromeDebugPort: pageFetchOpts.chromeDebugPort,
            timeoutMs: 8_000,
            retries: 0,
          });
          const harvested = harvestImageUrlsFromHtml(
            page.html || page.body,
            page.finalUrl || url,
            24,
          );
          const extracted = extractPage(page.head, page.body, page.finalUrl, {
            maxLinks: 0,
            maxImages: 20,
            contentLimit: 100,
          });
          for (const [, src] of extracted.images) imageUrls.push(src);
          imageUrls.push(...harvested);
          imageUrls = [...new Set(imageUrls)];
        } catch {
          /* next profile */
        }
      }
    }
  }

  // 4) NSFW: adult SERP thumbs (NudeVista/tubes) — after Bing/leaks; need CDN Referer
  if (
    nsfw.active &&
    !enoughForDownload() &&
    Date.now() - t0 < budgetMs - 6_000
  ) {
    try {
      const adultQ = queries[0] || query;
      const adult = await collectAdultImageUrls({
        query: adultQ,
        ctx,
        cap: need,
        signal: ctx.signal,
        timeoutMs: 10_000,
      });
      if (adult.urls.length) {
        imageUrls.push(...adult.urls);
        imageUrls = [...new Set(imageUrls)];
        for (const s of adult.sourcesUsed) {
          if (!sourcesUsed.includes(`adult_${s}`))
            sourcesUsed.push(`adult_${s}`);
        }
      }
    } catch {
      /* best-effort */
    }
  }

  // 5) Web SERP scrape — only when visual indexes are sparse + scraping allowed
  const trulyThin = imageUrls.length < Math.max(limit, 4);
  if (
    allowScrape &&
    trulyThin &&
    Date.now() - t0 < budgetMs - 10_000
  ) {
    if (!sourcesUsed.includes("web_scrape")) sourcesUsed.push("web_scrape");
    const webQ = queries[0] || query;
    let hits: Array<{ title: string; url: string }> = [];
    if (nsfw.active) {
      try {
        hits = await searchNudevista(webQ, { ...ctx, limit: 6 });
      } catch {
        /* ignore */
      }
      if (hits.length < 3) {
        try {
          const x = await searchXnxx(webQ, { ...ctx, limit: 6 });
          hits = [...hits, ...x];
        } catch {
          /* ignore */
        }
      }
    }
    if (hits.length < 3) {
      try {
        const b = await searchBing(webQ, { ...ctx, limit: 6 });
        hits = [...hits, ...b];
      } catch {
        /* ignore */
      }
    }
    if (hits.length < 3) {
      try {
        const d = await searchDdg(webQ, { ...ctx, limit: 6 });
        hits = [...hits, ...d];
      } catch {
        /* ignore */
      }
    }
    hits = filterByIdentity(hits, query, { strict: nsfw.active }).slice(
      0,
      nsfw.active ? 6 : 4,
    );

    for (const hit of hits) {
      if (Date.now() - t0 > budgetMs || enoughForDownload()) break;
      try {
        const page = await fetchPage(hit.url, {
          signal: ctx.signal,
          politeDelayMs: Math.min(ctx.politeDelayMs, 60),
          jinaFallback: nsfw.active ? false : pageFetchOpts.jinaFallback,
          allowChromeDevtools: pageFetchOpts.allowChromeDevtools,
          chromeDebugPort: pageFetchOpts.chromeDebugPort,
          timeoutMs: 5_000,
          retries: 0,
        });
        const extracted = extractPage(page.head, page.body, page.finalUrl, {
          maxLinks: 0,
          maxImages: nsfw.active ? 16 : 12,
          contentLimit: 200,
        });
        for (const [, src] of extracted.images) {
          imageUrls.push(src);
        }
        imageUrls.push(
          ...harvestImageUrlsFromHtml(
            page.html || page.body,
            page.finalUrl || hit.url,
            12,
          ),
        );
      } catch {
        /* skip page */
      }
    }
  }

  // 6) HOST-TARGETED GALLERY RECOVERY
  let galleryMeta: {
    pagesVisited: string[];
    queriesRun: string[];
  } | null = null;
  if (
    allowScrape &&
    imageUrls.length < Math.max(limit, 4) &&
    Date.now() - t0 < budgetMs - 8_000
  ) {
    try {
      const gallerySubject =
        queries[0] ||
        extractSubjectTokens(query).join(" ") ||
        query;
      const rec = await recoverGalleryImages({
        query: gallerySubject,
        ctx,
        need: Math.max(need, limit * 4),
        budgetMs: Math.min(18_000, budgetMs - (Date.now() - t0)),
        t0: Date.now(),
        nsfwActive: nsfw.active,
      });
      if (rec.imageUrls.length) {
        if (!sourcesUsed.includes("gallery_host_heuristics")) {
          sourcesUsed.push("gallery_host_heuristics");
        }
        imageUrls.push(...rec.imageUrls);
        galleryMeta = {
          pagesVisited: rec.pagesVisited,
          queriesRun: rec.queriesRun,
        };
        for (const e of rec.enginesUsed) {
          if (!sourcesUsed.includes(e)) sourcesUsed.push(e);
        }
      }
    } catch {
      /* recovery best-effort */
    }
  }

  // Prefer gallery-host / leak URLs over tube CDN thumbs when ranking
  imageUrls = [...new Set(imageUrls.filter((u) => u.startsWith("http")))];
  imageUrls.sort((a, b) => {
    const ga = galleryHostScore(a, nsfw.active);
    const gb = galleryHostScore(b, nsfw.active);
    if (gb !== ga) return gb - ga;
    // Deprioritize tube CDN thumbs (often 404 / tiny)
    const ta = /xvideos-cdn|xnxx-cdn|thumb-cdn/i.test(a) ? 1 : 0;
    const tb = /xvideos-cdn|xnxx-cdn|thumb-cdn/i.test(b) ? 1 : 0;
    return ta - tb;
  });
  const source = sourcesUsed.join("+") || "none";
  const allQueries = [
    ...queries,
    ...(galleryMeta?.queriesRun || []),
  ].filter((q, i, a) => a.indexOf(q) === i);

  if (imageUrls.length === 0) {
    return {
      error: "no_images",
      message:
        "Could not find image candidates (Bing + gallery/leak + adult SERP empty). " +
        "Try exact quoted name, alternate spelling, or Google API key.",
      source,
      nsfw,
      searchPlan: {
        mode: plan.imagePipeline,
        safeSearch: plan.safeSearch,
        webEngines: plan.webEngines,
      },
      queriesRun: allQueries,
      identityTokens: extractSubjectTokens(query),
      galleryPages: galleryMeta?.pagesVisited || [],
      filesSaved: 0,
    };
  }

  // ALWAYS download — CDN thumbs need correct Referer (see download.ts)
  const minSide = opts.minShortSide ?? (nsfw.active ? 160 : 240);
  const downloaded = await downloadImages(imageUrls, workingDirectory, {
    signal: ctx.signal,
    politeDelayMs: Math.min(ctx.politeDelayMs, 100),
    max: limit,
    minShortSide: minSide,
  });

  let finalDownload = downloaded;
  if ((downloaded.count || 0) === 0 && imageUrls.length > 0) {
    finalDownload = await downloadImages(imageUrls, workingDirectory, {
      signal: ctx.signal,
      politeDelayMs: Math.min(ctx.politeDelayMs, 80),
      max: limit,
      minShortSide: nsfw.active
        ? Math.min(minSide, 100)
        : Math.min(minSide, 160),
    });
  }

  return {
    ...finalDownload,
    source,
    query,
    nsfw,
    searchPlan: {
      mode: plan.imagePipeline,
      safeSearch: plan.safeSearch,
      queries: plan.imageQueries,
    },
    queriesRun: allQueries,
    identityTokens: extractSubjectTokens(query),
    candidatesFound: imageUrls.length,
    galleryPages: galleryMeta?.pagesVisited || [],
    filesSaved: finalDownload.count ?? 0,
    localFiles: (finalDownload.images || []) as string[],
    policy:
      `Unified plan (${plan.imagePipeline}, safeSearch=${plan.safeSearch}): ` +
      "Bing Images first → " +
      (nsfw.active
        ? "leak profiles (fapello/…) → adult SERP thumbs → scrape/gallery. "
        : "DDG/scrape/gallery if thin. ") +
      "Full images only (no -thumb). CDN downloads use parent-site Referer. " +
      (nsfw.active
        ? "NSFW: short subject + one tag; identity-strict SERP; tube noise dropped."
        : "SFW: NSFW dictionary stripped from engine queries."),
  };
}
