/** Lightweight harvest of interesting tokens from page text for OSINT expansion. */

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Capitalized multi-word phrases (very rough)
const ENTITY_RE = /\b([A-ZА-ЯЁ][\wА-Яа-яЁё.'-]{2,}(?:\s+[A-ZА-ЯЁ][\wА-Яа-яЁё.'-]{2,}){0,3})\b/g;

export interface Harvest {
  urls: string[];
  emails: string[];
  entities: string[];
}

export function harvestFromText(text: string, limit = 20): Harvest {
  const urls = [...new Set(text.match(URL_RE) || [])].slice(0, limit);
  const emails = [...new Set(text.match(EMAIL_RE) || [])].slice(0, 10);
  const entitiesRaw = text.match(ENTITY_RE) || [];
  const stop = new Set([
    "The",
    "This",
    "That",
    "With",
    "From",
    "http",
    "https",
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ]);
  const entities = [
    ...new Set(
      entitiesRaw
        .map((e) => e.trim())
        .filter((e) => e.length >= 4 && e.length <= 60 && !stop.has(e.split(" ")[0])),
    ),
  ].slice(0, limit);

  return { urls, emails, entities };
}
