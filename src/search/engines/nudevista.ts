/**
 * NudeVista — adult web search (pictures + tube index).
 * Primary path: AMP SERP (server-rendered) — desktop SPA is JS-only.
 * https://www.nudevista.com/amp/?q=...
 */
import { fetchText } from "../../net/http";
import type { EngineContext, SearchHit } from "../types";
import {
  absUrl,
  stripHtml,
  thumbsFromHits,
  toSearchHits,
  type AdultHit,
} from "./adultCommon";

function decodeNudevistaSource(videoHref: string): string | null {
  try {
    // /video/<idB64>/<payloadB64>-slug.html
    const after = videoHref.split("/video/")[1];
    if (!after) return null;
    const segments = after.split("/");
    if (segments.length < 2) return null;
    // payload may include trailing -slug; take longest base64-ish prefix
    let payload = segments[1].replace(/\.html?$/i, "");
    // strip SEO slug after last long base64 run: prefer first chunk if mixed
    const b64Match = payload.match(/^([A-Za-z0-9+/]+=*)/);
    if (!b64Match) return null;
    let b64 = b64Match[1];
    // URL-safe
    b64 = b64.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const decoded = Buffer.from(b64, "base64").toString("utf8");
    // Typical: q=query-0-https://site.com/path#tags...
    const https = decoded.match(/https?:\/\/[^\s"'<>#]+/);
    if (https) return https[0].replace(/#+$/, "");
    return null;
  } catch {
    return null;
  }
}

function parseAmpResults(html: string, limit: number): AdultHit[] {
  const hits: AdultHit[] = [];
  // <a href="https://video.nudevista.com/video/..." class="name" ...>
  //   <amp-img ... src="//t95...jpg" alt="TITLE" ...>  (alt often AFTER src)
  const re =
    /<a\s+href="(https:\/\/video\.nudevista\.com\/video\/[^"]+)"[^>]*class="[^"]*name[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while (hits.length < limit && (m = re.exec(html))) {
    const videoUrl = m[1];
    const block = m[2];
    const thumbM = block.match(
      /src="((?:https?:)?\/\/t\d*\.nudevista\.com\/[^"]+\.(?:jpe?g|png|webp))"/i,
    );
    const altM = block.match(/alt="([^"]*)"/i);
    const title = stripHtml(altM?.[1] || "") || "NudeVista result";
    const thumb = thumbM
      ? absUrl(thumbM[1], "https://www.nudevista.com/")
      : null;
    const source = decodeNudevistaSource(videoUrl);
    const url = source || videoUrl;
    if (hits.some((h) => h.url === url || h.url === videoUrl)) continue;
    hits.push({
      title,
      url,
      thumb: thumb || undefined,
      sourceUrl: source || undefined,
      snippet: source ? `via NudeVista → ${source}` : "via NudeVista",
      engine: "nudevista",
    });
  }

  // Fallback: any video.nudevista link with nearby amp-img
  if (hits.length === 0) {
    const loose =
      /href="(https:\/\/video\.nudevista\.com\/video\/[^"]+)"[\s\S]{0,600}?src="((?:https?:)?\/\/t\d*\.nudevista\.com\/[^"]+)"[\s\S]{0,200}?alt="([^"]*)"/gi;
    while (hits.length < limit && (m = loose.exec(html))) {
      const videoUrl = m[1];
      const thumb = absUrl(m[2], "https://www.nudevista.com/");
      const title = stripHtml(m[3] || "") || "NudeVista result";
      const source = decodeNudevistaSource(videoUrl);
      const url = source || videoUrl;
      if (hits.some((h) => h.url === url)) continue;
      hits.push({
        title,
        url,
        thumb: thumb || undefined,
        sourceUrl: source || undefined,
        engine: "nudevista",
      });
    }
  }

  // Thumbs-only salvage (still useful for image_search)
  if (hits.length === 0) {
    const tre =
      /src="((?:https?:)?\/\/t\d*\.nudevista\.com\/[^"]+\.(?:jpe?g|png|webp))"[^>]*(?:alt="([^"]*)")?/gi;
    while (hits.length < limit && (m = tre.exec(html))) {
      const thumb = absUrl(m[1], "https://www.nudevista.com/");
      if (!thumb) continue;
      if (hits.some((h) => h.thumb === thumb)) continue;
      hits.push({
        title: stripHtml(m[2] || "") || "NudeVista image",
        url: thumb,
        thumb,
        engine: "nudevista",
      });
    }
  }

  return hits;
}

export async function searchNudevistaAdult(
  query: string,
  ctx: EngineContext,
): Promise<AdultHit[]> {
  // AMP is server-rendered; desktop SPA returns empty shell without JS
  const url = new URL("https://www.nudevista.com/amp/");
  url.searchParams.set("q", query);

  const res = await fetchText(url.toString(), {
    signal: ctx.signal,
    politeDelayMs: Math.min(ctx.politeDelayMs, 100),
    mode: "document",
    referer: "https://www.nudevista.com/",
    timeoutMs: 14_000,
    retries: 1,
  });

  if (!res.ok) throw new Error(`NudeVista HTTP ${res.status}`);
  if (/no matches were found/i.test(res.text.slice(0, 4000))) return [];

  return parseAmpResults(res.text, Math.max(ctx.limit, 8));
}

export async function searchNudevista(
  query: string,
  ctx: EngineContext,
): Promise<SearchHit[]> {
  const hits = await searchNudevistaAdult(query, ctx);
  return toSearchHits(hits);
}

/** Direct image URLs (thumbs / previews) from NudeVista AMP SERP. */
export async function nudevistaImageUrls(
  query: string,
  ctx: EngineContext,
  cap: number,
): Promise<string[]> {
  const hits = await searchNudevistaAdult(query, {
    ...ctx,
    limit: Math.max(cap, 12),
  });
  return thumbsFromHits(hits, cap);
}
