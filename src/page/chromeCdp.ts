/**
 * Optional Chrome DevTools Protocol fetch.
 * Only used when the user enables "Chrome DevTools" in plugin settings
 * (explicit permission) and Chrome is running with remote debugging, e.g.:
 *   chrome.exe --remote-debugging-port=9222
 *
 * Uses HTTP + WebSocket CDP (no puppeteer dependency).
 */

export interface ChromeFetchResult {
  html: string;
  finalUrl: string;
  statusCode: number;
  source: "chrome_cdp";
}

interface CdpTarget {
  id?: string;
  webSocketDebuggerUrl?: string;
  type?: string;
  url?: string;
}

async function cdpHttp(
  port: number,
  path: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Chrome CDP HTTP ${res.status} ${path}`);
  return res.json();
}

/** True if something answers on the debug port. */
export async function isChromeDevtoolsAvailable(
  port: number,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const v = (await cdpHttp(port, "/json/version", signal)) as {
      webSocketDebuggerUrl?: string;
    };
    return Boolean(v?.webSocketDebuggerUrl || true);
  } catch {
    return false;
  }
}

/**
 * Open URL in a new Chrome tab via CDP, wait for load, return outerHTML.
 */
export async function fetchViaChromeCdp(
  url: string,
  opts: {
    port?: number;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<ChromeFetchResult | null> {
  const port = opts.port ?? 9222;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const signal = opts.signal;

  if (!(await isChromeDevtoolsAvailable(port, signal))) {
    return null;
  }

  // Create a new tab pointed at the URL
  let target: CdpTarget;
  try {
    target = (await cdpHttp(
      port,
      `/json/new?${encodeURIComponent(url)}`,
      signal,
    )) as CdpTarget;
  } catch {
    // Some Chrome builds want POST /json/new
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
        method: "PUT",
        signal,
      });
      if (!res.ok) return null;
      target = (await res.json()) as CdpTarget;
    } catch {
      return null;
    }
  }

  const wsUrl = target.webSocketDebuggerUrl;
  if (!wsUrl) return null;

  // Node 22+ / browsers: global WebSocket. Optional `ws` package as fallback.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let WebSocketCtor: any = (globalThis as { WebSocket?: unknown }).WebSocket;
  if (!WebSocketCtor) {
    try {
      const wsMod = (await import("ws" as string)) as {
        default?: unknown;
      };
      WebSocketCtor = wsMod.default || wsMod;
    } catch {
      return null;
    }
  }

  return fetchViaChromeWs(
    WebSocketCtor,
    wsUrl,
    url,
    target.id,
    port,
    timeoutMs,
    signal,
  );
}

async function fetchViaChromeWs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  WebSocketCtor: any,
  wsUrl: string,
  pageUrl: string,
  targetId: string | undefined,
  port: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ChromeFetchResult | null> {
  return new Promise((resolve) => {
    let settled = false;
    let id = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pending = new Map<number, (v: any) => void>();
    const finish = (v: ChromeFetchResult | null) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      // best-effort close tab
      if (targetId) {
        void fetch(`http://127.0.0.1:${port}/json/close/${targetId}`).catch(
          () => undefined,
        );
      }
      resolve(v);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);
    const onAbort = () => {
      clearTimeout(timer);
      finish(null);
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ws: any;
    try {
      ws = new WebSocketCtor(wsUrl);
    } catch {
      clearTimeout(timer);
      finish(null);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const send = (method: string, params?: Record<string, unknown>): Promise<any> => {
      const msgId = ++id;
      return new Promise((res, rej) => {
        pending.set(msgId, res);
        try {
          ws.send(JSON.stringify({ id: msgId, method, params }));
        } catch (e) {
          pending.delete(msgId);
          rej(e);
        }
        setTimeout(() => {
          if (pending.has(msgId)) {
            pending.delete(msgId);
            rej(new Error(`CDP timeout ${method}`));
          }
        }, Math.min(timeoutMs, 15_000));
      });
    };

    ws.addEventListener?.("message", (ev: { data: string }) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.id && pending.has(msg.id)) {
          pending.get(msg.id)!(msg.result ?? msg);
          pending.delete(msg.id);
        }
      } catch {
        /* ignore */
      }
    });
    // Node ws package uses 'on'
    ws.on?.("message", (data: Buffer | string) => {
      try {
        const msg = JSON.parse(String(data));
        if (msg.id && pending.has(msg.id)) {
          pending.get(msg.id)!(msg.result ?? msg);
          pending.delete(msg.id);
        }
      } catch {
        /* ignore */
      }
    });

    const run = async () => {
      try {
        await send("Page.enable");
        await send("Runtime.enable");
        await send("Network.enable");
        await send("Page.navigate", { url: pageUrl });
        // Wait for load event or settle
        await new Promise((r) => setTimeout(r, 2500));
        const evalRes = await send("Runtime.evaluate", {
          expression: `({
            html: document.documentElement ? document.documentElement.outerHTML : document.body?.innerHTML || "",
            href: location.href
          })`,
          returnByValue: true,
        });
        const value = evalRes?.result?.value || evalRes?.result;
        const html = String(value?.html || "");
        const finalUrl = String(value?.href || pageUrl);
        clearTimeout(timer);
        if (!html || html.length < 40) {
          finish(null);
          return;
        }
        finish({
          html,
          finalUrl,
          statusCode: 200,
          source: "chrome_cdp",
        });
      } catch {
        clearTimeout(timer);
        finish(null);
      }
    };

    ws.addEventListener?.("open", () => void run());
    ws.on?.("open", () => void run());
    ws.addEventListener?.("error", () => {
      clearTimeout(timer);
      finish(null);
    });
    ws.on?.("error", () => {
      clearTimeout(timer);
      finish(null);
    });
  });
}
