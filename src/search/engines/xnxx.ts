/**
 * XNXX video search — HTML SERP with video pages + CDN thumbs.
 * Used as NSFW web + image source when traditional engines filter adult.
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

const BASE = "https://www.xnxx.com";

function parseResults(html: string, limit: number): AdultHit[] {
  const hits: AdultHit[] = [];
  const push = (hrefRaw: string, titleRaw: string, thumbRaw?: string) => {
    const path = hrefRaw.startsWith("http") ? hrefRaw : absUrl(hrefRaw, BASE);
    if (!path || !/\/video-/i.test(path)) return;
    if (hits.some((h) => h.url === path)) return;
    const title = stripHtml(titleRaw) || path;
    const thumb = thumbRaw ? absUrl(thumbRaw, BASE) || undefined : undefined;
    hits.push({
      title,
      url: path,
      thumb,
      snippet: "via XNXX",
      engine: "xnxx",
    });
  };

  // Common: <a href="/video-.../slug" title="..."> ... data-src="thumb"
  let m: RegExpExecArray | null;
  const reTitleHref =
    /<a[^>]+href="(\/video-[^"]+)"[^>]*title="([^"]+)"[^>]*>[\s\S]{0,800}?(?:data-src|src)="([^"]+\.(?:jpe?g|png|webp)[^"]*)"/gi;
  while (hits.length < limit && (m = reTitleHref.exec(html))) {
    push(m[1], m[2], m[3]);
  }

  if (hits.length < limit) {
    const re2 =
      /href="(\/video-[^"]+)"[\s\S]{0,500}?(?:data-src|data-srcset|src)="([^"]+thumb[^"]*\.(?:jpe?g|png|webp)[^"]*)"[\s\S]{0,300}?title="([^"]+)"/gi;
    while (hits.length < limit && (m = re2.exec(html))) {
      push(m[1], m[3], m[2]);
    }
  }

  // data-videoid blocks
  if (hits.length < 3) {
    const re3 =
      /href="(\/video-[^"]+)"[^>]*>[\s\S]{0,400}?(?:data-src|src)="((?:https?:)?\/\/[^"]*xnxx[^"]*\.(?:jpe?g|png|webp)[^"]*)"/gi;
    while (hits.length < limit && (m = re3.exec(html))) {
      const slug = m[1].split("/").pop()?.replace(/-/g, " ") || m[1];
      push(m[1], slug, m[2]);
    }
  }

  return hits;
}

export async function searchXnxxAdult(
  query: string,
  ctx: EngineContext,
): Promise<AdultHit[]> {
  const url = `${BASE}/search/${encodeURIComponent(query).replace(/%20/g, "+")}`;
  const res = await fetchText(url, {
    signal: ctx.signal,
    politeDelayMs: Math.min(ctx.politeDelayMs, 100),
    mode: "document",
    referer: BASE + "/",
    timeoutMs: 14_000,
    retries: 1,
  });
  if (isCloudflareBlock(res.text, res.status)) {
    throw new Error("XNXX blocked (Cloudflare)");
  }
  if (!res.ok) throw new Error(`XNXX HTTP ${res.status}`);
  return parseResults(res.text, Math.max(ctx.limit, 8));
}

export async function searchXnxx(
  query: string,
  ctx: EngineContext,
): Promise<SearchHit[]> {
  return toSearchHits(await searchXnxxAdult(query, ctx));
}

export async function xnxxImageUrls(
  query: string,
  ctx: EngineContext,
  cap: number,
): Promise<string[]> {
  const hits = await searchXnxxAdult(query, {
    ...ctx,
    limit: Math.max(cap, 12),
  });
  return thumbsFromHits(hits, cap);
}
