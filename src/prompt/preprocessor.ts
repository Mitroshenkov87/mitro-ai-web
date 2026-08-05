import { type ChatMessage, type PromptPreprocessorController } from "@lmstudio/sdk";
import { configSchematics } from "../config/schematics";
import {
  decideNsfw,
  NSFW_SYSTEM_PROMPT,
  SFW_SYSTEM_PROMPT,
} from "../nsfw/keywords";

const PROMPT_NORMAL = `
<mitro_ai_web mode="normal">
Search modes: sfw | auto | auto_unsafe | nsfw — one SearchPlan for web_search + image_search.
- sfw: strip NSFW dictionary; traditional engines
- auto: strong detect → SFW or NSFW
- auto_unsafe: looser detect (soft keywords) + SafeSearch Off
- nsfw: always NSFW pipeline; specialized indexes + traditional
Site scraping: visit/crawl only if "Allow site scraping" is ON.
Chrome DevTools: only if user enabled it (local Chrome --remote-debugging-port).
Routing: facts → web_search; photos → image_search; deep → osint_investigate.
</mitro_ai_web>
`.trim();

const PROMPT_OSINT = `
<mitro_ai_web mode="osint">
Deep research. Photos → image_search first. Person/org dossiers → osint_investigate once (hard budget).
Cross-check ≥2 sources. Search mode: sfw | auto | auto_unsafe | nsfw. Scraping follows settings.
</mitro_ai_web>
`.trim();

export async function promptPreprocessor(
  ctl: PromptPreprocessorController,
  userMessage: ChatMessage,
) {
  const config = ctl.getPluginConfig(configSchematics);
  const mode = String(config.get("researchMode") || "normal");
  const block = mode === "osint" ? PROMPT_OSINT : PROMPT_NORMAL;
  const hasGoogle = Boolean(String(config.get("googleApiKey") || "").trim());
  const googleNote = hasGoogle
    ? "<mitro_ai_web_meta>Google API key configured.</mitro_ai_web_meta>"
    : "<mitro_ai_web_meta>No Google API key — free engines only.</mitro_ai_web_meta>";

  const userText = userMessage.getText();
  const nsfwMode = String(config.get("nsfwMode") || "auto");
  const extra = String(config.get("nsfwExtraKeywords") || "");
  const nsfw = decideNsfw(userText, nsfwMode, undefined, extra);

  const nsfwBlock = nsfw.active
    ? `${NSFW_SYSTEM_PROMPT}\n<meta search_mode="${nsfw.searchMode}" setting="${nsfwMode}" reason="${nsfw.reason}" tags="${nsfw.searchTags.join(", ")}" matched="${nsfw.matched.join(", ")}" />`
    : `${SFW_SYSTEM_PROMPT}\n<meta search_mode="sfw" setting="${nsfwMode}" reason="${nsfw.reason}" />`;

  return `${block}\n${googleNote}\n${nsfwBlock}\n\n---\n\n${userText}`;
}
