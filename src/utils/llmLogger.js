import fs from "fs";
import path from "path";

const DEFAULT_DIR = process.env.LLM_LOG_DIR || "llm-logs";
const ENABLED =
  (process.env.LLM_LOG_ENABLED || "true").toLowerCase() === "true";

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function logLLMEvent(event) {
  if (!ENABLED) return;
  try {
    const dir = path.resolve(process.cwd(), DEFAULT_DIR);
    ensureDir(dir);
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const base = [
      ts,
      event.label || "llm",
      event.prompt_hash || "noprompt",
    ].join("__");
    const file = path.join(dir, base + ".json");
    const toWrite = { ...event };
    if (toWrite.prompt && toWrite.prompt.length > 20000) {
      toWrite.prompt = toWrite.prompt.slice(0, 20000) + "...<truncated>";
    }
    if (toWrite.response_raw && toWrite.response_raw.length > 40000) {
      toWrite.response_raw =
        toWrite.response_raw.slice(0, 40000) + "...<truncated>";
    }
    fs.writeFileSync(file, JSON.stringify(toWrite, null, 2), "utf8");
  } catch (e) {
    // swallow
  }
}

export function hashPrompt(prompt) {
  let h = 0;
  if (!prompt) return "0";
  for (let i = 0; i < prompt.length; i++) {
    h = (h << 5) - h + prompt.charCodeAt(i);
    h |= 0;
  }
  return (h >>> 0).toString(36);
}
