/**
 * HQPorner search — free tube index, often scrape-friendly.
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

const BASE = "https://hqporner.com";

function parseResults(html: string, limit: number): AdultHit[] {
  const hits: AdultHit[] = [];
  let m: RegExpExecArray | null;

  // /hdporn/ID-title.html with nearby img and h3
  const re1 =
    /href="(\/hdporn\/[^"]+\.html)"[\s\S]{0,400}?(?:src|data-src)="([^"]+\.(?:jpe?g|png|webp)[^"]*)"[\s\S]{0,200}?<h3>([^<]+)/gi;
  while (hits.length < limit && (m = re1.exec(html))) {
    const url = absUrl(m[1], BASE);
    if (!url || hits.some((h) => h.url === url)) continue;
    hits.push({
      title: stripHtml(m[3]),
      url,
      thumb: absUrl(m[2], BASE) || undefined,
      snippet: "via HQPorner",
      engine: "hqporner",
    });
  }

  if (hits.length < 3) {
    const re2 = /href="(\/hdporn\/\d+-[^"]+\.html)"[^>]*>([^<]{4,100})</gi;
    while (hits.length < limit && (m = re2.exec(html))) {
      const url = absUrl(m[1], BASE);
      if (!url || hits.some((h) => h.url === url)) continue;
      const title = stripHtml(m[2]);
      if (title.length < 3) continue;
      hits.push({ title, url, engine: "hqporner" });
    }
  }

  // thumbs only from CDN
  if (hits.length === 0) {
    const re3 =
      /(?:src|data-src)="((?:https?:)?\/\/[^"]*hqporner[^"]*\/(?:imgs|thumbs)\/[^"]+\.(?:jpe?g|png|webp)[^"]*)"/gi;
    while (hits.length < limit && (m = re3.exec(html))) {
      const thumb = absUrl(m[1], BASE);
      if (!thumb || /logo|icon|apple-/i.test(thumb)) continue;
      if (hits.some((h) => h.thumb === thumb)) continue;
      hits.push({
        title: "HQPorner image",
        url: thumb,
        thumb,
        engine: "hqporner",
      });
    }
  }

  return hits;
}

export async function searchHqpornerAdult(
  query: string,
  ctx: EngineContext,
): Promise<AdultHit[]> {
  const url = new URL(BASE + "/");
  url.searchParams.set("q", query);
  const res = await fetchText(url.toString(), {
    signal: ctx.signal,
    politeDelayMs: Math.min(ctx.politeDelayMs, 100),
    mode: "document",
    referer: BASE + "/",
    timeoutMs: 14_000,
    retries: 1,
  });
  if (isCloudflareBlock(res.text, res.status)) {
    throw new Error("HQPorner blocked (Cloudflare)");
  }
  if (!res.ok) throw new Error(`HQPorner HTTP ${res.status}`);
  return parseResults(res.text, Math.max(ctx.limit, 8));
}

export async function searchHqporner(
  query: string,
  ctx: EngineContext,
): Promise<SearchHit[]> {
  return toSearchHits(await searchHqpornerAdult(query, ctx));
}

export async function hqpornerImageUrls(
  query: string,
  ctx: EngineContext,
  cap: number,
): Promise<string[]> {
  const hits = await searchHqpornerAdult(query, {
    ...ctx,
    limit: Math.max(cap, 12),
  });
  return thumbsFromHits(hits, cap);
}
