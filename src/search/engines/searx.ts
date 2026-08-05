import { fetchText } from "../../net/http";
import type { EngineContext, SearchHit } from "../types";
import { normalizeSafeLevel, searxSafe } from "../safeSearch";

/**
 * Public SearXNG instances — no API key.
 * Tries a small pool until one responds.
 */
const INSTANCES = [
  "https://searx.be",
  "https://search.sapti.me",
  "https://searx.tiekoetter.com",
];

export async function searchSearx(
  query: string,
  ctx: EngineContext,
): Promise<SearchHit[]> {
  let lastErr = "no instance available";
  const safe = searxSafe(normalizeSafeLevel(ctx.safeSearch));
  for (const base of INSTANCES) {
    try {
      const url = new URL("/search", base);
      url.searchParams.set("q", query);
      url.searchParams.set("format", "json");
      url.searchParams.set("categories", "general");
      // 0=off 1=moderate 2=strict — always set (many instances default ON)
      url.searchParams.set("safesearch", safe);

      const res = await fetchText(url.toString(), {
        signal: ctx.signal,
        politeDelayMs: ctx.politeDelayMs,
        mode: "json",
        retries: 2,
      });
      if (!res.ok) {
        lastErr = `${base} HTTP ${res.status}`;
        continue;
      }
      const data = JSON.parse(res.text) as {
        results?: Array<{ title?: string; url?: string; content?: string }>;
      };
      const hits: SearchHit[] = [];
      for (const r of data.results || []) {
        if (!r.url || !r.url.startsWith("http")) continue;
        hits.push({
          title: r.title || r.url,
          url: r.url,
          snippet: r.content,
          engine: "searx",
        });
        if (hits.length >= ctx.limit) break;
      }
      if (hits.length) return hits;
      lastErr = `${base} empty`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(`SearX failed: ${lastErr}`);
}
