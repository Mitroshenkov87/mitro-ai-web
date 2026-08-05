import { basename, dirname, extname, isAbsolute, join, normalize } from "path";
import { readdir, stat } from "fs/promises";
import type { ToolsProviderController } from "@lmstudio/sdk";

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
  ".tiff",
  ".tif",
  ".avif",
  ".heic",
  ".heif",
]);

function isImagePath(value: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(value).toLowerCase());
}

function sanitizeRelativeInput(input?: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed || isAbsolute(trimmed)) return null;
  const normalized = normalize(trimmed).replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (!normalized || normalized.startsWith("../") || normalized.includes("/../")) return null;
  return normalized;
}

async function preferFullImageIfThumb(
  absolutePath: string,
  relativePath: string,
): Promise<{ absolutePath: string; relativePath: string }> {
  const fileName = basename(relativePath);
  const thumbMatch = fileName.match(/^(.*)-thumb\.webp$/i);
  if (!thumbMatch) return { absolutePath, relativePath };

  const base = thumbMatch[1];
  const parentAbs = dirname(absolutePath);
  const parentRel = dirname(relativePath).replace(/\\/g, "/");
  for (const extension of [".png", ".jpg", ".jpeg", ".webp", ".gif"]) {
    const name = `${base}${extension}`;
    const cand = join(parentAbs, name);
    const st = await stat(cand).catch(() => null);
    if (st?.isFile()) {
      return {
        absolutePath: cand,
        relativePath: parentRel === "." ? name : `${parentRel}/${name}`,
      };
    }
  }
  return { absolutePath, relativePath };
}

async function resolveImage(
  workingDirectory: string,
  imageName: string,
): Promise<{ absolutePath: string; relativePath: string } | null> {
  const safe = sanitizeRelativeInput(imageName);
  if (!safe) return null;

  const direct = join(workingDirectory, safe);
  const st = await stat(direct).catch(() => null);
  if (st?.isFile() && isImagePath(safe)) {
    return preferFullImageIfThumb(direct, safe);
  }

  // recursive basename search (cap depth)
  const target = basename(safe).toLowerCase();
  const queue = [workingDirectory];
  let scanned = 0;
  while (queue.length && scanned < 500) {
    const dir = queue.shift()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      scanned++;
      const abs = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!ent.name.startsWith(".") && ent.name !== "node_modules") queue.push(abs);
        continue;
      }
      if (!ent.isFile() || !isImagePath(ent.name)) continue;
      if (ent.name.toLowerCase() === target) {
        const rel = normalize(abs.slice(workingDirectory.length + 1)).replace(/\\/g, "/");
        return preferFullImageIfThumb(abs, rel);
      }
    }
  }
  return null;
}

export async function analyzeLocalImage(
  ctl: ToolsProviderController,
  imageName: string,
  prompt: string,
  context: string,
): Promise<string> {
  const workingDirectory = ctl.getWorkingDirectory();
  const resolved = await resolveImage(workingDirectory, imageName);
  if (!resolved) return `Error: image not found: ${imageName}`;

  const model = await ctl.client.llm.model();
  if (!model.vision) {
    return "Error: loaded model does not support vision. Load a vision model and retry.";
  }

  const fileHandle = await ctl.client.files.prepareImage(resolved.absolutePath);
  const analysisPrompt =
    `You are a vision assistant. Analyze the provided image. Be concise. ` +
    `If uncertain, say so.\n\nKnown context:\n${context.trim()}\n\nUser request:\n${prompt.trim()}`;

  const result = await model.respond(
    [
      {
        role: "user",
        content: analysisPrompt,
        images: [fileHandle],
      },
    ],
    { maxTokens: 1024 },
  );

  return result.content;
}
