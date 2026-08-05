import { fetchText } from "../../net/http";
import type { EngineContext, SearchHit } from "../types";
import { googleSafe, normalizeSafeLevel } from "../safeSearch";

/**
 * Google via official/custom providers when API key is set.
 * custom_search: Google Programmable Search (key + cx)
 * serper: serper.dev
 * serpapi: serpapi.com
 */
export async function searchGoogle(
  query: string,
  ctx: EngineContext,
): Promise<SearchHit[]> {
  const key = (ctx.googleApiKey || "").trim();
  if (!key) {
    throw new Error("Google API key not configured");
  }
  const provider = ctx.googleProvider || "custom_search";

  if (provider === "serper") {
    return searchSerper(query, key, ctx);
  }
  if (provider === "serpapi") {
    return searchSerpApi(query, key, ctx);
  }
  return searchCustomSearch(query, key, ctx);
}

async function searchCustomSearch(
  query: string,
  key: string,
  ctx: EngineContext,
): Promise<SearchHit[]> {
  const cx = (ctx.googleCx || "").trim();
  if (!cx) {
    throw new Error("Google CX (Search Engine ID) required for custom_search provider");
  }
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", key);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(Math.min(ctx.limit, 10)));
  // Always explicit SafeSearch (CSE defaults to filtering when omitted)
  url.searchParams.set("safe", googleSafe(normalizeSafeLevel(ctx.safeSearch)));

  const res = await fetchText(url.toString(), {
    signal: ctx.signal,
    politeDelayMs: ctx.politeDelayMs,
    mode: "json",
  });
  if (!res.ok) throw new Error(`Google CSE HTTP ${res.status}: ${res.text.slice(0, 200)}`);
  const data = JSON.parse(res.text) as {
    items?: Array<{ title: string; link: string; snippet?: string }>;
  };
  return (data.items || []).slice(0, ctx.limit).map((it) => ({
    title: it.title,
    url: it.link,
    snippet: it.snippet,
    engine: "google",
  }));
}

async function searchSerper(
  query: string,
  key: string,
  ctx: EngineContext,
): Promise<SearchHit[]> {
  const safe = normalizeSafeLevel(ctx.safeSearch);
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    signal: ctx.signal,
    headers: {
      "X-API-KEY": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: query,
      num: Math.min(ctx.limit, 20),
      // Serper: safe "off" | "active"
      safe: safe === "off" ? "off" : "active",
    }),
  });
  if (!res.ok) throw new Error(`Serper HTTP ${res.status}`);
  const data = (await res.json()) as {
    organic?: Array<{ title: string; link: string; snippet?: string }>;
  };
  return (data.organic || []).slice(0, ctx.limit).map((it) => ({
    title: it.title,
    url: it.link,
    snippet: it.snippet,
    engine: "google-serper",
  }));
}

async function searchSerpApi(
  query: string,
  key: string,
  ctx: EngineContext,
): Promise<SearchHit[]> {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", query);
  url.searchParams.set("api_key", key);
  url.searchParams.set("num", String(Math.min(ctx.limit, 20)));
  url.searchParams.set("safe", googleSafe(normalizeSafeLevel(ctx.safeSearch)));

  const res = await fetchText(url.toString(), {
    signal: ctx.signal,
    politeDelayMs: ctx.politeDelayMs,
    mode: "json",
  });
  if (!res.ok) throw new Error(`SerpAPI HTTP ${res.status}`);
  const data = JSON.parse(res.text) as {
    organic_results?: Array<{ title: string; link: string; snippet?: string }>;
  };
  return (data.organic_results || []).slice(0, ctx.limit).map((it) => ({
    title: it.title,
    url: it.link,
    snippet: it.snippet,
    engine: "google-serpapi",
  }));
}
