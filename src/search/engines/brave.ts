import { fetchText } from "../../net/http";
import type { EngineContext, SearchHit } from "../types";
import { braveSafe, normalizeSafeLevel } from "../safeSearch";

function stripHtml(input: string): string {
  return input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export async function searchBrave(
  query: string,
  ctx: EngineContext,
): Promise<SearchHit[]> {
  const url = new URL("https://search.brave.com/search");
  url.searchParams.set("q", query);
  url.searchParams.set("source", "web");
  // Explicit SafeSearch — Brave defaults to filtering
  url.searchParams.set(
    "safesearch",
    braveSafe(normalizeSafeLevel(ctx.safeSearch)),
  );

  const res = await fetchText(url.toString(), {
    signal: ctx.signal,
    politeDelayMs: ctx.politeDelayMs,
    referer: "https://search.brave.com/",
  });
  if (!res.ok) throw new Error(`Brave HTTP ${res.status}`);

  const hits: SearchHit[] = [];
  const re =
    /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*class="[^"]*result-header[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while (hits.length < ctx.limit && (m = re.exec(res.text))) {
    const href = m[1];
    if (/brave\.com|search\.brave/i.test(href)) continue;
    hits.push({ title: stripHtml(m[2]) || href, url: href, engine: "brave" });
  }

  if (hits.length === 0) {
    const loose =
      /data-href="(https?:\/\/[^"]+)"[\s\S]{0,200}?<span class="url[^"]*"[^>]*>[\s\S]*?<\/span>[\s\S]{0,80}?<span[^>]*>([\s\S]*?)<\/span>/gi;
    while (hits.length < ctx.limit && (m = loose.exec(res.text))) {
      hits.push({ title: stripHtml(m[2]) || m[1], url: m[1], engine: "brave" });
    }
  }

  if (hits.length === 0) {
    const a = /<a[^>]+href="(https?:\/\/(?!search\.brave|brave\.com)[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    while (hits.length < ctx.limit && (m = a.exec(res.text))) {
      const title = stripHtml(m[2]);
      if (title.length < 8) continue;
      if (hits.some((h) => h.url === m![1])) continue;
      hits.push({ title, url: m[1], engine: "brave" });
    }
  }

  return hits;
}
