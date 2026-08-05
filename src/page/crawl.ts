import { fetchPage } from "./fetchPage";
import { extractPage } from "./extract";

export interface CrawlPageResult {
  url: string;
  title: string;
  content: string;
  links: string[];
  error?: string;
}

export interface CrawlResult {
  startUrl: string;
  pages: CrawlPageResult[];
  visited: number;
}

function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).hostname.replace(/^www\./, "") ===
      new URL(b).hostname.replace(/^www\./, "");
  } catch {
    return false;
  }
}

export async function crawlSite(opts: {
  startUrl: string;
  maxDepth: number;
  maxPages: number;
  sameDomain?: boolean;
  contentLimit?: number;
  politeDelayMs?: number;
  jinaFallback?: boolean;
  allowChromeDevtools?: boolean;
  chromeDebugPort?: number;
  signal?: AbortSignal;
}): Promise<CrawlResult> {
  const maxDepth = Math.max(0, Math.min(opts.maxDepth, 3));
  const maxPages = Math.max(1, Math.min(opts.maxPages, 25));
  const sameDomain = opts.sameDomain !== false;
  const contentLimit = opts.contentLimit ?? 4000;

  const queue: Array<{ url: string; depth: number }> = [
    { url: opts.startUrl, depth: 0 },
  ];
  const seen = new Set<string>();
  const pages: CrawlPageResult[] = [];

  while (queue.length && pages.length < maxPages) {
    if (opts.signal?.aborted) break;
    const item = queue.shift()!;
    let url = item.url;
    try {
      url = new URL(url).href;
    } catch {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);

    try {
      const page = await fetchPage(url, {
        signal: opts.signal,
        politeDelayMs: opts.politeDelayMs,
        jinaFallback: opts.jinaFallback,
        allowChromeDevtools: opts.allowChromeDevtools,
        chromeDebugPort: opts.chromeDebugPort,
      });
      const extracted = extractPage(page.head, page.body, page.finalUrl, {
        maxLinks: 40,
        maxImages: 0,
        contentLimit,
      });
      const outLinks = extracted.links.map(([, href]) => href);
      pages.push({
        url: page.finalUrl,
        title: extracted.title || extracted.h1,
        content: extracted.content,
        links: outLinks.slice(0, 20),
      });

      if (item.depth < maxDepth) {
        for (const href of outLinks) {
          if (pages.length + queue.length >= maxPages * 2) break;
          if (sameDomain && !sameHost(opts.startUrl, href)) continue;
          if (seen.has(href)) continue;
          if (!/^https?:\/\//i.test(href)) continue;
          queue.push({ url: href, depth: item.depth + 1 });
        }
      }
    } catch (e) {
      pages.push({
        url,
        title: "",
        content: "",
        links: [],
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { startUrl: opts.startUrl, pages, visited: pages.length };
}
