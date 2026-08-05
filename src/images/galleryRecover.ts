/**
 * Host-targeted gallery recovery for low-frequency / niche subjects
 * that visual indexes (Bing/DDG Images) miss.
 *
 * Strategy (from manual recovery playbook):
 *   1. Search exact-name + "gallery" / site:image-hosts
 *   2. Identity-filter SERP hits
 *   3. Visit gallery pages and harvest full-size image URLs
 *   4. Caller downloads via downloadImages
 */

import { searchBing } from "../search/engines/bing";
import { searchDdg } from "../search/engines/ddg";
import { fetchPage } from "../page/fetchPage";
import { extractPage } from "../page/extract";
import {
  extractSubjectTokens,
  filterByIdentity,
  scoreIdentity,
  identityMinScore,
} from "../search/identity";
import type { EngineContext } from "../search/types";
import { preferFullImageUrl } from "./qualityProbe";

/** Generic SFW image hosts (ibb / postimg / imgur family). */
export const GALLERY_HOSTS_SFW = [
  "ibb.co",
  "imgbb.com",
  "i.ibb.co",
  "postimg.cc",
  "postimages.org",
  "imgur.com",
  "i.imgur.com",
] as const;

/** Adult / leak / album hosts — only used when NSFW is active. */
export const GALLERY_HOSTS_NSFW = [
  "imagebam.com",
  "imgbox.com",
  "russianstars",
  "imagefap.com",
  "imagevenue.com",
  "turboimagehost.com",
  "pixhost.to",
  "imgadult.com",
  "imagetwist.com",
  "imgchili",
  "sexyimg.eu",
  "erome.com",
  "coomer.su",
  "simpcity",
  "thotsbay",
  "fapello.com",
  "masterfap.net",
  "wildskirts.com",
  "thefappening",
  "thotslife.com",
  "leaknudes.com",
  "bunkr",
  "gofile.io",
  "cyberdrop",
] as const;

/** Full set (SFW + NSFW) for scoring when NSFW active. */
export const GALLERY_HOST_HINTS = [
  ...GALLERY_HOSTS_SFW,
  ...GALLERY_HOSTS_NSFW,
] as const;

function hostList(nsfwActive?: boolean): readonly string[] {
  return nsfwActive === false
    ? GALLERY_HOSTS_SFW
    : nsfwActive === true
      ? GALLERY_HOST_HINTS
      : GALLERY_HOST_HINTS; // default: full set for scoring back-compat
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isGalleryHost(url: string, nsfwActive?: boolean): boolean {
  const h = hostOf(url);
  return hostList(nsfwActive).some((g) => h.includes(g));
}

export function galleryHostScore(url: string, nsfwActive?: boolean): number {
  const h = hostOf(url);
  let s = 0;
  for (const g of hostList(nsfwActive)) {
    if (h.includes(g)) s += 3;
  }
  // Prefer direct image file URLs
  if (/\.(jpe?g|png|webp|gif|heic|avif)(\?|$)/i.test(url)) s += 2;
  // Prefer full-size path hints
  if (/\/(full|large|original|big|o\/|i\.ibb)/i.test(url)) s += 1;
  return s;
}

/**
 * Build host-targeted SERP queries for a subject (exact phrase when multi-token).
 * SFW: generic hosts + "gallery"/"photos" only — no adult host/site filters.
 * NSFW: keep adult host set (erome, fapello, imagefap, russianstars, …).
 */
export function buildGalleryQueries(
  query: string,
  nsfwActive: boolean = false,
): string[] {
  const tokens = extractSubjectTokens(query);
  const bare = tokens.join(" ").trim() || query.trim();
  const quoted = tokens.length >= 2 ? `"${tokens.join(" ")}"` : bare;
  const out: string[] = [];
  const add = (s: string) => {
    const t = s.replace(/\s+/g, " ").trim();
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  };

  add(`${quoted} gallery`);
  add(`${bare} gallery photos`);
  // site: filters — generic hosts only (SFW-safe)
  add(`${quoted} site:ibb.co OR site:imgbb.com OR site:postimg.cc`);
  add(`${quoted} site:imgur.com`);

  if (nsfwActive) {
    add(`${quoted} nude gallery`);
    add(`${quoted} leak`);
    add(`${quoted} site:russianstars.org OR site:imagefap.com`);
    add(`${quoted} site:erome.com OR site:fapello.com`);
    add(`${quoted} site:masterfap.net OR site:wildskirts.com`);
  }
  return out.slice(0, nsfwActive ? 5 : 4);
}

/** Extra image URLs from raw HTML (og:image, JSON blobs, href to media). */
export function harvestImageUrlsFromHtml(
  html: string,
  baseUrl: string,
  cap: number,
): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const push = (raw?: string | null) => {
    if (!raw) return;
    let u = raw.trim();
    if (u.startsWith("//")) u = "https:" + u;
    if (u.startsWith("/")) {
      try {
        u = new URL(u, baseUrl).href;
      } catch {
        return;
      }
    }
    if (!/^https?:\/\//i.test(u)) return;
    if (seen.has(u)) return;
    // skip tiny UI
    if (/favicon|sprite|logo\.svg|1x1|pixel/i.test(u)) return;
    seen.add(u);
    found.push(u);
  };

  // og / twitter meta
  const metaRe =
    /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image|og:image:url)["'][^>]+content=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = metaRe.exec(html)) && found.length < cap) push(m[1]);

  // content= before property=
  const metaRe2 =
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/gi;
  while ((m = metaRe2.exec(html)) && found.length < cap) push(m[1]);

  // data-full / data-src / data-url
  const dataRe =
    /\s(?:data-full|data-src|data-original|data-lazy|data-url|data-image)=["'](https?:[^"']+)["']/gi;
  while ((m = dataRe.exec(html)) && found.length < cap) push(m[1]);

  // href to image files or ibb full
  const hrefRe =
    /href=["'](https?:\/\/[^"']+\.(?:jpe?g|png|webp|gif|heic|avif)(?:\?[^"']*)?)["']/gi;
  while ((m = hrefRe.exec(html)) && found.length < cap) push(m[1]);

  // JSON "url":"https://...jpg"
  const jsonRe =
    /"(?:url|src|image|full|original|display_url)"\s*:\s*"(https?:\\\/\\\/[^"]+\.(?:jpe?g|png|webp)[^"]*)"/gi;
  while ((m = jsonRe.exec(html)) && found.length < cap) {
    push(m[1].replace(/\\\//g, "/").replace(/\\u0026/g, "&"));
  }

  // bare https image URLs in page
  const bareRe =
    /https?:\/\/[^\s"'<>]+?\.(?:jpe?g|png|webp)(?:\?[^\s"'<>]*)?/gi;
  while ((m = bareRe.exec(html)) && found.length < cap) {
    if (isGalleryHost(m[0]) || galleryHostScore(m[0]) >= 2) push(m[0]);
  }

  return found;
}

export interface GalleryRecoverResult {
  imageUrls: string[];
  pagesVisited: string[];
  queriesRun: string[];
  enginesUsed: string[];
}

/**
 * Host-targeted recovery: SERP → gallery pages → image URLs.
 * Pass nsfwActive so SFW avoids adult hosts/queries.
 */
export async function recoverGalleryImages(opts: {
  query: string;
  ctx: EngineContext;
  need: number;
  budgetMs: number;
  t0?: number;
  nsfwActive?: boolean;
}): Promise<GalleryRecoverResult> {
  const t0 = opts.t0 ?? Date.now();
  const nsfwActive = opts.nsfwActive === true;
  const budgetLeft = () => Math.max(0, opts.budgetMs - (Date.now() - t0));
  const tokens = extractSubjectTokens(opts.query);
  const minId = identityMinScore(tokens);
  const queries = buildGalleryQueries(opts.query, nsfwActive);
  const imageUrls: string[] = [];
  const pagesVisited: string[] = [];
  const enginesUsed: string[] = [];
  const pageHits: Array<{ title: string; url: string }> = [];

  for (const q of queries) {
    if (budgetLeft() < 4_000 || imageUrls.length >= opts.need) break;
    try {
      const hits = await searchBing(q, {
        ...opts.ctx,
        limit: 8,
        politeDelayMs: Math.min(opts.ctx.politeDelayMs, 60),
      });
      if (hits.length && !enginesUsed.includes("bing")) enginesUsed.push("bing");
      for (const h of hits) pageHits.push(h);
    } catch {
      /* try ddg */
    }
    if (pageHits.length < 4 && budgetLeft() > 5_000) {
      try {
        const hits = await searchDdg(q, {
          ...opts.ctx,
          limit: 6,
          politeDelayMs: Math.min(opts.ctx.politeDelayMs, 60),
        });
        if (hits.length && !enginesUsed.includes("ddg")) enginesUsed.push("ddg");
        for (const h of hits) pageHits.push(h);
      } catch {
        /* ignore */
      }
    }
  }

  // Prefer gallery hosts, then identity score
  const unique = new Map<string, { title: string; url: string; score: number }>();
  for (const h of filterByIdentity(pageHits, opts.query)) {
    if (unique.has(h.url)) continue;
    const id = scoreIdentity(h.title, h.url, tokens);
    const host =
      galleryHostScore(h.url, nsfwActive) +
      (isGalleryHost(h.url, nsfwActive) ? 5 : 0);
    // keep if strong identity OR gallery host with at least partial name
    if (tokens.length >= 2 && id < minId && host < 5) continue;
    unique.set(h.url, { ...h, score: id * 2 + host });
  }

  const ranked = [...unique.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  for (const hit of ranked) {
    if (budgetLeft() < 3_000 || imageUrls.length >= opts.need) break;
    try {
      const page = await fetchPage(hit.url, {
        signal: opts.ctx.signal,
        politeDelayMs: Math.min(opts.ctx.politeDelayMs, 50),
        jinaFallback: false,
        timeoutMs: Math.min(7_000, budgetLeft()),
        retries: 1,
      });
      pagesVisited.push(page.finalUrl);

      const extracted = extractPage(page.head, page.body, page.finalUrl, {
        maxLinks: 20,
        maxImages: 30,
        contentLimit: 500,
        findInPage: tokens.length ? tokens : undefined,
      });

      for (const [alt, src] of extracted.images) {
        const u = preferFullImageUrl(src, undefined);
        if (u) imageUrls.push(u);
        // prefer alts that match subject
        if (alt && tokens.length && scoreIdentity(alt, u || "", tokens) >= minId) {
          imageUrls.push(src);
        }
      }

      const harvested = harvestImageUrlsFromHtml(
        page.head + page.body,
        page.finalUrl,
        40,
      );
      imageUrls.push(...harvested);

      // Follow a few same-host gallery child links
      for (const [, href] of extracted.links.slice(0, 4)) {
        if (imageUrls.length >= opts.need || budgetLeft() < 3_000) break;
        if (
          !isGalleryHost(href, nsfwActive) &&
          !href.includes(hostOf(page.finalUrl))
        ) {
          continue;
        }
        if (pagesVisited.includes(href)) continue;
        try {
          const child = await fetchPage(href, {
            signal: opts.ctx.signal,
            politeDelayMs: 40,
            jinaFallback: false,
            timeoutMs: 5_000,
            retries: 1,
          });
          pagesVisited.push(child.finalUrl);
          imageUrls.push(
            ...harvestImageUrlsFromHtml(
              child.head + child.body,
              child.finalUrl,
              25,
            ),
          );
          const ex2 = extractPage(child.head, child.body, child.finalUrl, {
            maxLinks: 0,
            maxImages: 20,
            contentLimit: 200,
          });
          for (const [, src] of ex2.images) imageUrls.push(src);
        } catch {
          /* skip child */
        }
      }
    } catch {
      /* skip page */
    }
  }

  // Sort: gallery hosts first, dedupe
  const deduped = [...new Set(imageUrls.filter((u) => u.startsWith("http")))];
  deduped.sort(
    (a, b) => galleryHostScore(b, nsfwActive) - galleryHostScore(a, nsfwActive),
  );

  return {
    imageUrls: deduped.slice(0, Math.max(opts.need, 30)),
    pagesVisited,
    queriesRun: queries,
    enginesUsed,
  };
}
