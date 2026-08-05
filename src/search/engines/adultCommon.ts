import type { SearchHit } from "../types";

export type AdultHit = SearchHit & {
  /** Thumbnail / preview image when available */
  thumb?: string;
  /** Original external URL when engine wraps it */
  sourceUrl?: string;
};

export function stripHtml(input: string): string {
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

export function absUrl(raw: string, base: string): string | null {
  try {
    if (!raw || raw.startsWith("data:") || raw.startsWith("javascript:")) return null;
    if (raw.startsWith("//")) raw = "https:" + raw;
    const u = new URL(raw, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

export function isCloudflareBlock(html: string, status: number): boolean {
  if (status === 403 || status === 503 || status === 429) {
    if (
      /cloudflare|cf-challenge|just a moment|attention required|access denied/i.test(
        html.slice(0, 8000),
      )
    ) {
      return true;
    }
  }
  return /cdn-cgi\/challenge-platform|cf-browser-verification/i.test(
    html.slice(0, 8000),
  );
}

/** Prefer full-ish CDN paths over tiny thumbs when ranking. */
export function preferLargerThumb(url: string): string {
  // XNXX/XVideos: _t.jpg often tiny; try without _t or with larger index
  return url
    .replace(/_t\.jpg/i, ".jpg")
    .replace(/\/thumbs\d+\//i, "/thumbs169lll/")
    .replace(/\.b\.jpg$/i, ".jpg"); // nudevista .b. = medium; .jpg may be larger
}

export function thumbsFromHits(hits: AdultHit[], cap: number): string[] {
  const out: string[] = [];
  for (const h of hits) {
    if (!h.thumb) continue;
    const u = preferLargerThumb(h.thumb);
    if (!out.includes(u)) out.push(u);
    if (out.length >= cap) break;
  }
  return out;
}

export function toSearchHits(hits: AdultHit[]): SearchHit[] {
  return hits.map(({ title, url, snippet, engine }) => ({
    title,
    url,
    snippet,
    engine,
  }));
}
