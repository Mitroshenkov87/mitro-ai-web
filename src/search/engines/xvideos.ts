/**
 * XVideos search SERP — video pages + CDN thumbs for NSFW mode.
 */
import { fetchText } from "../../net/http";
import type { EngineContext, SearchHit } from "../types";
import {
  absUrl,
  isCloudflareBlock,
  stripHtml,
  thumbsFromHits,
  toSearchHits,
  type AdultHit,
} from "./adultCommon";

const BASE = "https://www.xvideos.com";

function parseResults(html: string, limit: number): AdultHit[] {
  const hits: AdultHit[] = [];
  const push = (hrefRaw: string, titleRaw: string, thumbRaw?: string) => {
    const path = hrefRaw.startsWith("http") ? hrefRaw : absUrl(hrefRaw, BASE);
    // xvideos paths: /video.12345/slug
    if (!path || !/\/video\./i.test(path)) return;
    if (hits.some((h) => h.url === path)) return;
    hits.push({
      title: stripHtml(titleRaw) || path,
      url: path,
      thumb: thumbRaw ? absUrl(thumbRaw, BASE) || undefined : undefined,
      snippet: "via XVideos",
      engine: "xvideos",
    });
  };

  let m: RegExpExecArray | null;
  // title= on anchor, href=/video.ID/slug
  const re1 =
    /<a[^>]+href="(\/video\.[^"]+)"[^>]*title="([^"]+)"[\s\S]{0,600}?(?:data-src|src)="([^"]+\.(?:jpe?g|png|webp)[^"]*)"/gi;
  while (hits.length < limit && (m = re1.exec(html))) {
    push(m[1], m[2], m[3]);
  }

  if (hits.length < limit) {
    const re2 =
      /title="([^"]+)"[^>]*href="(\/video\.[^"]+)"[\s\S]{0,500}?(?:data-src|src)="([^"]+\.(?:jpe?g|png|webp)[^"]*)"/gi;
    while (hits.length < limit && (m = re2.exec(html))) {
      push(m[2], m[1], m[3]);
    }
  }

  if (hits.length < 3) {
    const re3 =
      /href="(\/video\.[^"]+)"[\s\S]{0,400}?(?:data-src|src)="((?:https?:)?\/\/[^"]*xvideos[^"]*\.(?:jpe?g|png|webp)[^"]*)"/gi;
    while (hits.length < limit && (m = re3.exec(html))) {
      const slug = decodeURIComponent(
        m[1].split("/").pop()?.replace(/-/g, " ") || m[1],
      );
      push(m[1], slug, m[2]);
    }
  }

  return hits;
}

export async function searchXvideosAdult(
  query: string,
  ctx: EngineContext,
): Promise<AdultHit[]> {
  const url = new URL(BASE + "/");
  url.searchParams.set("k", query);
  const res = await fetchText(url.toString(), {
    signal: ctx.signal,
    politeDelayMs: Math.min(ctx.politeDelayMs, 100),
    mode: "document",
    referer: BASE + "/",
    timeoutMs: 14_000,
    retries: 1,
  });
  if (isCloudflareBlock(res.text, res.status)) {
    throw new Error("XVideos blocked (Cloudflare)");
  }
  if (!res.ok) throw new Error(`XVideos HTTP ${res.status}`);
  return parseResults(res.text, Math.max(ctx.limit, 8));
}

export async function searchXvideos(
  query: string,
  ctx: EngineContext,
): Promise<SearchHit[]> {
  return toSearchHits(await searchXvideosAdult(query, ctx));
}

export async function xvideosImageUrls(
  query: string,
  ctx: EngineContext,
  cap: number,
): Promise<string[]> {
  const hits = await searchXvideosAdult(query, {
    ...ctx,
    limit: Math.max(cap, 12),
  });
  return thumbsFromHits(hits, cap);
}
