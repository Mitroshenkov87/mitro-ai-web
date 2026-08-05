/**
 * NSFW visual sources: adult search engines that index XXX better than Bing/DDG.
 * Used only when NsfwDecision.active.
 */
import type { EngineContext } from "../search/types";
import { nudevistaImageUrls } from "../search/engines/nudevista";
import { xnxxImageUrls } from "../search/engines/xnxx";
import { xvideosImageUrls } from "../search/engines/xvideos";
import { epornerImageUrls } from "../search/engines/eporner";
import { hqpornerImageUrls } from "../search/engines/hqporner";

export type AdultImageSourceId =
  | "nudevista"
  | "xnxx"
  | "xvideos"
  | "eporner"
  | "hqporner";

const RUNNERS: Record<
  AdultImageSourceId,
  (q: string, ctx: EngineContext, cap: number) => Promise<string[]>
> = {
  nudevista: nudevistaImageUrls,
  xnxx: xnxxImageUrls,
  xvideos: xvideosImageUrls,
  eporner: epornerImageUrls,
  hqporner: hqpornerImageUrls,
};

/** Priority order for NSFW image candidates. */
export const ADULT_IMAGE_SOURCE_ORDER: AdultImageSourceId[] = [
  "nudevista",
  "xnxx",
  "xvideos",
  "eporner",
  "hqporner",
];

/**
 * Parallel fan-out across adult engines. Hard timeout per source so one hang
 * cannot freeze image_search.
 */
export async function collectAdultImageUrls(opts: {
  query: string;
  ctx: EngineContext;
  cap: number;
  signal?: AbortSignal;
  /** Per-source timeout ms */
  timeoutMs?: number;
  sources?: AdultImageSourceId[];
}): Promise<{ urls: string[]; sourcesUsed: string[]; errors: string[] }> {
  const {
    query,
    ctx,
    cap,
    timeoutMs = 10_000,
    sources = ADULT_IMAGE_SOURCE_ORDER,
  } = opts;
  const urls: string[] = [];
  const sourcesUsed: string[] = [];
  const errors: string[] = [];

  const perCap = Math.max(6, Math.ceil(cap / 2));

  await Promise.all(
    sources.map(async (id) => {
      if (opts.signal?.aborted) return;
      const runner = RUNNERS[id];
      try {
        const batch = await Promise.race([
          runner(query, { ...ctx, signal: opts.signal ?? ctx.signal }, perCap),
          new Promise<string[]>((_, rej) =>
            setTimeout(
              () => rej(new Error(`${id} image timed out after ${timeoutMs}ms`)),
              timeoutMs,
            ),
          ),
        ]);
        if (batch.length) {
          sourcesUsed.push(id);
          for (const u of batch) {
            if (u.startsWith("http") && !urls.includes(u)) urls.push(u);
          }
        }
      } catch (e) {
        errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }),
  );

  return { urls: urls.slice(0, cap), sourcesUsed, errors };
}
