/**
 * Eporner search — often allows unauthenticated HTML SERP.
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

const BASE = "https://www.eporner.com";

function parseResults(html: string, limit: number): AdultHit[] {
  const hits: AdultHit[] = [];
  let m: RegExpExecArray | null;

  const re1 =
    /href="(\/video-[^"]+\/?)"[^>]*title="([^"]+)"[\s\S]{0,500}?(?:data-src|src)="([^"]+\.(?:jpe?g|png|webp)[^"]*)"/gi;
  while (hits.length < limit && (m = re1.exec(html))) {
    const url = absUrl(m[1], BASE);
    if (!url) continue;
    if (hits.some((h) => h.url === url)) continue;
    hits.push({
      title: stripHtml(m[2]),
      url,
      thumb: absUrl(m[3], BASE) || undefined,
      snippet: "via Eporner",
      engine: "eporner",
    });
  }

  if (hits.length < 3) {
    const re2 =
      /href="(\/video-[A-Za-z0-9]+\/[^"]+)"[^>]*>([^<]{5,100})</gi;
    while (hits.length < limit && (m = re2.exec(html))) {
      const url = absUrl(m[1], BASE);
      if (!url || hits.some((h) => h.url === url)) continue;
      hits.push({
        title: stripHtml(m[2]),
        url,
        engine: "eporner",
      });
    }
  }

  return hits;
}

export async function searchEpornerAdult(
  query: string,
  ctx: EngineContext,
): Promise<AdultHit[]> {
  const slug = query.trim().replace(/\s+/g, "-");
  const url = `${BASE}/search/${encodeURIComponent(slug)}/`;
  const res = await fetchText(url, {
    signal: ctx.signal,
    politeDelayMs: Math.min(ctx.politeDelayMs, 100),
    mode: "document",
    referer: BASE + "/",
    timeoutMs: 14_000,
    retries: 1,
  });
  if (isCloudflareBlock(res.text, res.status)) {
    throw new Error("Eporner blocked (Cloudflare)");
  }
  // 404 may still contain related results
  if (!res.ok && res.status !== 404) throw new Error(`Eporner HTTP ${res.status}`);
  return parseResults(res.text, Math.max(ctx.limit, 8));
}

export async function searchEporner(
  query: string,
  ctx: EngineContext,
): Promise<SearchHit[]> {
  return toSearchHits(await searchEpornerAdult(query, ctx));
}

export async function epornerImageUrls(
  query: string,
  ctx: EngineContext,
  cap: number,
): Promise<string[]> {
  const hits = await searchEpornerAdult(query, {
    ...ctx,
    limit: Math.max(cap, 12),
  });
  return thumbsFromHits(hits, cap);
}
