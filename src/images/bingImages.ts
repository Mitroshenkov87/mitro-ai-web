import { fetchText } from "../net/http";
import { browserHeaders } from "../net/headers";
import { preferFullImageUrl } from "./qualityProbe";
import type { EngineContext } from "../search/types";
import { bingAdlt, normalizeSafeLevel } from "../search/safeSearch";
import {
  extractSubjectTokens,
  scoreIdentity,
  identityMinScore,
} from "../search/identity";

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/")
    .replace(/\\u003d/g, "=");
}

/**
 * Bing Images async endpoint — more reliable than DDG i.js for many queries.
 * Returns candidate image URLs, identity-filtered when possible.
 */
export async function bingImageUrls(
  query: string,
  ctx: EngineContext,
  cap: number,
): Promise<string[]> {
  const tokens = extractSubjectTokens(query);
  const minId = identityMinScore(tokens);
  const urls: string[] = [];
  const seen = new Set<string>();

  const push = (rawUrl: string, title = "") => {
    const u = preferFullImageUrl(decodeHtmlEntities(rawUrl), undefined);
    if (!u || seen.has(u)) return;
    if (tokens.length >= 2) {
      const s = scoreIdentity(title, u, tokens);
      // soft filter: if title empty, keep URL; if title present, require min score
      if (title && s < minId) return;
    }
    seen.add(u);
    urls.push(u);
  };

  // Primary: async JSON-ish HTML fragment
  const asyncUrl = new URL("https://www.bing.com/images/async");
  asyncUrl.searchParams.set("q", query);
  asyncUrl.searchParams.set("first", "0");
  asyncUrl.searchParams.set("count", String(Math.min(Math.max(cap * 3, 35), 80)));
  asyncUrl.searchParams.set("mmasync", "1");
  // Always explicit SafeSearch (default plugin: off)
  asyncUrl.searchParams.set(
    "adlt",
    bingAdlt(normalizeSafeLevel(ctx.safeSearch)),
  );
  asyncUrl.searchParams.set("setlang", "en-us");
  asyncUrl.searchParams.set("cc", "US");
  asyncUrl.searchParams.set("mkt", "en-US");

  const headers = browserHeaders({
    mode: "document",
    referer: `https://www.bing.com/images/search?q=${encodeURIComponent(query)}`,
  });

  try {
    const res = await fetchText(asyncUrl.toString(), {
      signal: ctx.signal,
      politeDelayMs: Math.min(ctx.politeDelayMs, 80),
      headers,
      timeoutMs: 12_000,
      retries: 1,
    });
    if (res.ok) {
      // murl&quot;:&quot;https...&quot;  and optional title t&quot;:&quot;...
      const blockRe =
        /murl&quot;:&quot;(https?:[^&"]+)&quot;([\s\S]{0,400}?)(?:t&quot;:&quot;([^&"]*)&quot;)?/gi;
      let m: RegExpExecArray | null;
      while (urls.length < cap && (m = blockRe.exec(res.text))) {
        push(m[1], m[3] ? decodeHtmlEntities(m[3]) : "");
      }
      if (urls.length < cap) {
        const loose = /murl&quot;:&quot;(https?:[^&"]+)&quot;/gi;
        while (urls.length < cap && (m = loose.exec(res.text))) {
          push(m[1], "");
        }
      }
    }
  } catch {
    /* fall through to full page */
  }

  if (urls.length >= Math.min(4, cap)) return urls.slice(0, cap);

  // Fallback: full images page
  try {
    const pageUrl = new URL("https://www.bing.com/images/search");
    pageUrl.searchParams.set("q", query);
    pageUrl.searchParams.set("form", "HDRSC2");
    pageUrl.searchParams.set("first", "1");
    pageUrl.searchParams.set(
      "adlt",
      bingAdlt(normalizeSafeLevel(ctx.safeSearch)),
    );
    pageUrl.searchParams.set("setlang", "en-us");
    pageUrl.searchParams.set("mkt", "en-US");

    const res = await fetchText(pageUrl.toString(), {
      signal: ctx.signal,
      politeDelayMs: Math.min(ctx.politeDelayMs, 80),
      headers,
      timeoutMs: 12_000,
      retries: 1,
    });
    if (res.ok) {
      const loose = /murl&quot;:&quot;(https?:[^&"]+)&quot;/gi;
      let m: RegExpExecArray | null;
      while (urls.length < cap && (m = loose.exec(res.text))) {
        push(m[1], "");
      }
    }
  } catch {
    /* ignore */
  }

  return urls.slice(0, cap);
}
