import { browserHeaders } from "./headers";

export interface FetchResult {
  ok: boolean;
  status: number;
  url: string;
  headers: Headers;
  text: string;
  server: string;
}

/** Per-host throttle so parallel engines do not serialize on one global lock. */
const lastRequestByHost = new Map<string, number>();

function hostKey(targetUrl: string): string {
  try {
    return new URL(targetUrl).hostname || "default";
  } catch {
    return "default";
  }
}

export async function politeWait(
  delayMs: number,
  targetUrl?: string,
): Promise<void> {
  if (delayMs <= 0) return;
  const key = targetUrl ? hostKey(targetUrl) : "default";
  const now = Date.now();
  const last = lastRequestByHost.get(key) ?? 0;
  const wait = delayMs - (now - last);
  lastRequestByHost.set(key, Date.now() + Math.max(0, wait));
  if (wait > 0) await delay(wait);
}

export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchText(
  targetUrl: string,
  opts: {
    signal?: AbortSignal;
    headers?: Record<string, string>;
    retries?: number;
    retryStatus?: number[];
    maxBytes?: number;
    politeDelayMs?: number;
    mode?: "document" | "json" | "image";
    referer?: string;
    /** Per-attempt network timeout (default 12s). */
    timeoutMs?: number;
  } = {},
): Promise<FetchResult> {
  await politeWait(opts.politeDelayMs ?? 0, targetUrl);
  const retries = opts.retries ?? 2;
  const retryStatus = opts.retryStatus ?? [429, 500, 502, 503, 504];
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const headers = {
    ...browserHeaders({ mode: opts.mode, referer: opts.referer }),
    ...(opts.headers ?? {}),
  };

  let lastError: unknown = null;
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const timeoutSignal =
        typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
          ? AbortSignal.timeout(timeoutMs)
          : undefined;
      let signal = opts.signal;
      if (timeoutSignal && opts.signal) {
        signal =
          typeof AbortSignal !== "undefined" && "any" in AbortSignal
            ? AbortSignal.any([opts.signal, timeoutSignal])
            : opts.signal;
      } else if (timeoutSignal) {
        signal = timeoutSignal;
      }

      const response = await fetch(targetUrl, {
        method: "GET",
        signal,
        headers,
        redirect: "follow",
      });
      lastResponse = response;
      if (
        response.ok ||
        !retryStatus.includes(response.status) ||
        attempt === retries - 1
      ) {
        const buf = Buffer.from(await response.arrayBuffer());
        const sliced = buf.byteLength > maxBytes ? buf.subarray(0, maxBytes) : buf;
        return {
          ok: response.ok,
          status: response.status,
          url: response.url || targetUrl,
          headers: response.headers,
          text: sliced.toString("utf-8"),
          server: response.headers.get("server") || "",
        };
      }
    } catch (err) {
      lastError = err;
      if (opts.signal?.aborted) throw err;
      if (attempt === retries - 1) throw err;
    }
    await delay(300 * Math.pow(2, attempt) + Math.floor(Math.random() * 200));
  }

  if (lastResponse) {
    const buf = Buffer.from(await lastResponse.arrayBuffer());
    return {
      ok: lastResponse.ok,
      status: lastResponse.status,
      url: lastResponse.url || targetUrl,
      headers: lastResponse.headers,
      text: buf.subarray(0, maxBytes).toString("utf-8"),
      server: lastResponse.headers.get("server") || "",
    };
  }
  throw lastError ?? new Error("fetch failed");
}

export function looksBlocked(status: number, html: string): boolean {
  return (
    status === 401 ||
    status === 403 ||
    status === 429 ||
    status === 503 ||
    /access denied|captcha|cf-chl|checking your browser|attention required|challenge-platform/i.test(
      html,
    )
  );
}
