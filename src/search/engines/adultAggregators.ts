/**
 * Adult search aggregators: PornMD, iXXX, Fuq.
 * Often sit behind Cloudflare — we try direct HTML, then Jina reader.
 * Even partial link extraction helps NSFW research when Bing/DDG filter.
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

type AggId = "pornmd" | "ixxx" | "fuq";

function buildSearchUrl(id: AggId, query: string): string {
  const q = encodeURIComponent(query);
  switch (id) {
    case "pornmd":
      // path segment style used by PornMD
      return `https://www.pornmd.com/straight/${q}`;
    case "ixxx":
      return `https://www.ixxx.com/search/?q=${q}`;
    case "fuq":
      return `https://www.fuq.com/search?q=${q}`;
  }
}

function engineHost(id: AggId): RegExp {
  switch (id) {
    case "pornmd":
      return /pornmd\.com/i;
    case "ixxx":
      return /ixxx\.com/i;
    case "fuq":
      return /fuq\.com/i;
  }
}

/** Generic HTML / markdown link harvest for aggregator SERPs. */
function parseAggregatorHtml(
  html: string,
  id: AggId,
  limit: number,
): AdultHit[] {
  const hits: AdultHit[] = [];
  const self = engineHost(id);
  let m: RegExpExecArray | null;

  // Absolute external links (typical after jina markdown or full HTML)
  const reAbs =
    /href=["'](https?:\/\/(?!(?:www\.)?(?:pornmd|ixxx|fuq|google|facebook|twitter|cloudflare)[^/"']+)[^"']+)["'][^>]*>([^<]{0,120})/gi;
  while (hits.length < limit && (m = reAbs.exec(html))) {
    const url = m[1];
    if (self.test(url)) continue;
    if (/\.(css|js|woff|png|svg|ico)(\?|$)/i.test(url)) continue;
    if (/adsystem|doubleclick|trafficjunky|exoclick|adtng/i.test(url)) continue;
    if (hits.some((h) => h.url === url)) continue;
    const title = stripHtml(m[2] || "") || url;
    if (title.length < 3 && !/video|watch|porn|xxx|nude/i.test(url)) continue;
    hits.push({
      title: title.slice(0, 160),
      url,
      snippet: `via ${id}`,
      engine: id,
    });
  }

  // Markdown links from Jina: [title](url)
  if (hits.length < 3) {
    const reMd = /\[([^\]]{3,120})\]\((https?:\/\/[^)\s]+)\)/gi;
    while (hits.length < limit && (m = reMd.exec(html))) {
      const title = stripHtml(m[1]);
      const url = m[2];
      if (self.test(url)) continue;
      if (/adsystem|doubleclick|jina\.ai|cloudflare/i.test(url)) continue;
      if (hits.some((h) => h.url === url)) continue;
      hits.push({ title, url, snippet: `via ${id} (jina)`, engine: id });
    }
  }

  // Thumbs
  const tre =
    /(?:src|data-src)=["']((?:https?:)?\/\/[^"']+\.(?:jpe?g|png|webp)[^"']*)["']/gi;
  while (hits.length < limit && (m = tre.exec(html))) {
    const thumb = absUrl(m[1], `https://www.${id}.com/`);
    if (!thumb || /logo|icon|sprite|flag|blank/i.test(thumb)) continue;
    if (hits.some((h) => h.thumb === thumb || h.url === thumb)) continue;
    // attach thumb to last hit if same domain-ish, else new image hit
    hits.push({
      title: `${id} image`,
      url: thumb,
      thumb,
      engine: id,
    });
  }

  return hits.slice(0, limit);
}

async function fetchAggHtml(
  id: AggId,
  query: string,
  ctx: EngineContext,
): Promise<{ html: string; via: "direct" | "jina" }> {
  const searchUrl = buildSearchUrl(id, query);
  try {
    const res = await fetchText(searchUrl, {
      signal: ctx.signal,
      politeDelayMs: Math.min(ctx.politeDelayMs, 80),
      mode: "document",
      referer: `https://www.${id === "ixxx" ? "ixxx" : id}.com/`,
      timeoutMs: 10_000,
      retries: 0,
    });
    if (
      res.ok &&
      res.text.length > 2000 &&
      !isCloudflareBlock(res.text, res.status)
    ) {
      return { html: res.text, via: "direct" };
    }
  } catch {
    /* try jina */
  }

  // Jina reader often bypasses soft bot walls
  const jinaUrl = `https://r.jina.ai/http://${searchUrl.replace(/^https?:\/\//, "")}`;
  const jina = await fetchText(jinaUrl, {
    signal: ctx.signal,
    politeDelayMs: Math.min(ctx.politeDelayMs, 80),
    timeoutMs: 14_000,
    retries: 0,
    headers: { Accept: "text/plain,text/html;q=0.9,*/*;q=0.8" },
  });
  if (!jina.ok || jina.text.length < 80) {
    throw new Error(
      `${id}: Cloudflare/empty (direct+jina). Open ${searchUrl} via visit tool.`,
    );
  }
  return { html: jina.text, via: "jina" };
}

async function searchAgg(
  id: AggId,
  query: string,
  ctx: EngineContext,
): Promise<AdultHit[]> {
  const serp = buildSearchUrl(id, query);
  try {
    const { html, via } = await fetchAggHtml(id, query, ctx);
    const hits = parseAggregatorHtml(html, id, Math.max(ctx.limit, 8));
    if (via === "jina") {
      for (const h of hits) {
        h.snippet = (h.snippet || "") + " [jina]";
      }
    }
    // Always surface the aggregator SERP for the model (visit / manual open)
    if (!hits.some((h) => h.url === serp)) {
      hits.unshift({
        title: `${id} search: ${query}`,
        url: serp,
        snippet: `Aggregator SERP (${via})`,
        engine: id,
      });
    }
    return hits.slice(0, Math.max(ctx.limit, 8));
  } catch (e) {
    // Cloudflare / network: still return the SERP URL so model can visit()
    const msg = e instanceof Error ? e.message : String(e);
    return [
      {
        title: `${id} search: ${query}`,
        url: serp,
        snippet: `Blocked or unreachable (${msg.slice(0, 80)}). Open via visit tool / browser.`,
        engine: id,
      },
    ];
  }
}

export async function searchPornmd(
  query: string,
  ctx: EngineContext,
): Promise<SearchHit[]> {
  return toSearchHits(await searchAgg("pornmd", query, ctx));
}

export async function searchIxxx(
  query: string,
  ctx: EngineContext,
): Promise<SearchHit[]> {
  return toSearchHits(await searchAgg("ixxx", query, ctx));
}

export async function searchFuq(
  query: string,
  ctx: EngineContext,
): Promise<SearchHit[]> {
  return toSearchHits(await searchAgg("fuq", query, ctx));
}

export async function adultAggregatorImageUrls(
  id: AggId,
  query: string,
  ctx: EngineContext,
  cap: number,
): Promise<string[]> {
  const hits = await searchAgg(id, query, { ...ctx, limit: Math.max(cap, 12) });
  return thumbsFromHits(hits, cap);
}
