import { writeFile } from "fs/promises";
import { join } from "path";
import { delay } from "../net/http";
import { browserHeaders } from "../net/headers";
import {
  detectFormatFromBuffer,
  evaluateImageQuality,
  IMAGE_MIN_SHORT_SIDE,
  IMAGE_PREFER_SHORT_SIDE,
  isSupportedImagePayload,
  urlLooksLowQuality,
  type ProbeResult,
} from "./qualityProbe";

export interface DownloadedImage {
  fullPath: string;
  /** Same as fullPath — thumbs are not written to disk. */
  thumbPath: string;
  sourceUrl: string;
  width: number;
  height: number;
  shortSide: number;
  format: string;
  bytes: number;
  qualityReason: string;
  score: number;
}

export interface DownloadImagesResult {
  images: string[];
  entries: DownloadedImage[];
  count: number;
  rejected: Array<{ url: string; reason: string; shortSide?: number; bytes?: number }>;
  compactGalleryMarkdown: string;
  hint: string;
}

function extForFormat(format: string): string {
  const f = format.toLowerCase();
  if (f === "jpeg" || f === "jpg") return ".jpg";
  if (f === "png") return ".png";
  if (f === "webp") return ".webp";
  if (f === "gif") return ".gif";
  if (f === "heic") return ".heic";
  if (f === "heif") return ".heif";
  if (f === "avif") return ".avif";
  if (f === "bmp") return ".bmp";
  return ".img";
}

/**
 * Adult CDNs (xvideos/xnxx/nudevista/…) return 404 without a parent-site Referer.
 * Never use the image URL itself as Referer.
 */
export function refererForImageUrl(imageUrl: string): string {
  try {
    const h = new URL(imageUrl).hostname.toLowerCase();
    if (/xvideos|xv-cdn|xvideos-cdn/i.test(h)) return "https://www.xvideos.com/";
    if (/xnxx|xnxx-cdn/i.test(h)) return "https://www.xnxx.com/";
    if (/nudevista|t\d*\.nudevista|i\d*\.nudevista/i.test(h))
      return "https://www.nudevista.com/";
    if (/eporner/i.test(h)) return "https://www.eporner.com/";
    if (/hqporner|fastporndelivery/i.test(h)) return "https://hqporner.com/";
    if (/fapello|erome|imagefap|imgbox|imagebam|pixhost|bunkr|coomer/i.test(h))
      return `https://${h}/`;
    if (/ibb\.co|imgbb|postimg|imgur/i.test(h)) return "https://imgbb.com/";
    // Same-origin parent of CDN subdomain
    const parts = h.split(".");
    if (parts.length >= 2) {
      const root = parts.slice(-2).join(".");
      return `https://www.${root}/`;
    }
  } catch {
    /* fall through */
  }
  return "https://www.google.com/";
}

/**
 * Download candidates; accept jpg/jpeg/png/webp/heic/heif/avif.
 * Saves ONLY full images (no separate -thumb.webp sidecars).
 * Size bands when dims unknown: ~90–150KB+ keep, ~20–40KB reject.
 */
export async function downloadImages(
  urls: string[],
  workingDirectory: string,
  opts: {
    signal?: AbortSignal;
    politeDelayMs?: number;
    max?: number;
    minShortSide?: number;
    preferShortSide?: number;
    skipJunkUrls?: boolean;
  } = {},
): Promise<DownloadImagesResult> {
  const max = opts.max ?? 10;
  const minShortSide = opts.minShortSide ?? IMAGE_MIN_SHORT_SIDE;
  const preferShortSide = opts.preferShortSide ?? IMAGE_PREFER_SHORT_SIDE;
  const skipJunk = opts.skipJunkUrls !== false;

  const candidateCap = Math.max(max * 6, 24);
  let candidates = [...new Set(urls.filter((u) => u.startsWith("http")))].slice(
    0,
    candidateCap,
  );
  if (skipJunk) {
    const filtered = candidates.filter((u) => !urlLooksLowQuality(u));
    if (filtered.length >= max) candidates = filtered;
    else
      candidates = [
        ...filtered,
        ...candidates.filter((u) => urlLooksLowQuality(u)),
      ];
  }

  const entries: DownloadedImage[] = [];
  const rejected: DownloadImagesResult["rejected"] = [];
  const timestamp = Date.now();
  let fetchIndex = 0;
  let nextIdx = 0;
  const CONCURRENCY = 4;
  const PER_URL_TIMEOUT_MS = 12_000;

  /** Process a single URL; returns early when max already filled / aborted. */
  async function processOne(sourceUrl: string): Promise<void> {
    if (opts.signal?.aborted) return;
    if (entries.length >= max) return;

    try {
      if (opts.politeDelayMs) await delay(opts.politeDelayMs);
      const timeoutSignal =
        typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
          ? AbortSignal.timeout(PER_URL_TIMEOUT_MS)
          : undefined;
      let signal = opts.signal;
      if (timeoutSignal && opts.signal && "any" in AbortSignal) {
        signal = AbortSignal.any([opts.signal, timeoutSignal]);
      } else if (timeoutSignal) {
        signal = timeoutSignal;
      }
      const referer = refererForImageUrl(sourceUrl);
      const response = await fetch(sourceUrl, {
        method: "GET",
        signal,
        headers: {
          ...browserHeaders({ mode: "image", referer }),
          // Some CDNs also check Origin / Sec-Fetch
          Origin: referer.replace(/\/$/, ""),
        },
        redirect: "follow",
      });
      if (!response.ok) {
        rejected.push({ url: sourceUrl, reason: `HTTP ${response.status}` });
        return;
      }
      // Re-check after network wait — another worker may have filled max
      if (entries.length >= max || opts.signal?.aborted) return;

      const ab = await response.arrayBuffer();
      const bytes = Buffer.from(ab);
      const ct = response.headers.get("content-type") || "";

      if (!isSupportedImagePayload(bytes, ct, sourceUrl)) {
        rejected.push({
          url: sourceUrl,
          reason: `not a supported image (${ct || "no type"})`,
          bytes: bytes.length,
        });
        return;
      }

      const format = detectFormatFromBuffer(bytes, ct, sourceUrl);
      const probe: ProbeResult = evaluateImageQuality(bytes, sourceUrl, {
        minShortSide,
        preferShortSide,
        contentType: ct,
      });

      if (!probe.keep) {
        rejected.push({
          url: sourceUrl,
          reason: probe.reason,
          shortSide: probe.dimensions?.shortSide,
          bytes: bytes.length,
        });
        return;
      }

      if (entries.length >= max || opts.signal?.aborted) return;

      const width = probe.dimensions?.width ?? 0;
      const height = probe.dimensions?.height ?? 0;
      const shortSide = probe.dimensions?.shortSide ?? 0;
      const ext = extForFormat(probe.formatHint || format);
      const dimLabel =
        width && height ? `${width}x${height}` : `${Math.round(bytes.length / 1024)}kb`;
      const myIndex = fetchIndex++;
      const fileName = `${timestamp}-${myIndex}-${dimLabel}${ext}`;
      const filePath = join(workingDirectory, fileName);
      await writeFile(filePath, bytes);

      // No separate -thumb.webp — full file is enough for chat + analyze_image
      if (entries.length >= max) return;
      entries.push({
        fullPath: fileName,
        thumbPath: fileName,
        sourceUrl,
        width,
        height,
        shortSide,
        format: probe.formatHint || format,
        bytes: bytes.length,
        qualityReason: probe.reason,
        score: probe.score,
      });
    } catch (e) {
      rejected.push({
        url: sourceUrl,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Bounded concurrency pool (3–4 workers); respects max + abort
  async function worker(): Promise<void> {
    while (true) {
      if (opts.signal?.aborted || entries.length >= max) return;
      const i = nextIdx++;
      if (i >= candidates.length) return;
      await processOne(candidates[i]);
    }
  }

  const workers = Math.min(CONCURRENCY, candidates.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));

  // Cap after parallel race (workers may slightly overshoot max)
  entries.sort((a, b) => b.score - a.score);
  if (entries.length > max) entries.length = max;

  const images = entries.map((e) => {
    const dim =
      e.width && e.height
        ? `${e.width}x${e.height}`
        : `${Math.round(e.bytes / 1024)}KB`;
    return `![${dim}](${e.fullPath}) (${e.format}, ${Math.round(e.bytes / 1024)}KB)`;
  });
  const gallery = entries
    .slice(0, 6)
    .map((e) => {
      const dim =
        e.width && e.height
          ? `${e.width}x${e.height}`
          : `${Math.round(e.bytes / 1024)}KB`;
      return `![${dim}](${e.fullPath})`;
    })
    .join(" ");

  return {
    images,
    entries,
    count: entries.length,
    rejected: rejected.slice(0, 40),
    compactGalleryMarkdown: gallery,
    hint:
      entries.length > 0
        ? `Saved ${entries.length} full image(s) (no thumb sidecars; jpg/png/webp/heic/heif/avif).`
        : `No images saved (${rejected.length} rejected). Check rejected[].reason for size/format filters.`,
  };
}
