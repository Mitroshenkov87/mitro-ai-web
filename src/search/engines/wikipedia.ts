import { fetchText } from "../../net/http";
import type { EngineContext, SearchHit } from "../types";

export async function searchWikipedia(
  query: string,
  ctx: EngineContext,
): Promise<SearchHit[]> {
  const lang = /[а-яё]/i.test(query) ? "ru" : "en";
  const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  url.searchParams.set("action", "opensearch");
  url.searchParams.set("search", query);
  url.searchParams.set("limit", String(Math.min(ctx.limit, 10)));
  url.searchParams.set("namespace", "0");
  url.searchParams.set("format", "json");

  const res = await fetchText(url.toString(), {
    signal: ctx.signal,
    politeDelayMs: ctx.politeDelayMs,
    mode: "json",
  });
  if (!res.ok) throw new Error(`Wikipedia HTTP ${res.status}`);

  const data = JSON.parse(res.text) as [string, string[], string[], string[]];
  const titles = data[1] || [];
  const snippets = data[2] || [];
  const urls = data[3] || [];
  const hits: SearchHit[] = [];
  for (let i = 0; i < urls.length && hits.length < ctx.limit; i++) {
    hits.push({
      title: titles[i] || urls[i],
      url: urls[i],
      snippet: snippets[i] || "",
      engine: "wikipedia",
    });
  }
  return hits;
}
