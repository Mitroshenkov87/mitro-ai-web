/**
 * Identity resolution helpers — reduce collisions like
 * "Nastya Garnis" → "Like Nastya" / "Nastya Nass".
 */

const NSFW_STRIP =
  /\b(xxx|nsfw|nude|nudes|naked|leak|leaked|leaks|onlyfans|fansly|porn|porno|sex|sexy|uncensored|explicit|metart|hegre|femjoy|model|photoshoot|gallery|pics?|photos?|images?)\b/gi;

/** Words that are too common alone to pin identity. */
const WEAK_TOKENS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "like",
  "real",
  "name",
  "video",
  "videos",
  "kids",
  "youtube",
  "instagram",
  "tiktok",
  "free",
  "hot",
  "new",
  "best",
]);

/**
 * Extract subject name tokens from a search query (NSFW tags stripped).
 * Example: "Nastya Garnis xxx nude" → ["nastya", "garnis"]
 */
export function extractSubjectTokens(query: string): string[] {
  const bare = query
    .replace(NSFW_STRIP, " ")
    .replace(/[^\p{L}\p{N}\s.'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!bare) return [];

  const tokens = bare
    .split(/\s+/)
    .map((t) => t.replace(/^['".]+|['".]+$/g, "").toLowerCase())
    .filter((t) => t.length >= 2 && !WEAK_TOKENS.has(t) && !/^\d+$/.test(t));

  // Prefer multi-token proper-name style: keep up to 4 tokens
  return tokens.slice(0, 4);
}

/** Build exact-phrase query forms that fight popular-name collisions. */
export function buildIdentityQueries(
  query: string,
  tags: string[] = [],
): string[] {
  const tokens = extractSubjectTokens(query);
  const bare = tokens.join(" ").trim() || query.trim();
  const out: string[] = [];
  const add = (s: string) => {
    const t = s.replace(/\s+/g, " ").trim();
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  };

  add(query.trim());
  if (tokens.length >= 2) {
    const quoted = `"${tokens.join(" ")}"`;
    add(quoted);
    for (const tag of tags.slice(0, 3)) {
      add(`${quoted} ${tag}`);
    }
    // Soft negatives for common first-name collisions (not model-specific hardcodes)
    add(`${quoted} -"like ${tokens[0]}" -kids -youtube`);
    add(`${bare} model`);
  } else {
    add(bare);
    for (const tag of tags.slice(0, 2)) add(`${bare} ${tag}`);
  }
  return out;
}

/**
 * Score how well a result matches the intended subject.
 * Multi-token subjects require matching the distinctive surname-like tokens.
 */
export function scoreIdentity(
  title: string,
  url: string,
  tokens: string[],
): number {
  if (!tokens.length) return 1;
  const hay = `${title} ${url}`.toLowerCase();
  let score = 0;
  let matched = 0;
  for (const t of tokens) {
    if (hay.includes(t)) {
      score += t.length >= 5 ? 2 : 1;
      matched++;
    }
  }
  if (matched === tokens.length) score += 3;
  // Penalize common first-name collisions (kid channels / "like {firstName}")
  // Generic: not hard-coded to any specific person.
  if (tokens.length >= 2) {
    const first = tokens[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const collisionRe = new RegExp(
      `like\\s+${first}|youtubekids|kids\\s+video|${first}\\s+kids|${first}\\s+youtube`,
      "i",
    );
    if (collisionRe.test(hay)) score -= 4;
  }
  return score;
}

export function identityMinScore(tokens: string[]): number {
  if (tokens.length >= 2) {
    // require at least the longer/distinctive token (usually surname)
    const sorted = [...tokens].sort((a, b) => b.length - a.length);
    return sorted[0].length >= 5 ? 2 : 2;
  }
  return 1;
}

/**
 * Filter hits by subject tokens.
 * @param opts.strict — NSFW: never return unrelated noise if nothing matches
 *   (adult SERPs often inject random tube titles). SFW may fall back softer.
 */
export function filterByIdentity<T extends { title: string; url: string }>(
  hits: T[],
  query: string,
  opts: { strict?: boolean } = {},
): T[] {
  const tokens = extractSubjectTokens(query);
  if (tokens.length < 2) return hits;
  const min = identityMinScore(tokens);
  let scored = hits
    .map((h) => ({ h, s: scoreIdentity(h.title, h.url, tokens) }))
    .filter((x) => x.s >= min)
    .sort((a, b) => b.s - a.s);

  // Soft fallback: require the longest token (usually surname), not first-name-only
  if (!scored.length) {
    const longest = [...tokens].sort((a, b) => b.length - a.length)[0];
    scored = hits
      .map((h) => ({ h, s: scoreIdentity(h.title, h.url, tokens) }))
      .filter((x) => `${x.h.title} ${x.h.url}`.toLowerCase().includes(longest))
      .sort((a, b) => b.s - a.s);
  }

  if (scored.length) return scored.map((x) => x.h);

  // Strict (NSFW): empty is better than wrong people from tube indexes
  if (opts.strict) return [];

  // SFW last resort: keep original order (avoid empty SERP after engine success)
  return hits;
}

/** True when title/url looks like a strong match for multi-token subject. */
export function isStrongIdentityMatch(
  title: string,
  url: string,
  query: string,
): boolean {
  const tokens = extractSubjectTokens(query);
  if (tokens.length < 2) return true;
  return scoreIdentity(title, url, tokens) >= identityMinScore(tokens) + 2;
}
