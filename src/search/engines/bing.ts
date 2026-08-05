import { fetchText } from "../../net/http";
import type { EngineContext, SearchHit } from "../types";
import { bingAdlt, normalizeSafeLevel } from "../safeSearch";

function stripHtml(input: string): string {
  return input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Bing wraps result URLs as /ck/a?...&u=a1BASE64...
 * Decode the `u` parameter to the real destination.
 */
export function decodeBingRedirect(href: string): string | null {
  try {
    if (href.startsWith("//")) href = "https:" + href;
    const u = new URL(href, "https://www.bing.com");
    const enc = u.searchParams.get("u");
    if (!enc) {
      if (/^https?:\/\//i.test(href) && !/bing\.com/i.test(u.hostname)) {
        return href;
      }
      return null;
    }
    let s = enc;
    if (s.startsWith("a1")) s = s.slice(2);
    s = s.replace(/_/g, "/").replace(/-/g, "+");
    while (s.length % 4) s += "=";
    const decoded = Buffer.from(s, "base64").toString("utf8");
    // Relative Bing paths (images/search, etc.) — not external content
    if (decoded.startsWith("/")) return null;
    if (/^https?:\/\//i.test(decoded)) return decoded;
    return null;
  } catch {
    return null;
  }
}

export async function searchBing(
  query: string,
  ctx: EngineContext,
): Promise<SearchHit[]> {
  const url = new URL("https://www.bing.com/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(ctx.limit, 20)));
  url.searchParams.set("setlang", "en-us");
  url.searchParams.set("cc", "US");
  url.searchParams.set("mkt", "en-US");
  // Always set adlt — Bing defaults to filtering when omitted
  url.searchParams.set("adlt", bingAdlt(normalizeSafeLevel(ctx.safeSearch)));

  const res = await fetchText(url.toString(), {
    signal: ctx.signal,
    politeDelayMs: ctx.politeDelayMs,
    referer: "https://www.bing.com/",
    timeoutMs: 12_000,
    retries: 1,
  });
  if (!res.ok) throw new Error(`Bing HTTP ${res.status}`);

  const hits: SearchHit[] = [];
  const push = (rawHref: string, titleRaw: string) => {
    const href =
      decodeBingRedirect(rawHref.replace(/&amp;/g, "&")) ||
      (/^https?:\/\//i.test(rawHref) && !/bing\.com/i.test(rawHref)
        ? rawHref
        : null);
    if (!href) return;
    if (/bing\.com|microsoft\.com|r\.bing\.com/i.test(href)) return;
    const title = stripHtml(titleRaw) || href;
    if (hits.some((h) => h.url === href)) return;
    hits.push({ title, url: href, engine: "bing" });
  };

  // Classic + modern Bing result links (often ck/a redirects)
  const re =
    /<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while (hits.length < ctx.limit && (m = re.exec(res.text))) {
    push(m[1], m[2]);
  }

  // cite lines as weak fallback titles when h2 parse failed
  if (hits.length === 0) {
    const cites = /<cite[^>]*>([\s\S]*?)<\/cite>/gi;
    while (hits.length < ctx.limit && (m = cites.exec(res.text))) {
      const t = stripHtml(m[1]).replace(/\s*›\s*/g, "/");
      const maybe = t.match(/https?:\/\/[^\s]+/i)?.[0];
      if (maybe) push(maybe, t);
    }
  }

  return hits;
}
