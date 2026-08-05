import { fetchText } from "../../net/http";
import type { EngineContext, SearchHit } from "../types";
import { ddgKp, normalizeSafeLevel } from "../safeSearch";

function stripHtml(input: string): string {
  return input
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSearchResultUrl(rawHref: string): string | null {
  try {
    if (rawHref.startsWith("//")) rawHref = "https:" + rawHref;
    const u = new URL(rawHref, "https://duckduckgo.com");
    if (u.hostname.includes("duckduckgo.com")) {
      const uddg = u.searchParams.get("uddg");
      if (uddg) return decodeURIComponent(uddg);
      if (u.pathname === "/" || u.pathname.startsWith("/y.js")) return null;
      return null;
    }
    if (u.protocol === "http:" || u.protocol === "https:") return u.href;
    return null;
  } catch {
    return null;
  }
}

function isBlockedHtml(html: string, status: number): boolean {
  if (status === 202 || status === 403 || status === 429) return true;
  return /anomaly-modal|anomaly|sorry.*robot|captcha|cloudflare|cf-challenge/i.test(
    html,
  );
}

function parseHtmlResults(html: string, limit: number): SearchHit[] {
  const hits: SearchHit[] = [];
  const push = (raw: string, titleRaw: string) => {
    const href = normalizeSearchResultUrl(raw);
    if (!href) return;
    const title = stripHtml(titleRaw) || href;
    if (hits.some((h) => h.url === href)) return;
    hits.push({ title, url: href, engine: "ddg" });
  };

  const anchorRegex =
    /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while (hits.length < limit && (match = anchorRegex.exec(html))) {
    push(match[1], match[2]);
  }

  // lite.duckduckgo.com
  if (hits.length === 0) {
    const lite =
      /<a[^>]+class="[^"]*result-link[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    while (hits.length < limit && (match = lite.exec(html))) {
      push(match[1], match[2]);
    }
  }

  if (hits.length === 0) {
    const loose = /<a[^>]+rel="nofollow"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    while (hits.length < limit && (match = loose.exec(html))) {
      push(match[1], match[2]);
    }
  }

  return hits;
}

export async function searchDdg(
  query: string,
  ctx: EngineContext,
): Promise<SearchHit[]> {
  const kp = ddgKp(normalizeSafeLevel(ctx.safeSearch));
  const endpoints = [
    () => {
      const url = new URL("https://html.duckduckgo.com/html/");
      url.searchParams.set("q", query);
      url.searchParams.set("kl", "us-en");
      // Always explicit: default engines often leave SafeSearch ON
      url.searchParams.set("kp", kp);
      return url.toString();
    },
    () => {
      const url = new URL("https://lite.duckduckgo.com/lite/");
      url.searchParams.set("q", query);
      url.searchParams.set("kl", "us-en");
      url.searchParams.set("kp", kp);
      return url.toString();
    },
  ];

  let lastBlock = false;
  for (const make of endpoints) {
    try {
      const res = await fetchText(make(), {
        signal: ctx.signal,
        politeDelayMs: Math.min(ctx.politeDelayMs, 120),
        mode: "document",
        referer: "https://duckduckgo.com/",
        timeoutMs: 12_000,
        retries: 1,
      });
      if (isBlockedHtml(res.text, res.status)) {
        lastBlock = true;
        continue;
      }
      if (!res.ok) continue;
      const hits = parseHtmlResults(res.text, ctx.limit);
      if (hits.length) return hits;
    } catch {
      /* try next endpoint */
    }
  }

  if (lastBlock) throw new Error("DDG blocked (anomaly/captcha) — try again later");
  return [];
}
