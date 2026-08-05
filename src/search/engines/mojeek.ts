import { fetchText } from "../../net/http";
import type { EngineContext, SearchHit } from "../types";

function stripHtml(input: string): string {
  return input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Mojeek — independent index, no API key. */
export async function searchMojeek(
  query: string,
  ctx: EngineContext,
): Promise<SearchHit[]> {
  const url = new URL("https://www.mojeek.com/search");
  url.searchParams.set("q", query);
  // Mojeek: safe=0/1 when supported (ignore if instance ignores it)
  url.searchParams.set(
    "safe",
    ctx.safeSearch === "strict" || ctx.safeSearch === "moderate" ? "1" : "0",
  );

  const res = await fetchText(url.toString(), {
    signal: ctx.signal,
    politeDelayMs: ctx.politeDelayMs,
    referer: "https://www.mojeek.com/",
  });
  if (!res.ok) throw new Error(`Mojeek HTTP ${res.status}`);

  const hits: SearchHit[] = [];
  const re =
    /<a[^>]+class="[^"]*title[^"]*"[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while (hits.length < ctx.limit && (m = re.exec(res.text))) {
    const href = m[1];
    if (/mojeek\.com/i.test(href)) continue;
    hits.push({ title: stripHtml(m[2]) || href, url: href, engine: "mojeek" });
  }

  if (hits.length === 0) {
    const loose =
      /<h2[^>]*>\s*<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    while (hits.length < ctx.limit && (m = loose.exec(res.text))) {
      if (/mojeek\.com/i.test(m[1])) continue;
      hits.push({ title: stripHtml(m[2]) || m[1], url: m[1], engine: "mojeek" });
    }
  }

  return hits;
}
