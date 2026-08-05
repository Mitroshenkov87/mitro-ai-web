import { fetchText } from "../../net/http";
import type { EngineContext, SearchHit } from "../types";
import { normalizeSafeLevel, qwantSafe } from "../safeSearch";

function stripHtml(input: string): string {
  return input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHref(raw: string): string {
  return raw
    .replace(/\\\//g, "/")
    .replace(/\\u0026/g, "&")
    .replace(/&amp;/g, "&");
}

/** Qwant — no API key required (HTML). */
export async function searchQwant(
  query: string,
  ctx: EngineContext,
): Promise<SearchHit[]> {
  const url = new URL("https://www.qwant.com/");
  url.searchParams.set("q", query);
  url.searchParams.set("t", "web");
  // safesearch: 0=off 1=moderate 2=strict (always explicit)
  url.searchParams.set(
    "safesearch",
    qwantSafe(normalizeSafeLevel(ctx.safeSearch)),
  );

  // Fail fast: Qwant often hangs / safe-blocks adult queries (not used in NSFW auto)
  const res = await fetchText(url.toString(), {
    signal: ctx.signal,
    politeDelayMs: Math.min(ctx.politeDelayMs, 100),
    referer: "https://www.qwant.com/",
    retries: 1,
    timeoutMs: 6_000,
    maxBytes: 600_000,
  });
  if (!res.ok) throw new Error(`Qwant HTTP ${res.status}`);
  if (
    /captcha|unusual traffic|access denied|safesearch|adult content|contenu\s+adulte|safe search|filtered/i.test(
      res.text,
    )
  ) {
    throw new Error("Qwant blocked or safe-search wall");
  }

  const hits: SearchHit[] = [];
  const re =
    /<a[^>]+href="(https?:\/\/(?!www\.qwant\.com|cdn\.qwant\.com)[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while (hits.length < ctx.limit && (m = re.exec(res.text))) {
    const href = decodeHref(m[1]);
    if (/qwant\.com|account\.|login/i.test(href)) continue;
    const title = stripHtml(m[2]) || href;
    if (title.length < 2) continue;
    if (hits.some((h) => h.url === href)) continue;
    hits.push({ title: title.slice(0, 200), url: href, engine: "qwant" });
  }

  // JSON blobs sometimes embedded
  if (hits.length === 0) {
    const jsonUrl = /"url"\s*:\s*"(https?:[^"]+)"/gi;
    while (hits.length < ctx.limit && (m = jsonUrl.exec(res.text))) {
      const href = decodeHref(m[1]);
      if (!href.startsWith("http") || /qwant\.com/i.test(href)) continue;
      if (hits.some((h) => h.url === href)) continue;
      hits.push({ title: href, url: href, engine: "qwant" });
    }
  }

  return hits;
}
