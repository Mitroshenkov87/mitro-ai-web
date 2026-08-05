# Mitro AI-Web — Full Internet & NSFW Search

Full-internet research plugin for **LM Studio**: multi-engine web & image search, optional site scraping, crawl, OSINT.  
Search modes: **`sfw` | `auto` | `auto_unsafe` | `nsfw`**.

## Install

```bash
git clone https://github.com/Mitroshenkov87/mitro-ai-web.git
cd mitro-ai-web
npm install
npm run build
lms dev --install -y
```

In LM Studio enable **`mitro/mitro-ai-web`** and set tools permission to **Allow all**.

## Search modes (`sfw` | `auto` | `auto_unsafe` | `nsfw`)

One **SearchPlan** drives both `web_search` and `image_search` — no drift.

| Mode | Setting value | Behavior |
| --- | --- | --- |
| **sfw** | `sfw` | NSFW dictionary **stripped**. Traditional engines. SafeSearch = plugin setting. |
| **auto** | `auto` (default) | Strong dictionary match only → NSFW pipeline; else SFW. Soft words alone do **not** trigger. |
| **auto_unsafe** | `auto_unsafe` | Soft keywords **also** trigger NSFW. **SafeSearch Off** even when the query path is SFW. |
| **nsfw** | `nsfw` | Always NSFW pipeline: SafeSearch **Off**, dictionary tags, specialized NSFW indexes + traditional engines. |

## Site scraping & Chrome DevTools

| Setting | Default | Meaning |
| --- | --- | --- |
| **Allow site scraping** | ON | Enables `visit`, `crawl`, and page harvest inside image/OSINT pipelines. OFF = search-only. |
| **Chrome DevTools (user permission)** | **OFF** | When ON (and scraping is ON), if direct/Jina fail or the page is a JS shell, use **local Chrome** via remote debugging. |
| **Chrome debug port** | `9222` | Port Chrome listens on. |

To use Chrome DevTools, start Chrome yourself (user permission), for example:

```text
chrome.exe --remote-debugging-port=9222
```

Then enable **Chrome DevTools** in the plugin settings. The plugin never launches Chrome by itself.

### What each pipeline does

**SFW pipeline**

- Queries: no NSFW expansion tags
- Web: DDG + Bing + Yandex + Brave (+ Google if key; + Mojeek/SearX/… in OSINT)
- Images: Bing Images first, then DDG / page scrape / gallery hosts if thin

**NSFW pipeline**

- Queries: short subject + common NSFW tags as **separate** forms and one **OR** form (never AND-stack)
- Web: specialized NSFW indexes first, then DDG/Bing/Yandex (SafeSearch Off)
- Images: Bing → specialized hosts → SERP thumbs → gallery
- Identity-strict: drop unrelated SERP noise
- Full image files only (no `-thumb` sidecars)

### Overrides

- Tool arg `nsfw: true` → NSFW pipeline for that call  
- Tool arg `nsfw: false` → SFW pipeline for that call  
- Omit → follow plugin **Search mode**

Legacy setting values still work: `off` → `sfw`, `on` → `nsfw`.

## Tools

| Tool | What it does |
| --- | --- |
| `web_search` | Multi-engine search per mode (`sfw` / `auto` / `nsfw`). `engine=auto` or pick one. |
| `visit` | Open URL: text/links/images, Jina fallback |
| `crawl` | Follow links on a site |
| `image_search` | Find & save full photos (same mode plan as web_search) |
| `download_images` | Parallel download + quality probe |
| `fetch_raw` | Raw HTTP GET |
| `analyze_image` | Vision analysis of a local file |
| `osint_investigate` | Deep multi-pass OSINT |

## Settings

| Field | Meaning |
| --- | --- |
| **Research mode** | `normal` / **`osint`** |
| Results / delay / max text | Limits |
| Jina fallback | Recover from blocks |
| **Google API key** | Optional Google in auto search |
| Google CX / provider | Programmable Search / Serper / SerpAPI |
| **Safe search** | For traditional engines (default Off). Forced Off in NSFW pipeline. |
| **Search mode** | **`sfw`** / **`auto`** (default) / **`auto_unsafe`** / **`nsfw`** |
| **NSFW dictionary extras** | Extra words for auto-detect + expansion |
| **Allow site scraping** | visit / crawl / page harvest |
| **Chrome DevTools** | User permission for JS-heavy pages (default OFF) |
| **Chrome debug port** | Default 9222 |
| **Image min short side** | Default **240** px |

## Based on

- `duck-duck-go-reworked` — DDG web/images  
- `visit-website-reworked` — visit + Jina + extract  
- `analyze-images` — vision prepareImage  

Plus multi-engine search, crawl, Google API key support, OSINT orchestrator, unified SearchPlan.

## License

MIT
