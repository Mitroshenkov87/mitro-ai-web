import { fetchText, looksBlocked } from "../net/http";
import { fetchViaChromeCdp } from "./chromeCdp";

export interface PageFetch {
  html: string;
  body: string;
  head: string;
  source: "direct" | "jina" | "chrome_cdp";
  finalUrl: string;
  statusCode: number;
  server: string;
}

function splitHtml(html: string): { head: string; body: string } {
  const headStart = html.indexOf("<head");
  const headEnd = html.indexOf("</head>");
  const head =
    headStart >= 0 && headEnd > headStart
      ? html.slice(headStart, headEnd + 7)
      : "";
  const bodyMatch = html.match(/<body[^>]*>/i);
  const bodyStart = bodyMatch?.index ?? 0;
  const bodyEnd = html.lastIndexOf("</body>");
  const body = html.slice(bodyStart, bodyEnd > bodyStart ? bodyEnd : html.length);
  return { head, body };
}

async function fetchViaJina(
  url: string,
  signal: AbortSignal | undefined,
  politeDelayMs: number,
  timeoutMs: number,
): Promise<PageFetch | null> {
  const jinaUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`;
  try {
    const res = await fetchText(jinaUrl, {
      signal,
      politeDelayMs,
      timeoutMs,
      retries: 1,
      headers: { Accept: "text/plain,text/html;q=0.9,*/*;q=0.8" },
    });
    if (!res.ok || !res.text.trim()) return null;
    return {
      html: res.text,
      head: "",
      body: res.text,
      source: "jina",
      finalUrl: res.url || jinaUrl,
      statusCode: res.status,
      server: res.server,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch a page: direct → (optional) Jina → (optional) Chrome DevTools CDP.
 * Chrome path only runs when allowChromeDevtools is true (user permission in settings).
 */
export async function fetchPage(
  url: string,
  opts: {
    signal?: AbortSignal;
    politeDelayMs?: number;
    jinaFallback?: boolean;
    /** User enabled Chrome DevTools in plugin settings. */
    allowChromeDevtools?: boolean;
    chromeDebugPort?: number;
    /** Per-attempt network timeout (default 10s). */
    timeoutMs?: number;
    retries?: number;
  } = {},
): Promise<PageFetch> {
  const politeDelayMs = opts.politeDelayMs ?? 250;
  const jina = opts.jinaFallback !== false;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const retries = opts.retries ?? 2;
  const chromeOk = Boolean(opts.allowChromeDevtools);
  const chromePort = opts.chromeDebugPort ?? 9222;

  const tryChrome = async (): Promise<PageFetch | null> => {
    if (!chromeOk) return null;
    try {
      const c = await fetchViaChromeCdp(url, {
        port: chromePort,
        signal: opts.signal,
        timeoutMs: Math.max(timeoutMs, 18_000),
      });
      if (!c?.html) return null;
      const { head, body } = splitHtml(c.html);
      return {
        html: c.html,
        head,
        body,
        source: "chrome_cdp",
        finalUrl: c.finalUrl,
        statusCode: c.statusCode,
        server: "chrome-devtools",
      };
    } catch {
      return null;
    }
  };

  try {
    const res = await fetchText(url, {
      signal: opts.signal,
      politeDelayMs,
      maxBytes: 2_000_000,
      timeoutMs,
      retries,
    });
    if (!res.ok || looksBlocked(res.status, res.text)) {
      if (jina) {
        const fb = await fetchViaJina(
          url,
          opts.signal,
          Math.min(politeDelayMs, 100),
          Math.min(timeoutMs, 8_000),
        );
        if (fb) return fb;
      }
      const ch = await tryChrome();
      if (ch) return ch;
      throw new Error(
        `Failed to fetch: HTTP ${res.status} (server: ${res.server || "unknown"})` +
          (chromeOk
            ? " — Chrome DevTools also failed (is Chrome on --remote-debugging-port?)"
            : " — enable site scraping + Chrome DevTools in settings for JS-heavy pages"),
      );
    }
    const { head, body } = splitHtml(res.text);
    // Thin shell pages (SPA) → try Chrome if allowed
    if (
      chromeOk &&
      body.replace(/<script[\s\S]*?<\/script>/gi, "").trim().length < 400
    ) {
      const ch = await tryChrome();
      if (ch && ch.html.length > res.text.length) return ch;
    }
    return {
      html: res.text,
      head,
      body,
      source: "direct",
      finalUrl: res.url,
      statusCode: res.status,
      server: res.server,
    };
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    if (jina) {
      const fb = await fetchViaJina(
        url,
        opts.signal,
        Math.min(politeDelayMs, 100),
        Math.min(timeoutMs, 8_000),
      );
      if (fb) return fb;
    }
    const ch = await tryChrome();
    if (ch) return ch;
    throw err;
  }
}
