import type { SearchHit } from "./types";

/** Domains that are search engines / SERP chrome — never treat as content hits. */
const SEARCH_ENGINE_HOST =
  /(?:^|\.)((?:www\.)?(?:google|bing|yahoo|yandex|duckduckgo|qwant|mojeek|brave|ecosia|startpage|searx|search\.brave|html\.duckduckgo|search\.yahoo|www\.google)\.[a-z.]+)$/i;

const SEARCH_ENGINE_PATH =
  /\/(search|web|images|videos|news|html)(\/|\?|$)/i;

function hostnameOf(href: string): string | null {
  try {
    return new URL(href).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

function isSearchEngineResult(url: string, title?: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();

    // Pure engine hosts
    if (
      /^(google|bing|yahoo|yandex|duckduckgo|qwant|mojeek|brave|ecosia|startpage)\./i.test(
        host + ".",
      ) ||
      host === "google.com" ||
      host === "bing.com" ||
      host === "yahoo.com" ||
      host === "yandex.com" ||
      host === "yandex.ru" ||
      host === "duckduckgo.com" ||
      host === "qwant.com" ||
      host === "mojeek.com" ||
      host === "brave.com" ||
      host === "search.brave.com" ||
      host.endsWith(".qwant.com") ||
      host.endsWith(".duckduckgo.com") ||
      host.endsWith(".bing.com") ||
      host.endsWith(".google.com") ||
      host.endsWith(".yandex.ru") ||
      host.endsWith(".yandex.com")
    ) {
      return true;
    }

    // searx public instances often have /search
    if (SEARCH_ENGINE_PATH.test(u.pathname) && /searx|search\./i.test(host)) {
      return true;
    }

    // Title is just the engine name
    const t = (title || "").trim().toLowerCase();
    if (
      t === "qwant" ||
      t === "bing" ||
      t === "google" ||
      t === "duckduckgo" ||
      t === "yahoo" ||
      t === "yandex" ||
      t === "mojeek" ||
      t === "brave search"
    ) {
      return true;
    }

    return false;
  } catch {
    return true;
  }
}

function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    u.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach(
      (k) => u.searchParams.delete(k),
    );
    return u.href;
  } catch {
    return null;
  }
}

export function mergeHits(groups: SearchHit[][], limit: number): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  const queues = groups.map((g) => [...g]);
  let progress = true;

  while (out.length < limit && progress) {
    progress = false;
    for (const q of queues) {
      while (q.length && out.length < limit) {
        const hit = q.shift()!;
        const key = normalizeUrl(hit.url);
        if (!key || seen.has(key)) continue;
        if (isSearchEngineResult(key, hit.title)) continue;
        // skip empty/useless titles that are just hostnames of engines
        const host = hostnameOf(key);
        if (host && hit.title && hit.title.replace(/^www\./, "").toLowerCase() === host) {
          // still ok if not engine; engine already filtered
        }
        seen.add(key);
        out.push({ ...hit, url: key });
        progress = true;
        break;
      }
    }
  }
  return out;
}
