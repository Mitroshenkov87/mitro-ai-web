/**
 * Smoke-test adult engines + webSearch NSFW path (compiled dist).
 */
import { createRequire } from "module";
import { pathToFileURL } from "url";
import { join } from "path";

const root = process.cwd();
// Use dynamic import of compiled JS
const { searchNudevista, nudevistaImageUrls } = await import(
  pathToFileURL(join(root, "dist/search/engines/nudevista.js")).href
);
const { searchXnxx, xnxxImageUrls } = await import(
  pathToFileURL(join(root, "dist/search/engines/xnxx.js")).href
);
const { searchXvideos } = await import(
  pathToFileURL(join(root, "dist/search/engines/xvideos.js")).href
);
const { searchEporner } = await import(
  pathToFileURL(join(root, "dist/search/engines/eporner.js")).href
);
const { searchHqporner } = await import(
  pathToFileURL(join(root, "dist/search/engines/hqporner.js")).href
);
const { searchPornmd, searchIxxx, searchFuq } = await import(
  pathToFileURL(join(root, "dist/search/engines/adultAggregators.js")).href
);
const { webSearch } = await import(
  pathToFileURL(join(root, "dist/search/auto.js")).href
);
const { collectAdultImageUrls } = await import(
  pathToFileURL(join(root, "dist/images/adultImageSources.js")).href
);

const ctx = {
  politeDelayMs: 50,
  safeSearch: "off",
  limit: 8,
};

const q = process.argv[2] || "riley reid";

async function tryOne(name, fn) {
  const t0 = Date.now();
  try {
    const r = await fn();
    const n = Array.isArray(r) ? r.length : r?.count ?? r?.urls?.length ?? "?";
    const sample = Array.isArray(r)
      ? r[0]
      : r?.results?.[0] || r?.urls?.[0];
    console.log(
      `OK  ${name.padEnd(18)} n=${String(n).padStart(3)} ${Date.now() - t0}ms`,
      sample
        ? typeof sample === "string"
          ? sample.slice(0, 80)
          : `${(sample.title || "").slice(0, 40)} | ${(sample.url || "").slice(0, 60)}`
        : "",
    );
    return r;
  } catch (e) {
    console.log(
      `ERR ${name.padEnd(18)} ${Date.now() - t0}ms`,
      e instanceof Error ? e.message.slice(0, 100) : e,
    );
    return null;
  }
}

console.log("query:", q);
await tryOne("nudevista", () => searchNudevista(q, ctx));
await tryOne("nudevista imgs", () => nudevistaImageUrls(q, ctx, 10));
await tryOne("xnxx", () => searchXnxx(q, ctx));
await tryOne("xvideos", () => searchXvideos(q, ctx));
await tryOne("eporner", () => searchEporner(q, ctx));
await tryOne("hqporner", () => searchHqporner(q, ctx));
await tryOne("pornmd", () => searchPornmd(q, ctx));
await tryOne("ixxx", () => searchIxxx(q, ctx));
await tryOne("fuq", () => searchFuq(q, ctx));
await tryOne("adult images", () =>
  collectAdultImageUrls({ query: q, ctx, cap: 16, timeoutMs: 12_000 }),
);
await tryOne("webSearch NSFW", async () => {
  const r = await webSearch(q + " nude", "auto", ctx, {
    nsfw: true,
    nsfwMode: "on",
  });
  console.log(
    "     enginesUsed:",
    r.enginesUsed,
    "failed:",
    r.enginesFailed?.map((f) => f.engine).join(",") || "-",
    "queries:",
    r.queriesRun,
  );
  return r;
});
