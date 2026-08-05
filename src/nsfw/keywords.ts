/**
 * Smart NSFW detection + bilingual query expansion.
 * Do not hardcode private person/model names in this file.
 */

/** Strong adult / leak / platform terms. */
export const NSFW_EXPLICIT: string[] = [
  "nude",
  "nudes",
  "naked",
  "nudity",
  "nsfw",
  "xxx",
  "porn",
  "porno",
  "pornography",
  "sex",
  "sexual",
  "sexy",
  "erotica",
  "erotic",
  "hentai",
  "onlyfans",
  "fansly",
  "patreon nsfw",
  "leak",
  "leaked",
  "leaks",
  "mega leak",
  "pack leak",
  "photo leak",
  "private leak",
  "pussy",
  "vagina",
  "penis",
  "cock",
  "dick",
  "boobs",
  "tits",
  "breasts",
  "nipple",
  "nipples",
  "ass",
  "butt",
  "anal",
  "blowjob",
  "handjob",
  "cumshot",
  "creampie",
  "masturbat",
  "masturbating",
  "masturbation",
  "orgasm",
  "bdsm",
  "fetish",
  "kink",
  "lesbian",
  "gay sex",
  "threesome",
  "hardcore",
  "softcore",
  "uncensored",
  "explicit",
  "adult video",
  "adult film",
  "camgirl",
  "striptease",
  "topless",
  "bottomless",
  "full frontal",
  "spread legs",
  "fingering",
  "squirting",
  "deepthroat",
  "oral sex",
  "intercourse",
  "copulation",
  "rule34",
  "r34",
  "gonewild",
  "nsfw gif",
  "sex tape",
  "hotwife",
  "milf",
  "teen nsfw",
  "18+",
  "pornstar",
  "adult model",
];

/** Studio / platform brands (generic, not private individuals). */
export const NSFW_STUDIO_BRANDS: string[] = [
  "metart",
  "met-art",
  "hegre",
  "hegre-art",
  "playboy",
  "penthouse",
  "playboyplus",
  "femjoy",
  "mplstudios",
  "mpl studios",
  "stasyq",
  "watch4beauty",
  "w4b",
  "eternaldesire",
  "goddessnudes",
  "alsangels",
  "als scan",
  "eroticbeauty",
  "errotica-archives",
  "thelifeerotic",
  "nubiles",
  "nubilefilms",
  "sexart",
  "vivthomas",
  "x-art",
  "xart",
  "digitaldesire",
  "ftvgirls",
  "ftv girls",
  "brazzers",
  "realitykings",
  "naughtyamerica",
  "pornhub",
  "xvideos",
  "xhamster",
  "redtube",
  "manyvids",
  "loyalfans",
  "justforfans",
  "supermodel",
  "glamour model",
  "glamour photography",
  "nude model",
  "nude photography",
  "artistic nude",
  "fine art nude",
  "boudoir",
  "lingerie model",
  "implied nude",
  "tasteful nude",
];

export const NSFW_SOFT: string[] = [
  "model",
  "models",
  "photoshoot",
  "photo shoot",
  "portfolio",
  "lookbook",
  "swimsuit",
  "bikini",
  "lingerie",
  "underwear",
  "see-through",
  "sheer",
  "wet look",
  "oil body",
  "body paint",
  "nude art",
  "nakedness",
  "disrobed",
  "undressed",
  "bare skin",
  "bare breasts",
  "sideboob",
  "underboob",
  "cleavage",
  "cosplay nsfw",
  "paid content",
  "exclusive photos",
];

/**
 * Plugin search mode:
 * - sfw         — never NSFW pipeline
 * - auto        — detect strong NSFW signals, else SFW
 * - auto_unsafe — looser detect (soft keywords too); SafeSearch Off even if SFW path
 * - nsfw        — always NSFW pipeline
 *
 * Legacy: off→sfw, on→nsfw.
 */
export type NsfwIntensity = "sfw" | "auto" | "auto_unsafe" | "nsfw";

/** Effective pipeline label after decideNsfw. */
export type NsfwSearchMode = "sfw" | "auto" | "auto_unsafe" | "nsfw";

/** Normalize setting / tool / legacy values */
export function normalizeNsfwMode(
  raw: string | undefined | null,
): NsfwIntensity {
  const v = String(raw || "auto")
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_");
  if (v === "sfw" || v === "off" || v === "false" || v === "0") return "sfw";
  if (v === "nsfw" || v === "on" || v === "force" || v === "true" || v === "1")
    return "nsfw";
  if (
    v === "auto_unsafe" ||
    v === "autounsafe" ||
    v === "unsafe" ||
    v === "auto_nsfw"
  ) {
    return "auto_unsafe";
  }
  return "auto";
}

export interface NsfwDecision {
  active: boolean;
  reason: string;
  matched: string[];
  intensity: "none" | "soft" | "studio" | "explicit";
  /** Effective search pipeline */
  searchMode: NsfwSearchMode;
  /** Tags the plugin will attach to engine queries (empty in SFW). */
  searchTags: string[];
  /**
   * Force SafeSearch Off even when pipeline is SFW
   * (used by auto_unsafe so traditional engines stay unfiltered).
   */
  forceSafeSearchOff?: boolean;
}

/**
 * Common NSFW expansion tags for engines (internal; order = priority).
 * Used in auto (when triggered) and nsfw modes; NOT dumped as AND-stack.
 */
export const COMMON_NSFW_SEARCH_TAGS: string[] = [
  "nude",
  "xxx",
  "sex",
  "nsfw",
  "porn",
  "pussy",
  "leak",
  "onlyfans",
  "naked",
  "topless",
  "uncensored",
];

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function findMatches(text: string, list: string[]): string[] {
  const t = normalize(text);
  const found: string[] = [];
  for (const kw of list) {
    const k = kw.toLowerCase();
    if (k.includes(" ")) {
      if (t.includes(k)) found.push(kw);
    } else if (k.length <= 3) {
      const re = new RegExp(
        `\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
        "i",
      );
      if (re.test(t)) found.push(kw);
    } else if (t.includes(k)) {
      found.push(kw);
    }
  }
  return found;
}

// ── Bilingual helpers (no personal names hard-coded) ────

const CYR_TO_LAT: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "kh",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

/** Approximate Latin → Cyrillic for dual-language search (lossy, generic). */
const LAT_MULTI: Array<[string, string]> = [
  ["sch", "щ"],
  ["sh", "ш"],
  ["ch", "ч"],
  ["zh", "ж"],
  ["kh", "х"],
  ["ts", "ц"],
  ["yu", "ю"],
  ["ya", "я"],
  ["yo", "ё"],
  ["ye", "е"],
];

const LAT_SINGLE: Record<string, string> = {
  a: "а",
  b: "б",
  c: "к",
  d: "д",
  e: "е",
  f: "ф",
  g: "г",
  h: "х",
  i: "и",
  j: "дж",
  k: "к",
  l: "л",
  m: "м",
  n: "н",
  o: "о",
  p: "п",
  q: "к",
  r: "р",
  s: "с",
  t: "т",
  u: "у",
  v: "в",
  w: "в",
  x: "кс",
  y: "й",
  z: "з",
};

export function hasCyrillic(s: string): boolean {
  return /[а-яё]/i.test(s);
}

export function hasLatinLetters(s: string): boolean {
  return /[a-z]/i.test(s);
}

export function cyrillicToLatin(input: string): string {
  let out = "";
  for (const ch of input) {
    const lower = ch.toLowerCase();
    if (CYR_TO_LAT[lower] !== undefined) {
      const lat = CYR_TO_LAT[lower];
      out += ch === lower ? lat : lat.charAt(0).toUpperCase() + lat.slice(1);
    } else {
      out += ch;
    }
  }
  return out;
}

export function latinToCyrillic(input: string): string {
  // Process word by word to avoid mangling URLs/keywords
  return input
    .split(/(\s+)/)
    .map((token) => {
      if (!/^[a-zA-Z.'-]+$/.test(token)) return token;
      // Keep known EN nsfw keywords in English
      if (NSFW_EXPLICIT.some((k) => k.toLowerCase() === token.toLowerCase())) {
        return token;
      }
      if (NSFW_STUDIO_BRANDS.some((k) => k.toLowerCase() === token.toLowerCase())) {
        return token;
      }
      let s = token.toLowerCase();
      let out = "";
      let i = 0;
      while (i < s.length) {
        let matched = false;
        for (const [lat, cyr] of LAT_MULTI) {
          if (s.startsWith(lat, i)) {
            out += cyr;
            i += lat.length;
            matched = true;
            break;
          }
        }
        if (matched) continue;
        const c = s[i];
        out += LAT_SINGLE[c] ?? c;
        i++;
      }
      // Preserve simple Title Case
      if (token[0] === token[0].toUpperCase() && out.length) {
        out = out.charAt(0).toUpperCase() + out.slice(1);
      }
      return out;
    })
    .join("");
}

/**
 * Produce original + counterpart language variants for search engines.
 * Prefer English-leaning queries for global indexes.
 */
export function bilingualQueryVariants(query: string): string[] {
  const q = query.trim();
  const out: string[] = [q];
  const add = (s: string) => {
    const t = s.trim();
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  };

  if (hasCyrillic(q)) {
    const lat = cyrillicToLatin(q);
    add(lat);
  } else if (hasLatinLetters(q)) {
    const cyr = latinToCyrillic(q);
    if (hasCyrillic(cyr)) add(cyr);
  }

  return out;
}

/** Map user-matched words to short engine tags (frequency order). */
function normalizeToSearchTags(matched: string[]): string[] {
  const map: Record<string, string> = {
    nudes: "nude",
    naked: "nude",
    nudity: "nude",
    porno: "porn",
    pornography: "porn",
    sexual: "sex",
    sexy: "sex",
    leaked: "leak",
    leaks: "leak",
    "patreon nsfw": "nsfw",
    "adult model": "nude",
    "adult video": "xxx",
    uncensored: "nude",
    topless: "topless",
    pussy: "pussy",
    onlyfans: "onlyfans",
    fansly: "onlyfans",
    metart: "nude",
    hegre: "nude",
    femjoy: "nude",
  };
  const out: string[] = [];
  for (const m of matched) {
    const low = m.toLowerCase();
    const tag = map[low] || (COMMON_NSFW_SEARCH_TAGS.includes(low) ? low : null);
    if (tag && !out.includes(tag)) out.push(tag);
    // also map known explicit words that are already short tags
    if (!tag) {
      for (const c of COMMON_NSFW_SEARCH_TAGS) {
        if (low.includes(c) && !out.includes(c)) out.push(c);
      }
    }
  }
  return out;
}

/**
 * Build ordered search tags for engines:
 * user-matched first, then most common (nude, xxx, sex, …).
 */
export function buildSearchTags(
  matched: string[],
  intensity: NsfwDecision["intensity"],
  forceFullDict: boolean,
): string[] {
  const fromUser = normalizeToSearchTags(matched);
  const base =
    intensity === "studio"
      ? ["nude", "xxx", "metart", "sex"]
      : intensity === "soft"
        ? ["nude", "xxx", "sex"]
        : [...COMMON_NSFW_SEARCH_TAGS];
  const out: string[] = [];
  for (const t of fromUser) if (!out.includes(t)) out.push(t);
  for (const t of base) if (!out.includes(t)) out.push(t);
  // Force: richer tag set for OR/separate expansion; auto: top frequent only
  return out.slice(0, forceFullDict ? 8 : 5);
}

export function decideNsfw(
  query: string,
  configMode: NsfwIntensity | string,
  toolNsfw?: boolean,
  extraKeywordsCsv?: string,
): NsfwDecision {
  const mode = normalizeNsfwMode(configMode);
  const empty = (
    partial: Partial<NsfwDecision> &
      Pick<NsfwDecision, "active" | "reason" | "searchMode">,
  ): NsfwDecision => ({
    matched: [],
    intensity: "none",
    searchTags: [],
    ...partial,
  });

  // Explicit tool nsfw=false → always SFW pipeline
  if (toolNsfw === false) {
    return empty({
      active: false,
      reason: "tool nsfw=false → mode sfw (strip NSFW dictionary from queries)",
      searchMode: "sfw",
    });
  }

  // Mode SFW: never NSFW pipeline; strip dictionary from queries
  if (mode === "sfw" && toolNsfw !== true) {
    return empty({
      active: false,
      reason: "mode=sfw: NSFW dictionary excluded from engine queries",
      searchMode: "sfw",
    });
  }

  const extra = (extraKeywordsCsv || "")
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const explicit = findMatches(query, NSFW_EXPLICIT);
  const studio = findMatches(query, [...NSFW_STUDIO_BRANDS, ...extra]);
  const soft = findMatches(query, NSFW_SOFT);
  const matched = [...explicit, ...studio, ...soft].slice(0, 12);

  let intensity: NsfwDecision["intensity"] = "none";
  if (explicit.length) intensity = "explicit";
  else if (studio.length) intensity = "studio";
  else if (soft.length) intensity = "soft";

  // Mode NSFW or tool nsfw=true: always NSFW pipeline + dictionary tags
  if (toolNsfw === true || mode === "nsfw") {
    let forcedIntensity: NsfwDecision["intensity"] = intensity;
    if (forcedIntensity === "none") forcedIntensity = "explicit";
    const searchTags = buildSearchTags(matched, forcedIntensity, true);
    return {
      active: true,
      reason:
        toolNsfw === true
          ? "tool nsfw=true → mode nsfw (dictionary on)"
          : "mode=nsfw: always NSFW pipeline + dictionary tags",
      matched,
      intensity: forcedIntensity,
      searchMode: "nsfw",
      searchTags,
    };
  }

  // Mode auto_unsafe: soft keywords also trigger NSFW; SafeSearch Off always
  if (mode === "auto_unsafe") {
    if (intensity === "explicit" || intensity === "studio" || intensity === "soft") {
      const searchTags = buildSearchTags(matched, intensity, false);
      return {
        active: true,
        reason: `mode=auto_unsafe: match (${intensity}) → NSFW pipeline (SafeSearch Off)`,
        matched: [...explicit, ...studio, ...soft].slice(0, 12),
        intensity,
        searchMode: "auto_unsafe",
        searchTags,
        forceSafeSearchOff: true,
      };
    }
    return empty({
      active: false,
      reason:
        "mode=auto_unsafe: no dictionary match → SFW queries, but SafeSearch Off",
      searchMode: "sfw",
      forceSafeSearchOff: true,
    });
  }

  // Mode Auto: strong signals only (explicit/studio). Soft alone does NOT trigger.
  if (intensity === "explicit" || intensity === "studio") {
    const searchTags = buildSearchTags(matched, intensity, false);
    return {
      active: true,
      reason: `mode=auto: dictionary match (${intensity}) → NSFW pipeline`,
      matched: [...explicit, ...studio, ...soft].slice(0, 12),
      intensity,
      searchMode: "auto",
      searchTags,
    };
  }

  // Auto, no strong match → SFW pipeline
  return empty({
    active: false,
    reason: soft.length
      ? "mode=auto: soft keywords only → SFW (no NSFW expansion)"
      : "mode=auto: no dictionary match → SFW",
    matched: soft.length ? soft.slice(0, 12) : [],
    searchMode: "sfw",
  });
}

/** Adult/meta tags we strip so we can re-attach via OR / separate variants. */
const NSFW_TAG_RE =
  /\b(xxx|nsfw|nude|nudes|naked|leak|leaked|leaks|onlyfans|fansly|porn|porno|sex|sexy|uncensored|explicit|metart|hegre|femjoy|pussy|tits|boobs|ass|gallery|photoshoot|model)\b/gi;

/**
 * Strip known NSFW tags so we can re-attach them correctly
 * (separate queries OR expand with OR — never space-stack as AND).
 */
function stripKnownNsfwTags(query: string): string {
  let q = query.trim();
  q = q.replace(NSFW_TAG_RE, " ").replace(/\s+/g, " ").trim();
  return q || query.trim();
}

function countNsfwTags(query: string): number {
  return [...query.matchAll(NSFW_TAG_RE)].length;
}

function subjectForms(base: string): {
  bare: string;
  quoted: string;
  andForm: string;
  words: string[];
} {
  const words = base.split(/\s+/).filter(Boolean);
  const bare = words.join(" ");
  return {
    words,
    bare,
    quoted: words.length >= 2 ? `"${bare}"` : bare,
    // AND tightens identity (name parts), not adult tags
    andForm: words.length >= 2 ? words.join(" AND ") : bare,
  };
}

/** Expand recall: subject (nude OR xxx OR pussy) — never "nude xxx pussy" (AND-narrows). */
function withOrTags(subject: string, tags: string[]): string {
  const uniq = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
  if (!uniq.length) return subject;
  if (uniq.length === 1) return `${subject} ${uniq[0]}`;
  return `${subject} (${uniq.join(" OR ")})`;
}

function bilingualBases(query: string): string[] {
  const raw = bilingualQueryVariants(stripKnownNsfwTags(query)).map(stripKnownNsfwTags);
  raw.sort((a, b) => {
    const aLat = hasLatinLetters(a) && !hasCyrillic(a) ? 0 : 1;
    const bLat = hasLatinLetters(b) && !hasCyrillic(b) ? 0 : 1;
    return aLat - bLat;
  });
  return raw.filter(Boolean);
}

/**
 * SFW engine queries: strip entire NSFW dictionary from the string
 * before sending to search engines (mode = SFW or auto without match).
 */
export function expandSfwQueries(
  query: string,
  opts: { forImages?: boolean } = {},
): string[] {
  const clean = stripKnownNsfwTags(query.trim());
  const bases = bilingualBases(clean);
  const out: string[] = [];
  const add = (s: string) => {
    const t = stripKnownNsfwTags(s.replace(/\s+/g, " ").trim());
    if (!t) return;
    if (out.some((x) => x.toLowerCase() === t.toLowerCase())) return;
    out.push(t);
  };

  for (const base of bases.slice(0, 2)) {
    const f = subjectForms(base);
    if (!f.bare) continue;
    add(f.bare);
    if (f.words.length >= 2) add(f.quoted);
    if (opts.forImages) {
      if (!/\b(photo|photos|portrait|image|pic|pics)\b/i.test(f.bare)) {
        add(`${f.bare} photo`);
      }
      if (!/\bportrait\b/i.test(f.bare)) add(`${f.bare} portrait`);
    }
  }
  if (!out.length && clean) add(clean);
  return out.slice(0, 3);
}

/**
 * Web NSFW variants using decision.searchTags (dictionary sent to engines).
 * Separate single-tag + OR widen — never multi-tag AND stacks.
 */
export function expandNsfwQueries(
  query: string,
  intensityOrDecision: NsfwDecision["intensity"] | NsfwDecision,
  searchTags?: string[],
): string[] {
  const decision =
    typeof intensityOrDecision === "object" ? intensityOrDecision : null;
  const intensity = decision
    ? decision.intensity
    : (intensityOrDecision as NsfwDecision["intensity"]);
  const tags =
    (decision?.searchTags?.length
      ? decision.searchTags
      : searchTags?.length
        ? searchTags
        : buildSearchTags([], intensity === "none" ? "explicit" : intensity, true)
    ).slice(0, 5);

  const original = query.trim();
  const bases = bilingualBases(original);

  const out: string[] = [];
  const add = (s: string) => {
    const t = s.replace(/\s+/g, " ").trim();
    if (!t) return;
    if (countNsfwTags(t) >= 2 && !/\bOR\b/i.test(t)) return;
    if (out.some((x) => x.toLowerCase() === t.toLowerCase())) return;
    out.push(t);
  };

  // One short user form if already sparse
  if (countNsfwTags(original) === 1 && original.split(/\s+/).length <= 5) {
    add(original);
  }

  for (const base of bases.slice(0, 2)) {
    const f = subjectForms(base);
    if (!f.bare) continue;

    // A) separate: subject + ONE dictionary tag (nude, then xxx, then sex, …)
    for (const tag of tags.slice(0, 3)) {
      add(`${f.bare} ${tag}`);
      if (f.quoted !== f.bare) add(`${f.quoted} ${tag}`);
    }

    // B) OR widen with top frequency tags
    const or3 = tags.slice(0, 3);
    add(withOrTags(f.bare, or3));
    add(withOrTags(f.quoted, or3));

    // C) AND name parts + OR tags
    if (f.words.length >= 2) add(withOrTags(f.andForm, or3));

    add(f.bare);
  }

  return out.slice(0, 10);
}

/**
 * Image NSFW: short fan-out with dictionary tags (nude/xxx/sex first).
 */
export function expandNsfwImageQueries(
  query: string,
  decisionOrTags?: NsfwDecision | string[],
): string[] {
  const original = query.trim();
  let tags: string[];
  if (Array.isArray(decisionOrTags)) {
    tags = decisionOrTags.slice(0, 4);
  } else if (decisionOrTags && typeof decisionOrTags === "object") {
    tags = (decisionOrTags.searchTags?.length
      ? decisionOrTags.searchTags
      : buildSearchTags(decisionOrTags.matched, decisionOrTags.intensity, false)
    ).slice(0, 4);
  } else {
    tags = buildSearchTags(
      normalizeToSearchTags(
        [...original.matchAll(NSFW_TAG_RE)].map((m) => m[1]),
      ),
      "explicit",
      false,
    ).slice(0, 4);
  }
  if (!tags.length) tags = COMMON_NSFW_SEARCH_TAGS.slice(0, 4);

  const bases = bilingualBases(original);
  const out: string[] = [];
  const add = (s: string) => {
    const t = s.replace(/\s+/g, " ").trim();
    if (!t) return;
    if (countNsfwTags(t) >= 2 && !/\bOR\b/i.test(t)) return;
    if (t.length > 90) return;
    if (out.some((x) => x.toLowerCase() === t.toLowerCase())) return;
    out.push(t);
  };

  if (countNsfwTags(original) === 1 && original.split(/\s+/).length <= 5) {
    add(original);
  }

  for (const base of bases.slice(0, 2)) {
    const f = subjectForms(base);
    if (!f.bare || f.words.length > 5) continue;

    add(withOrTags(f.bare, tags.slice(0, 3)));
    for (const tag of tags.slice(0, 2)) add(`${f.bare} ${tag}`);
    if (f.words.length >= 2) add(withOrTags(f.andForm, tags.slice(0, 3)));
    add(f.bare);
  }

  return out.slice(0, 4);
}

export const SFW_SYSTEM_PROMPT = `
<mitro_ai_web_mode active="false" mode="sfw">
Mode SFW path: NSFW dictionary stripped from engine queries. No NSFW expansion tags.
SafeSearch follows plugin setting (auto_unsafe still forces SafeSearch Off).
For full NSFW pipeline switch setting to auto / auto_unsafe / nsfw or pass nsfw=true.
</mitro_ai_web_mode>
`.trim();

export const NSFW_SYSTEM_PROMPT = `
<mitro_ai_web_mode active="true">
NSFW pipeline is ACTIVE (mode nsfw, or auto / auto_unsafe after dictionary match).

Search modes (plugin setting):
- sfw         — never NSFW pipeline; strip dictionary
- auto        — strong match only → NSFW, else SFW
- auto_unsafe — soft keywords also match; SafeSearch Off always
- nsfw        — always NSFW pipeline + dictionary tags; SafeSearch Off

Query expansion (plugin builds this — model passes short subject):
- Attach NSFW tags as SEPARATE queries and one OR form (never AND-stack)
- Unified SearchPlan for web_search + image_search
- Specialized NSFW indexes + traditional engines
- Images: Bing → specialized hosts → SERP → gallery; full files only
- Refuse any content involving minors.
</mitro_ai_web_mode>
`.trim();

