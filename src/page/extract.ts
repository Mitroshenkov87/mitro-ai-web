export interface ExtractedPage {
  title: string;
  h1: string;
  description: string;
  links: Array<[string, string]>;
  images: Array<[string, string]>;
  content: string;
  jsonLd: unknown[];
}

function stripTags(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function extractPage(
  head: string,
  body: string,
  baseUrl: string,
  opts: {
    maxLinks: number;
    maxImages: number;
    contentLimit: number;
    findInPage?: string[];
  },
): ExtractedPage {
  const title = head.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || "";
  const h1 = body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    ? stripTags(body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)![1])
    : "";
  const description =
    head.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    )?.[1] ||
    head.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i,
    )?.[1] ||
    head.match(
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    )?.[1] ||
    "";

  const links = extractLinks(body, baseUrl, opts.maxLinks, opts.findInPage);
  const images = extractImages(body, baseUrl, opts.maxImages, opts.findInPage);

  const allContent = stripTags(body);
  let content = "";
  if (opts.findInPage?.length && opts.contentLimit < allContent.length) {
    const pad = Math.floor(opts.contentLimit / (opts.findInPage.length * 2));
    const padding = `.{0,${Math.max(40, pad)}}`;
    for (const term of opts.findInPage) {
      try {
        const re = new RegExp(padding + term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + padding, "i");
        const m = re.exec(allContent);
        if (m) content += (content ? " … " : "") + m[0];
      } catch {
        /* ignore bad term */
      }
    }
    if (!content) content = allContent.slice(0, opts.contentLimit);
  } else {
    content = allContent.slice(0, opts.contentLimit);
  }

  const jsonLd: unknown[] = [];
  const ldRe =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let lm: RegExpExecArray | null;
  while ((lm = ldRe.exec(head + body)) && jsonLd.length < 5) {
    try {
      jsonLd.push(JSON.parse(lm[1]));
    } catch {
      /* skip */
    }
  }

  return { title, h1, description, links, images, content, jsonLd };
}

function extractLinks(
  body: string,
  baseUrl: string,
  maxLinks: number,
  searchTerms?: string[],
): Array<[string, string]> {
  if (maxLinks <= 0) return [];
  const items: Array<{ label: string; link: string; score: number }> = [];
  const re = /<a\s+[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  let index = 0;
  while ((m = re.exec(body))) {
    let link = m[1];
    if (link.startsWith("/") || link.startsWith("./") || link.startsWith("../")) {
      try {
        link = new URL(link, baseUrl).href;
      } catch {
        continue;
      }
    }
    if (!link.startsWith("http")) continue;
    const label = stripTags(m[2]) || link;
    let score = label.length + (200 - Math.min(200, index));
    if (searchTerms?.length) {
      for (const t of searchTerms) {
        if (label.toLowerCase().includes(t.toLowerCase())) score += 1000;
      }
    }
    items.push({ label, link, score });
    index++;
  }
  items.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const out: Array<[string, string]> = [];
  for (const it of items) {
    if (seen.has(it.link)) continue;
    seen.add(it.link);
    out.push([it.label, it.link]);
    if (out.length >= maxLinks) break;
  }
  return out;
}

function extractImages(
  body: string,
  baseUrl: string,
  maxImages: number,
  searchTerms?: string[],
): Array<[string, string]> {
  if (maxImages <= 0) return [];
  const htmlMatches = [...body.matchAll(/<img(\s+[^>]*)/gi)]
    .filter((x) => x[1])
    .map(([, attributes], index) => {
      const alt = attributes.match(/\salt=["']([^"']*)["']/i)?.[1] || "";
      const src =
        attributes.match(/\sdata-full=["']([^"']+)["']/i)?.[1] ||
        attributes.match(/\sdata-original=["']([^"']+)["']/i)?.[1] ||
        attributes.match(/\sdata-src=["']([^"']+)["']/i)?.[1] ||
        attributes.match(/\sdata-lazy-src=["']([^"']+)["']/i)?.[1] ||
        attributes.match(/\ssrc=["']([^"']+)["']/i)?.[1] ||
        attributes.match(/\ssrcset=["']([^"']+)["']/i)?.[1]?.split(",")?.[0]?.trim()?.split(/\s+/)?.[0];
      return { index, alt, src };
    });
  const mdMatches = [...body.matchAll(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g)].map(
    (match, index) => ({
      index: index + htmlMatches.length,
      alt: match[1] || "",
      src: match[2],
    }),
  );

  const combined = [...htmlMatches, ...mdMatches]
    .map((x) => ({
      ...x,
      src: x.src?.startsWith("/") || x.src?.startsWith("./")
        ? (() => {
            try {
              return new URL(x.src!, baseUrl).href;
            } catch {
              return x.src;
            }
          })()
        : x.src,
    }))
    .filter((x) => x.src && x.src.startsWith("http"))
    .map((x) => ({
      ...x,
      score: searchTerms?.length
        ? searchTerms.reduce(
            (acc, term) =>
              acc + (x.alt.toLowerCase().includes(term.toLowerCase()) ? 1000 : 0),
            x.alt.length,
          )
        : x.alt.length,
    }))
    .sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const out: Array<[string, string]> = [];
  for (const it of combined) {
    if (!it.src || seen.has(it.src)) continue;
    seen.add(it.src);
    out.push([it.alt || "", it.src]);
    if (out.length >= maxImages) break;
  }
  return out;
}
