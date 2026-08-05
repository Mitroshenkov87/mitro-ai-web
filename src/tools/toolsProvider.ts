import { text, tool, type ToolsProviderController } from "@lmstudio/sdk";
import { z } from "zod";
import { configSchematics } from "../config/schematics";
import { webSearch } from "../search/auto";
import type { EngineContext, SearchEngineId } from "../search/types";
import { fetchPage } from "../page/fetchPage";
import { extractPage } from "../page/extract";
import { crawlSite } from "../page/crawl";
import { downloadImages } from "../images/download";
import { imageSearch } from "../images/searchImages";
import { osintInvestigate } from "../osint/investigate";
import { analyzeLocalImage } from "../vision/analyzeImage";
import { fetchText } from "../net/http";
import { normalizeNsfwMode } from "../nsfw/keywords";

function engineCtx(ctl: ToolsProviderController, limit?: number): EngineContext {
  const c = ctl.getPluginConfig(configSchematics);
  const osint = String(c.get("researchMode") || "normal") === "osint";
  const baseLimit = Number(c.get("resultsPerSearch") ?? 12);
  const rawSafe = String(c.get("safeSearch") ?? "off");
  // Default and fallback: SafeSearch OFF on every engine request
  const safeSearch =
    rawSafe === "strict" || rawSafe === "moderate" || rawSafe === "off"
      ? rawSafe
      : "off";
  return {
    politeDelayMs: Number(c.get("politeDelayMs") ?? 250),
    safeSearch,
    limit: limit ?? (osint ? Math.max(baseLimit, 16) : baseLimit),
    googleApiKey: String(c.get("googleApiKey") ?? ""),
    googleCx: String(c.get("googleCx") ?? ""),
    googleProvider:
      (c.get("googleProvider") as "custom_search" | "serper" | "serpapi") ||
      "custom_search",
  };
}

function nsfwOpts(ctl: ToolsProviderController, toolNsfw?: boolean) {
  const c = ctl.getPluginConfig(configSchematics);
  return {
    nsfw: toolNsfw,
    nsfwMode: normalizeNsfwMode(String(c.get("nsfwMode") || "auto")),
    nsfwExtraKeywords: String(c.get("nsfwExtraKeywords") ?? ""),
  };
}

/** Site scraping + optional Chrome DevTools (user must enable in settings). */
function scrapeOpts(ctl: ToolsProviderController) {
  const c = ctl.getPluginConfig(configSchematics);
  const allowSiteScraping = c.get("allowSiteScraping") !== false;
  const allowChromeDevtools =
    allowSiteScraping && Boolean(c.get("allowChromeDevtools"));
  return {
    allowSiteScraping,
    jinaFallback: Boolean(c.get("jinaFallback")),
    allowChromeDevtools,
    chromeDebugPort: Number(c.get("chromeDebugPort") ?? 9222),
    politeDelayMs: Number(c.get("politeDelayMs") ?? 250),
  };
}

function scrapingDisabledError() {
  return {
    error: "scraping_disabled",
    message:
      "Site scraping is OFF in plugin settings (Allow site scraping). " +
      "Enable it to use visit/crawl and page harvest. " +
      "Chrome DevTools is a separate permission for JS-heavy pages.",
  };
}

export async function toolsProvider(ctl: ToolsProviderController) {
  const c0 = ctl.getPluginConfig(configSchematics);
  const isOsint = String(c0.get("researchMode") || "normal") === "osint";

  const webSearchTool = tool({
    name: "web_search",
    description: text`
      Multi-engine web search (most engines need no API key).
      WHEN: facts, news, people/org lookups. WHEN NOT: photos → image_search; deep dossiers → osint_investigate.
      Search mode (plugin): sfw | auto | auto_unsafe | nsfw — same plan as image_search.
      sfw: traditional engines, NSFW dictionary stripped.
      auto: strong detect → SFW or NSFW.
      auto_unsafe: looser detect (soft keywords) + SafeSearch Off.
      nsfw: specialized NSFW indexes + traditional, SafeSearch Off, dictionary tags.
      engine=auto picks engines from mode; or set engine= explicitly.
      Tags as separate + OR forms. nsfw=true|false overrides mode per call.
    `,
    parameters: {
      query: z.string().min(1).describe("Search query"),
      engine: z
        .enum([
          "auto",
          "ddg",
          "bing",
          "yandex",
          "yahoo",
          "brave",
          "wikipedia",
          "qwant",
          "mojeek",
          "searx",
          "google",
          "nudevista",
          "pornmd",
          "ixxx",
          "fuq",
          "xnxx",
          "xvideos",
          "eporner",
          "hqporner",
        ])
        .optional()
        .describe("Search engine; default auto"),
      limit: z.number().int().min(1).max(30).optional(),
      nsfw: z
        .boolean()
        .optional()
        .describe(
          "Override: true = NSFW pipeline this call; false = SFW this call. Omit to follow plugin mode (sfw|auto|nsfw).",
        ),
    },
    implementation: async ({ query, engine, limit, nsfw }, { status, signal }) => {
      status(`Search: ${query.slice(0, 60)}`);
      const ctx = { ...engineCtx(ctl, limit), signal };
      return await webSearch(query, (engine || "auto") as SearchEngineId, ctx, {
        osintBoost: isOsint,
        ...nsfwOpts(ctl, nsfw),
      });
    },
  });

  const visitTool = tool({
    name: "visit",
    description: text`
      Open a URL and extract title, description, headings, links, images, text content, JSON-LD.
      Requires "Allow site scraping" in settings. Direct fetch → Jina → optional Chrome DevTools
      (only if user enabled Chrome DevTools and Chrome runs with --remote-debugging-port).
    `,
    parameters: {
      url: z.string().url(),
      find_in_page: z.array(z.string()).optional(),
      max_links: z.number().int().min(0).max(200).optional(),
      max_images: z.number().int().min(0).max(50).optional(),
      content_limit: z.number().int().min(0).max(50000).optional(),
      download_page_images: z.boolean().optional().describe("Also download images to working dir"),
    },
    implementation: async (
      { url, find_in_page, max_links, max_images, content_limit, download_page_images },
      { status, signal },
    ) => {
      const c = ctl.getPluginConfig(configSchematics);
      const scrape = scrapeOpts(ctl);
      if (!scrape.allowSiteScraping) return scrapingDisabledError();
      status(`Visit ${url}`);
      const page = await fetchPage(url, {
        signal,
        politeDelayMs: scrape.politeDelayMs,
        jinaFallback: scrape.jinaFallback,
        allowChromeDevtools: scrape.allowChromeDevtools,
        chromeDebugPort: scrape.chromeDebugPort,
      });
      const maxContent = content_limit ?? Number(c.get("maxContentChars") ?? 12000);
      const extracted = extractPage(page.head, page.body, page.finalUrl, {
        maxLinks: max_links ?? 60,
        maxImages: max_images ?? 12,
        contentLimit: maxContent,
        findInPage: find_in_page,
      });

      let imagesPayload: unknown = undefined;
      if (download_page_images && extracted.images.length) {
        imagesPayload = await downloadImages(
          extracted.images.map(([, src]) => src),
          ctl.getWorkingDirectory(),
          {
            signal,
            politeDelayMs: scrape.politeDelayMs,
            max: max_images ?? 12,
          },
        );
      }

      return {
        url,
        title: extracted.title,
        h1: extracted.h1,
        description: extracted.description,
        fetch: {
          source: page.source,
          finalUrl: page.finalUrl,
          statusCode: page.statusCode,
          server: page.server || undefined,
          chromeDevtools: scrape.allowChromeDevtools,
        },
        links: extracted.links,
        imageUrls: extracted.images,
        content: extracted.content,
        jsonLd: extracted.jsonLd.length ? extracted.jsonLd : undefined,
        downloadedImages: imagesPayload,
      };
    },
  });

  const crawlTool = tool({
    name: "crawl",
    description:
      "Crawl from a start URL following links (same domain by default). " +
      "Requires Allow site scraping. Uses Chrome DevTools only if user enabled it.",
    parameters: {
      start_url: z.string().url(),
      max_depth: z.number().int().min(0).max(3).optional(),
      max_pages: z.number().int().min(1).max(25).optional(),
      same_domain: z.boolean().optional(),
    },
    implementation: async (
      { start_url, max_depth, max_pages, same_domain },
      { status, signal },
    ) => {
      const c = ctl.getPluginConfig(configSchematics);
      const scrape = scrapeOpts(ctl);
      if (!scrape.allowSiteScraping) return scrapingDisabledError();
      status(`Crawl ${start_url}`);
      return await crawlSite({
        startUrl: start_url,
        maxDepth: max_depth ?? (isOsint ? 2 : 1),
        maxPages: max_pages ?? (isOsint ? 12 : 8),
        sameDomain: same_domain ?? true,
        contentLimit: Math.min(Number(c.get("maxContentChars") ?? 12000), 6000),
        politeDelayMs: scrape.politeDelayMs,
        jinaFallback: scrape.jinaFallback,
        allowChromeDevtools: scrape.allowChromeDevtools,
        chromeDebugPort: scrape.chromeDebugPort,
        signal,
      });
    },
  });

  const imageSearchTool = tool({
    name: "image_search",
    description:
      "PRIMARY tool for finding AND SAVING photos (SFW and NSFW by search mode). " +
      "WHEN: images/photos/pics. WHEN NOT: text facts → web_search; dossiers → osint_investigate. " +
      "Full images only (no -thumb). Same mode plan as web_search: sfw | auto | nsfw. " +
      "sfw: Bing/DDG, dictionary stripped. nsfw/auto-match: Bing → specialized hosts → SERP → gallery.",
    parameters: {
      query: z
        .string()
        .min(1)
        .describe(
          "Short subject (name). Plugin applies/strips NSFW dictionary by mode (sfw|auto|nsfw).",
        ),
      limit: z.number().int().min(1).max(15).optional(),
      min_short_side: z
        .number()
        .int()
        .min(120)
        .max(2160)
        .optional()
        .describe("Min short side in px to save (default from settings, usually 240)."),
      nsfw: z
        .boolean()
        .optional()
        .describe(
          "Override: true = NSFW image pipeline; false = SFW. Omit to follow plugin mode.",
        ),
    },
    implementation: async (
      { query, limit, min_short_side, nsfw },
      { status, signal },
    ) => {
      status(`Images: ${query.slice(0, 50)}`);
      const c = ctl.getPluginConfig(configSchematics);
      const scrape = scrapeOpts(ctl);
      const defaultMin = Number(c.get("imageMinShortSide") ?? 240);
      return await imageSearch({
        query,
        limit: limit ?? 8,
        workingDirectory: ctl.getWorkingDirectory(),
        ctx: { ...engineCtx(ctl), signal },
        jinaFallback: scrape.jinaFallback,
        allowSiteScraping: scrape.allowSiteScraping,
        allowChromeDevtools: scrape.allowChromeDevtools,
        chromeDebugPort: scrape.chromeDebugPort,
        minShortSide: min_short_side ?? defaultMin,
        ...nsfwOpts(ctl, nsfw),
      });
    },
  });

  const downloadImagesTool = tool({
    name: "download_images",
    description:
      "Download remote image URLs with quality probe (default min short side 240px; prefers larger photos).",
    parameters: {
      urls: z.array(z.string().url()).min(1).max(40),
      min_short_side: z.number().int().min(120).max(2160).optional(),
      max: z.number().int().min(1).max(20).optional(),
    },
    implementation: async ({ urls, min_short_side, max }, { status, signal }) => {
      status(`Download/probe ${urls.length} images`);
      const c = ctl.getPluginConfig(configSchematics);
      const defaultMin = Number(c.get("imageMinShortSide") ?? 240);
      return await downloadImages(urls, ctl.getWorkingDirectory(), {
        signal,
        politeDelayMs: Number(c.get("politeDelayMs") ?? 250),
        minShortSide: min_short_side ?? defaultMin,
        max: max ?? 10,
      });
    },
  });

  const fetchRawTool = tool({
    name: "fetch_raw",
    description: "HTTP GET any URL; return status, content-type, and body snippet (APIs/JSON).",
    parameters: {
      url: z.string().url(),
      max_chars: z.number().int().min(100).max(100000).optional(),
    },
    implementation: async ({ url, max_chars }, { status, signal }) => {
      status(`GET ${url}`);
      const c = ctl.getPluginConfig(configSchematics);
      const res = await fetchText(url, {
        signal,
        politeDelayMs: Number(c.get("politeDelayMs") ?? 250),
        maxBytes: max_chars ?? 100_000,
      });
      const max = max_chars ?? 20000;
      return {
        ok: res.ok,
        status: res.status,
        finalUrl: res.url,
        contentType: res.headers.get("content-type"),
        server: res.server || undefined,
        body: res.text.slice(0, max),
        truncated: res.text.length > max,
      };
    },
  });

  const analyzeTool = tool({
    name: "analyze_image",
    description: "Analyze a local image file (from image_search/download) with the loaded vision model.",
    parameters: {
      image_name: z
        .string()
        .describe("Filename in working directory, e.g. 123-0-1280x720.jpg"),
      prompt: z.string().describe("What to analyze / question about the image"),
      context: z.string().describe("Known context for the analysis"),
    },
    implementation: async ({ image_name, prompt, context }, { status }) => {
      status(`Analyze ${image_name}`);
      return await analyzeLocalImage(ctl, image_name, prompt, context);
    },
  });

  const osintTool = tool({
    name: "osint_investigate",
    description: text`
      Deep multi-pass OSINT for people/companies/facts: search + visit a few pages + entities.
      Hard time budget (~35–50s) so it will not hang. Partial results if budget runs out.
      Do NOT use for "find images/photos" — call image_search instead.
      nsfw=true forces NSFW pipeline for this call (follows plugin mode if omitted).
    `,
    parameters: {
      query: z.string().min(1),
      max_passes: z.number().int().min(1).max(4).optional(),
      max_pages: z.number().int().min(2).max(12).optional(),
      nsfw: z
        .boolean()
        .optional()
        .describe("Override search mode for this OSINT run (true=nsfw, false=sfw)."),
    },
    implementation: async (
      { query, max_passes, max_pages, nsfw },
      { status, signal },
    ) => {
      const c = ctl.getPluginConfig(configSchematics);
      const nsfwBag = nsfwOpts(ctl, nsfw);
      // If model forced nsfw=true or keywords, keep OSINT short
      const scrape = scrapeOpts(ctl);
      status(`OSINT: ${query.slice(0, 50)}`);
      return await osintInvestigate({
        query,
        maxPasses: max_passes,
        maxPages: max_pages,
        ctx: { ...engineCtx(ctl), signal },
        jinaFallback: scrape.jinaFallback,
        allowSiteScraping: scrape.allowSiteScraping,
        allowChromeDevtools: scrape.allowChromeDevtools,
        chromeDebugPort: scrape.chromeDebugPort,
        maxContentChars: Number(c.get("maxContentChars") ?? 8000),
        status,
        ...nsfwBag,
      });
    },
  });

  return [
    webSearchTool,
    visitTool,
    crawlTool,
    imageSearchTool,
    downloadImagesTool,
    fetchRawTool,
    analyzeTool,
    osintTool,
  ];
}
