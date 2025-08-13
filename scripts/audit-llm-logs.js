#!/usr/bin/env node
/**
 * Audit LLM logs to ensure no narrative or enhancement prompts were sent
 * without full text when REQUIRE_FULLTEXT policy is in effect.
 *
 * Rules enforced:
 * 1. Every narrative enhancement prompt ("You are an assistant turning a news article")
 *    MUST contain the marker "FullText:" and MUST NOT contain "Snippet:".
 * 2. (Optional) If any generation log contains both markers (sanity), flag it.
 * 3. Report counts: total generation, narrative, categorization, skip events, skip rate.
 * 4. Exit code 1 if violations found.
 */
import fs from "fs";
import path from "path";

const LOG_DIR = path.resolve(process.cwd(), "llm-logs");

function loadFiles() {
  if (!fs.existsSync(LOG_DIR)) {
    console.error("Log directory not found:", LOG_DIR);
    process.exit(0); // nothing to audit
  }
  return fs.readdirSync(LOG_DIR).filter((f) => f.endsWith(".json"));
}

function audit() {
  const files = loadFiles();
  let generationFiles = [];
  let skipFiles = [];
  let violations = [];
  let narrative = 0;
  let narrativeFull = 0;
  let narrativeSnippet = 0;
  let category = 0;

  for (const file of files) {
    const fullPath = path.join(LOG_DIR, file);
    let data;
    try {
      const raw = fs.readFileSync(fullPath, "utf-8");
      data = JSON.parse(raw);
    } catch (e) {
      violations.push({ file, reason: "invalid_json", detail: e.message });
      continue;
    }
    if (data.label === "fulltext_skip") {
      skipFiles.push(file);
      continue;
    }
    if (data.label === "generation") {
      generationFiles.push(file);
      const prompt = data.prompt || "";
      const isNarrative = prompt.includes(
        "You are an assistant turning a news article"
      );
      const isCategory = prompt.includes("Categorize this news article");
      if (isNarrative) {
        narrative++;
        const hasFull = prompt.includes("FullText:");
        const hasSnippet = prompt.includes("Snippet:");
        if (hasFull) narrativeFull++;
        else violations.push({ file, reason: "narrative_missing_fulltext" });
        if (hasSnippet) {
          narrativeSnippet++;
          violations.push({ file, reason: "narrative_used_snippet" });
        }
        if (hasFull && prompt.includes("Snippet:"))
          violations.push({ file, reason: "narrative_contains_both_markers" });
      } else if (isCategory) {
        category++;
        // Not enforced to have full text; currently snippet-based is expected.
      }
    }
  }

  const totalGen = generationFiles.length;
  const skipCount = skipFiles.length;
  const skipRate =
    totalGen + skipCount > 0 ? (skipCount / (totalGen + skipCount)) * 100 : 0;

  const summary = {
    total_generation: totalGen,
    narrative_generation: narrative,
    narrative_with_fulltext: narrativeFull,
    narrative_with_snippet_marker: narrativeSnippet,
    categorization_generation: category,
    fulltext_skip_events: skipCount,
    skip_rate_percent: +skipRate.toFixed(2),
    violations: violations.length,
  };

  console.log("LLM LOG AUDIT SUMMARY");
  console.log(JSON.stringify(summary, null, 2));

  if (violations.length) {
    console.log("\nViolations detail (first 20):");
    violations.slice(0, 20).forEach((v) => console.log(v));
    process.exitCode = 1;
  }
}

audit();
