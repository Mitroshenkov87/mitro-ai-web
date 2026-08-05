import { readFileSync, writeFileSync } from "fs";

const path =
  process.argv[2] ||
  `${process.env.USERPROFILE}\\Downloads\\1785955760346.conversation.json`;
const j = JSON.parse(readFileSync(path, "utf8"));

console.log("name:", j.name);
console.log("messages:", j.messages?.length);
console.log("plugins:", j.plugins);
console.log("model:", j.lastUsedModel?.identifier);

function walk(versions) {
  const out = [];
  for (const v of versions || []) {
    if (v?.role) out.push(v);
    // LMS sometimes nests
    if (Array.isArray(v?.steps)) {
      for (const s of v.steps) out.push({ ...s, _step: true });
    }
  }
  return out;
}

let msgIdx = 0;
for (const msg of j.messages || []) {
  msgIdx++;
  const versions = msg.versions || [];
  const sel = versions[msg.currentlySelected ?? 0] || versions[0];
  if (!sel) continue;

  // role + text
  const role = sel.role || sel.type || "?";
  const text =
    sel.content
      ?.map?.((c) => (typeof c === "string" ? c : c?.text || c?.content || ""))
      .join("\n") ||
    sel.text ||
    "";
  const short = String(text).replace(/\s+/g, " ").slice(0, 200);
  if (short && (role === "user" || role === "system" || /mitro_ai_web/i.test(short))) {
    console.log(`\n=== msg#${msgIdx} role=${role} ===`);
    console.log(short);
  }

  // tool calls in steps
  const steps = sel.steps || sel.toolCalls || [];
  for (const step of steps) {
    const tools = step.toolCalls || step.tool_calls || [];
    // also single tool
    const list = tools.length
      ? tools
      : step.name
        ? [step]
        : step.type === "toolCall"
          ? [step]
          : [];
    for (const t of list) {
      const name = t.name || t.toolName || t.function?.name;
      const args = t.arguments || t.args || t.function?.arguments || t.params;
      let argsObj = args;
      if (typeof args === "string") {
        try {
          argsObj = JSON.parse(args);
        } catch {
          /* keep */
        }
      }
      const result =
        t.result ||
        t.output ||
        t.content ||
        step.result ||
        step.toolResult;
      let resObj = result;
      if (typeof result === "string") {
        try {
          resObj = JSON.parse(result);
        } catch {
          /* keep string */
        }
      }
      if (!name && !resObj) continue;
      if (name) {
        console.log(
          `\n-- TOOL ${name} --`,
          typeof argsObj === "object"
            ? JSON.stringify(argsObj).slice(0, 180)
            : String(argsObj || "").slice(0, 120),
        );
      }
      if (resObj && typeof resObj === "object") {
        const summary = {
          enginesUsed: resObj.enginesUsed,
          enginesFailed: resObj.enginesFailed?.map((e) =>
            typeof e === "string" ? e : `${e.engine}:${e.error?.slice?.(0, 40)}`,
          ),
          count: resObj.count,
          filesSaved: resObj.filesSaved,
          candidatesFound: resObj.candidatesFound,
          source: resObj.source,
          queriesRun: resObj.queriesRun,
          nsfw: resObj.nsfw
            ? {
                active: resObj.nsfw.active,
                searchMode: resObj.nsfw.searchMode,
                reason: resObj.nsfw.reason?.slice?.(0, 80),
                tags: resObj.nsfw.searchTags,
              }
            : undefined,
          error: resObj.error,
          rejectedSample: resObj.rejected?.[0],
          localFiles: resObj.localFiles?.slice?.(0, 2),
        };
        console.log(JSON.stringify(summary, null, 0).slice(0, 600));
      } else if (typeof resObj === "string" && resObj.length > 20) {
        // try find json inside
        const m = resObj.match(/\{[\s\S]{20,2000}\}/);
        if (m) {
          try {
            const o = JSON.parse(m[0]);
            console.log(
              "result snippet",
              JSON.stringify({
                filesSaved: o.filesSaved,
                source: o.source,
                candidatesFound: o.candidatesFound,
                enginesUsed: o.enginesUsed,
                nsfw: o.nsfw?.active,
              }),
            );
          } catch {
            console.log("result str", resObj.slice(0, 200));
          }
        }
      }
    }
  }
}

// Dump raw structure of first few messages for debugging format
const sample = {
  keys: Object.keys(j.messages?.[0] || {}),
  v0keys: Object.keys(j.messages?.[0]?.versions?.[0] || {}),
  v0sample: JSON.stringify(j.messages?.[0]?.versions?.[0] || {}).slice(0, 1500),
};
writeFileSync("scripts/_conv_sample.json", JSON.stringify(sample, null, 2));
console.log("\n(wrote scripts/_conv_sample.json structure sample)");
