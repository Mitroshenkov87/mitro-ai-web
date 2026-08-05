import { fetchText } from "../../net/http";
import type { EngineContext, SearchHit } from "../types";
import { normalizeSafeLevel, yahooVm } from "../safeSearch";

function stripHtml(input: string): string {
  return input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export async function searchYahoo(
  query: string,
  ctx: EngineContext,
): Promise<SearchHit[]> {
  const url = new URL("https://search.yahoo.com/search");
  url.searchParams.set("p", query);
  url.searchParams.set("n", String(Math.min(ctx.limit, 20)));
  // vm=r relaxed (SafeSearch off) | i moderate | p strict
  url.searchParams.set("vm", yahooVm(normalizeSafeLevel(ctx.safeSearch)));

  const res = await fetchText(url.toString(), {
    signal: ctx.signal,
    politeDelayMs: ctx.politeDelayMs,
    referer: "https://search.yahoo.com/",
  });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);

  const hits: SearchHit[] = [];
  const re =
    /<a[^>]+class="[^"]*d-ib[^"]*"[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while (hits.length < ctx.limit && (m = re.exec(res.text))) {
    let href = m[1];
    // Yahoo redirect
    try {
      const u = new URL(href);
      if (u.hostname.includes("yahoo.com") && u.searchParams.get("RU")) {
        href = decodeURIComponent(u.searchParams.get("RU")!);
      }
    } catch {
      /* keep */
    }
    if (/yahoo\.com|bing\.com\/aclick/i.test(href)) continue;
    const title = stripHtml(m[2]) || href;
    if (hits.some((h) => h.url === href)) continue;
    hits.push({ title, url: href, engine: "yahoo" });
  }

  if (hits.length === 0) {
    const loose = /<h3[^>]*>\s*<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    while (hits.length < ctx.limit && (m = loose.exec(res.text))) {
      const href = m[1];
      if (/yahoo\.com/i.test(href)) continue;
      hits.push({ title: stripHtml(m[2]) || href, url: href, engine: "yahoo" });
    }
  }

  return hits;
}
