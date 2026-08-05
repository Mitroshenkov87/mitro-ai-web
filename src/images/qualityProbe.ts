/**
 * Image quality probe with format + file-size heuristics.
 * Many CDNs serve webp/heic where dimensions are hard to parse — use size bands.
 */

export const IMAGE_MIN_SHORT_SIDE = 240;
export const IMAGE_PREFER_SHORT_SIDE = 480;
export const IMAGE_IDEAL_SHORT_SIDE = 720;

/** ~90–150 KiB without readable dims → likely a real photo */
export const SIZE_LIKELY_PHOTO_MIN = 90 * 1024;
export const SIZE_LIKELY_PHOTO_MAX = 400 * 1024; // upper soft band for "good without dims"
/** ~20–40 KiB without dims → likely thumb/crop */
export const SIZE_LIKELY_THUMB_MAX = 45 * 1024;

export interface ImageDimensions {
  width: number;
  height: number;
  shortSide: number;
  longSide: number;
  format: string;
}

export interface ProbeResult {
  keep: boolean;
  reason: string;
  dimensions?: ImageDimensions;
  score: number;
  above480: boolean;
  formatHint?: string;
}

export function urlLooksLowQuality(url: string): boolean {
  const u = url.toLowerCase();
  const bad = [
    "favicon",
    "sprite",
    "/16x16",
    "/32x32",
    "/48x48",
    "/64x64",
    "1x1",
    "pixel.gif",
    "spacer",
    "blank.",
  ];
  return bad.some((b) => u.includes(b));
}

export function preferFullImageUrl(
  image?: string,
  thumbnail?: string,
): string | null {
  if (image && image.startsWith("http")) return image;
  if (thumbnail && thumbnail.startsWith("http")) return thumbnail;
  return null;
}

export function detectFormatFromUrl(url: string): string | undefined {
  const m = url.toLowerCase().match(/\.(jpe?g|png|webp|gif|heic|heif|avif|bmp)(?:\?|$)/i);
  return m?.[1]?.toLowerCase().replace("jpeg", "jpg");
}

export function detectFormatFromBuffer(
  buf: Buffer,
  contentType: string,
  url: string,
): string {
  const ct = contentType.toLowerCase();
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("heic")) return "heic";
  if (ct.includes("heif")) return "heif";
  if (ct.includes("avif")) return "avif";

  if (buf[0] === 0xff && buf[1] === 0xd8) return "jpg";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "png";
  if (buf[0] === 0x47 && buf[1] === 0x49) return "gif";
  if (
    buf.length > 12 &&
    buf.slice(0, 4).toString("ascii") === "RIFF" &&
    buf.slice(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }
  // HEIC/HEIF: ....ftypheic / heif / mif1 / msf1
  if (buf.length > 16 && buf.slice(4, 8).toString("ascii") === "ftyp") {
    const brand = buf.slice(8, 16).toString("ascii").toLowerCase();
    if (/heic|heif|mif1|msf1|hevc|avif/.test(brand)) {
      if (brand.includes("avif")) return "avif";
      if (brand.includes("heic")) return "heic";
      return "heif";
    }
  }
  return detectFormatFromUrl(url) || "bin";
}

export function isSupportedImagePayload(
  buf: Buffer,
  contentType: string,
  url: string,
): boolean {
  const ct = contentType.toLowerCase();
  if (
    ct.startsWith("image/") ||
    ct.includes("jpeg") ||
    ct.includes("jpg") ||
    ct.includes("png") ||
    ct.includes("webp") ||
    ct.includes("heic") ||
    ct.includes("heif") ||
    ct.includes("avif") ||
    ct.includes("gif")
  ) {
    return true;
  }
  if (buf.length < 12) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8) return true;
  if (buf[0] === 0x89 && buf[1] === 0x50) return true;
  if (buf[0] === 0x47 && buf[1] === 0x49) return true;
  if (
    buf.slice(0, 4).toString("ascii") === "RIFF" &&
    buf.slice(8, 12).toString("ascii") === "WEBP"
  ) {
    return true;
  }
  if (buf.slice(4, 8).toString("ascii") === "ftyp") {
    const brand = buf.slice(8, 16).toString("ascii").toLowerCase();
    if (/heic|heif|mif1|msf1|hevc|avif/.test(brand)) return true;
  }
  // URL extension fallback
  return Boolean(detectFormatFromUrl(url));
}

export function probeImageDimensions(buf: Buffer): ImageDimensions | null {
  if (buf.length < 24) return null;

  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return dim(buf.readUInt32BE(16), buf.readUInt32BE(20), "png");
  }

  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return dim(buf.readUInt16LE(6), buf.readUInt16LE(8), "gif");
  }

  if (
    buf.slice(0, 4).toString("ascii") === "RIFF" &&
    buf.slice(8, 12).toString("ascii") === "WEBP"
  ) {
    const chunk = buf.slice(12, 16).toString("ascii");
    if (chunk === "VP8X" && buf.length >= 30) {
      return dim(1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3), "webp");
    }
    if (chunk === "VP8 " && buf.length >= 30) {
      return dim(
        buf.readUInt16LE(26) & 0x3fff,
        buf.readUInt16LE(28) & 0x3fff,
        "webp",
      );
    }
    if (chunk === "VP8L" && buf.length >= 25) {
      const b0 = buf[21];
      const b1 = buf[22];
      const b2 = buf[23];
      const b3 = buf[24];
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height =
        1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      return dim(width, height, "webp");
    }
  }

  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 8) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0xd9) {
        i += 2;
        continue;
      }
      const len = buf.readUInt16BE(i + 2);
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isSof && i + 8 < buf.length) {
        return dim(buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5), "jpeg");
      }
      if (len < 2) break;
      i += 2 + len;
    }
  }

  // HEIC/AVIF: dimensions need a full box parser; return null → size heuristics
  return null;
}

function dim(
  width: number,
  height: number,
  format: string,
): ImageDimensions | null {
  if (!width || !height || width > 20000 || height > 20000) return null;
  return {
    width,
    height,
    shortSide: Math.min(width, height),
    longSide: Math.max(width, height),
    format,
  };
}

/**
 * Size-band heuristic when dimensions unknown (webp/heic common):
 *  - 90–150+ KiB → keep (likely real photo)
 *  - 20–45 KiB → reject (likely crop/thumb)
 */
export function evaluateImageQuality(
  bytes: Buffer,
  sourceUrl: string,
  opts: {
    minShortSide?: number;
    preferShortSide?: number;
    contentType?: string;
  } = {},
): ProbeResult {
  const minSide = opts.minShortSide ?? IMAGE_MIN_SHORT_SIDE;
  const preferSide = opts.preferShortSide ?? IMAGE_PREFER_SHORT_SIDE;
  const formatHint = detectFormatFromBuffer(
    bytes,
    opts.contentType || "",
    sourceUrl,
  );
  const size = bytes.length;

  const dimensions = probeImageDimensions(bytes);

  // ── No dimensions (heic/heif/some webp/avif) ──────────
  if (!dimensions) {
    const modern =
      /^(jpg|jpeg|png|webp|heic|heif|avif)$/i.test(formatHint) ||
      isSupportedImagePayload(bytes, opts.contentType || "", sourceUrl);

    if (!modern && size < SIZE_LIKELY_PHOTO_MIN) {
      return {
        keep: false,
        reason: `unknown format, ${size}B`,
        score: 0,
        above480: false,
        formatHint,
      };
    }

    // 20–45 KB → thumb territory
    if (size > 0 && size <= SIZE_LIKELY_THUMB_MAX) {
      return {
        keep: false,
        reason: `no dims, ${Math.round(size / 1024)}KB — likely thumb/crop`,
        score: size / 1024,
        above480: false,
        formatHint,
      };
    }

    // 90 KB+ → likely photo we want
    if (size >= SIZE_LIKELY_PHOTO_MIN) {
      const score =
        size >= 150 * 1024 ? 280 : size >= 120 * 1024 ? 240 : 200;
      return {
        keep: true,
        reason: `no dims (${formatHint}), ${Math.round(size / 1024)}KB in photo size band — saved`,
        score,
        above480: size >= 120 * 1024,
        formatHint,
      };
    }

    // 45–90 KB gray zone: keep modern formats, mild score
    if (size > SIZE_LIKELY_THUMB_MAX && modern) {
      return {
        keep: true,
        reason: `no dims (${formatHint}), ${Math.round(size / 1024)}KB mid-size — soft-saved`,
        score: 150,
        above480: false,
        formatHint,
      };
    }

    return {
      keep: false,
      reason: `no dims, ${Math.round(size / 1024)}KB — ambiguous`,
      score: 0,
      above480: false,
      formatHint,
    };
  }

  // ── With dimensions ───────────────────────────────────
  const { shortSide, longSide, width, height } = dimensions;
  const above480 = shortSide >= 480;
  const aspect = longSide / Math.max(1, shortSide);

  if (aspect > 6) {
    return {
      keep: false,
      reason: `extreme aspect ${width}x${height}`,
      dimensions,
      score: 0,
      above480,
      formatHint,
    };
  }

  if (shortSide < minSide && width < 400 && height < 400) {
    return {
      keep: false,
      reason: `too small ${width}x${height}`,
      dimensions,
      score: shortSide,
      above480,
      formatHint,
    };
  }

  const area = width * height;
  if (shortSide < minSide && area < 200 * 200) {
    return {
      keep: false,
      reason: `below minimum ${width}x${height}`,
      dimensions,
      score: shortSide,
      above480,
      formatHint,
    };
  }

  if (size < 3_000 && shortSide < 400) {
    return {
      keep: false,
      reason: `tiny file ${size}B at ${width}x${height}`,
      dimensions,
      score: shortSide / 2,
      above480,
      formatHint,
    };
  }

  // Size still matters even with dims: 20–40KB at modest resolution = crop
  if (size <= SIZE_LIKELY_THUMB_MAX && shortSide < preferSide) {
    return {
      keep: false,
      reason: `${Math.round(size / 1024)}KB at ${width}x${height} — likely crop`,
      dimensions,
      score: shortSide / 2,
      above480,
      formatHint,
    };
  }

  let score = shortSide + Math.sqrt(area) / 10;
  if (shortSide >= preferSide) score += 300;
  if (shortSide >= IMAGE_IDEAL_SHORT_SIDE) score += 400;
  if (size >= SIZE_LIKELY_PHOTO_MIN) score += 80;
  if (urlLooksLowQuality(sourceUrl) && shortSide < 300) {
    return {
      keep: false,
      reason: "icon URL and small dimensions",
      dimensions,
      score,
      above480,
      formatHint,
    };
  }

  return {
    keep: true,
    reason: `${width}x${height} ${formatHint || dimensions.format}, ${Math.round(size / 1024)}KB`,
    dimensions,
    score,
    above480,
    formatHint: formatHint || dimensions.format,
  };
}
