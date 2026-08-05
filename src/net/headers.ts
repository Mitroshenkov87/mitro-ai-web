const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0",
];

export function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export function browserHeaders(opts?: {
  referer?: string;
  accept?: string;
  mode?: "document" | "json" | "image";
}): Record<string, string> {
  const mode = opts?.mode ?? "document";
  const base: Record<string, string> = {
    "User-Agent": randomUA(),
    "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    Connection: "keep-alive",
    "Cache-Control": "no-cache",
  };
  if (opts?.referer) base.Referer = opts.referer;

  if (mode === "json") {
    return {
      ...base,
      Accept: opts?.accept ?? "application/json,text/plain,*/*",
    };
  }
  if (mode === "image") {
    return {
      ...base,
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    };
  }
  return {
    ...base,
    Accept:
      opts?.accept ??
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Upgrade-Insecure-Requests": "1",
  };
}
