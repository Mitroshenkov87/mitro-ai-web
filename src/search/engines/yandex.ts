import { fetchText } from "../../net/http";
import type { EngineContext, SearchHit } from "../types";
import { normalizeSafeLevel, yandexFamilyCookie } from "../safeSearch";

function stripHtml(input: string): string {
  return input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export async function searchYandex(
  query: string,
  ctx: EngineContext,
): Promise<SearchHit[]> {
  // International host often less aggressive for bots
  const url = new URL("https://yandex.com/search/");
  url.searchParams.set("text", query);
  url.searchParams.set("lr", "0");
  // family=0 / no family filter when SafeSearch off
  const level = normalizeSafeLevel(ctx.safeSearch);
  if (level === "off") {
    url.searchParams.set("family", "0");
  } else {
    url.searchParams.set("family", "1");
  }

  const res = await fetchText(url.toString(), {
    signal: ctx.signal,
    politeDelayMs: ctx.politeDelayMs,
    referer: "https://yandex.com/",
    timeoutMs: 12_000,
    retries: 1,
    headers: {
      Cookie: yandexFamilyCookie(level),
    },
  });
  if (!res.ok) throw new Error(`Yandex HTTP ${res.status}`);

  const hits: SearchHit[] = [];
  const re =
    /<a[^>]+class="[^"]*organic__url[^"]*"[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while (hits.length < ctx.limit && (m = re.exec(res.text))) {
    const href = m[1];
    if (/yandex\.(com|ru|by|kz)/i.test(href) && !/\/turbo\//i.test(href)) {
      // allow external only
      if (/yandex\.(com|ru)/i.test(new URL(href).hostname)) continue;
    }
    const title = stripHtml(m[2]) || href;
    if (hits.some((h) => h.url === href)) continue;
    hits.push({ title, url: href, engine: "yandex" });
  }

  // Link with data-log-node or serp-item
  if (hits.length === 0) {
    const loose =
      /<a[^>]+href="(https?:\/\/(?!yandex\.)[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    while (hits.length < ctx.limit && (m = loose.exec(res.text))) {
      const href = m[1];
      if (/yastatic|yandex\.(com|ru|net)/i.test(href)) continue;
      const title = stripHtml(m[2]);
      if (!title || title.length < 3) continue;
      if (hits.some((h) => h.url === href)) continue;
      hits.push({ title, url: href, engine: "yandex" });
    }
  }

  return hits;
}
