import {
  supabase,
  selectRecords,
  insertRecord,
  updateRecord,
} from "../config/database.js";
import { createContextLogger } from "../config/logger.js";
import { normalizeBcp47 } from "../utils/lang.js";
import { translateFields } from "./translationHelper.js";
import crypto from "node:crypto";

const logger = createContextLogger("Pretranslator");

// Lightweight process-level idempotency guard to avoid duplicate work within a single run
// Idempotency key format (per plan): `${clusterId}|${targetLang}|${pivotHash}`
const _doneKeys = new Map(); // key -> ts
const DONE_MAX = 10_000; // cap entries
function markDone(key) {
  if (_doneKeys.size >= DONE_MAX) {
    // drop oldest inserted
    const first = _doneKeys.keys().next().value;
    if (first) _doneKeys.delete(first);
  }
  _doneKeys.set(key, Date.now());
}
function isDone(key) {
  return _doneKeys.has(key);
}

// In-memory, lightweight queue of jobs (durable queue deferred as per plan)
// Each job carries only minimal payload per spec: cluster_id, target_lang, pivot_hash
const _jobQueue = [];
const _jobKeys = new Set(); // for enqueue-time idempotency

function enqueueJob(job) {
  const key = `${job.cluster_id}|${job.target_lang}|${job.pivot_hash}`;
  if (_jobKeys.has(key) || isDone(key)) return false; // skip duplicates within run
  _jobKeys.add(key);
  _jobQueue.push(job);
  return true;
}

function dequeueJob() {
  return _jobQueue.shift();
}

async function withRetry(fn, attempts = 2, backoffMs = 200) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, backoffMs * Math.pow(2, i)));
      }
    }
  }
  throw lastErr;
}

export async function runPretranslationCycle(options = {}) {
  const {
    recentHours = parseInt(process.env.PRETRANS_RECENT_HOURS || "24", 10),
    maxClusters = parseInt(process.env.PRETRANS_MAX_CLUSTERS || "200", 10),
    concurrency = parseInt(process.env.PRETRANS_CONCURRENCY || "4", 10),
    // Default timeout was 2000ms which is often too tight for 3 parallel MT calls; bump to 8000ms
    perItemTimeoutMs = parseInt(
      process.env.PRETRANS_ITEM_TIMEOUT_MS || "8000",
      10
    ),
  } = options;

  try {
    const marketFilter = (process.env.MARKET || "").trim();
    const markets = await loadMarkets(marketFilter);
    if (!markets.length) {
      logger.info("No enabled app_markets found; skipping pretranslation");
      return { clustersChecked: 0, translationsInserted: 0, skippedFresh: 0 };
    }
    const globalTargets = computeGlobalPretranslate(markets);
    const pivotDefault = pickPivot(markets);

    // Fetch candidate clusters (robust to schemas where updated_at isn't maintained)
    let list = [];
    try {
      // Prefer last_seen when available
      const { data: clusters1, error: e1 } = await supabase
        .from("clusters")
        .select("id, last_seen")
        .order("last_seen", { ascending: false })
        .limit(maxClusters);
      if (e1) throw e1;
      list = clusters1 || [];
    } catch (_) {
      try {
        // Fallback: order by updated_at desc if present
        const { data: clusters2, error: e2 } = await supabase
          .from("clusters")
          .select("id, updated_at")
          .order("updated_at", { ascending: false })
          .limit(maxClusters);
        if (e2) throw e2;
        list = clusters2 || [];
      } catch (_) {
        // Final fallback: order by id desc (recency proxy)
        const { data: clusters3 } = await supabase
          .from("clusters")
          .select("id")
          .order("id", { ascending: false })
          .limit(maxClusters);
        list = clusters3 || [];
      }
    }
    logger.info("Pretranslation scan", {
      markets: markets.map((m) => m.market_code || m.id),
      pivotDefault,
      targetCount: globalTargets.size,
      recentHours,
      candidates: list.length,
    });

    let translationsInserted = 0;
    let skippedFresh = 0;
    let clustersChecked = 0;
    let jobsCreated = 0;

    // Simple concurrency pool
    const queue = [...list];
    const workers = Array.from(
      { length: Math.max(1, Math.min(concurrency, 16)) },
      () =>
        (async () => {
          while (queue.length) {
            const c = queue.shift();
            if (!c) break;
            clustersChecked++;
            try {
              const { enqueued, skipped } = await collectJobsForCluster(
                c.id,
                globalTargets,
                pivotDefault
              );
              jobsCreated += enqueued;
              skippedFresh += skipped;
            } catch (e) {
              logger.warn("Collect jobs failed", {
                clusterId: c.id,
                error: e.message,
              });
            }
          }
        })()
    );
    await Promise.all(workers);

    // Now process the queued jobs with bounded concurrency
    const { inserted: insertedFromJobs } = await processJobQueue(
      Math.max(1, Math.min(concurrency, 16)),
      perItemTimeoutMs
    );
    translationsInserted += insertedFromJobs;

    logger.info("Pretranslation done", {
      clustersChecked,
      jobsCreated,
      translationsInserted,
      skippedFresh,
    });
    return { clustersChecked, jobsCreated, translationsInserted, skippedFresh };
  } catch (error) {
    logger.error("Pretranslation cycle error", { error: error.message });
    return {
      clustersChecked: 0,
      translationsInserted: 0,
      skippedFresh: 0,
      error: error.message,
    };
  }
}

async function loadMarkets(marketCode) {
  try {
    // Be resilient to schema differences: select all and filter in JS
    const { data, error } = await supabase.from("app_markets").select("*");
    if (error) throw error;
    let rows = data || [];
    if (marketCode)
      rows = rows.filter(
        (r) =>
          String(r.market_code || r.code || r.id || "").trim() === marketCode
      );
    // enabled default true if field missing
    rows = rows.filter((r) => r.enabled !== false);
    return rows;
  } catch (e) {
    logger.warn("Failed to load app_markets", { error: e.message });
    return [];
  }
}

function parseLangList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw))
    return raw.map((s) => normalizeBcp47(s)).filter(Boolean);
  // Handle Postgres text[] returned as string with braces: {de,fr}
  return String(raw)
    .replace(/[{}]/g, "")
    .split(/[\s,]+/)
    .map((s) => normalizeBcp47(s))
    .filter(Boolean);
}

function computeGlobalPretranslate(markets) {
  const set = new Set();
  for (const m of markets) {
    const langs = parseLangList(m.pretranslate_langs || m.show_langs || "");
    langs.forEach((l) => set.add(l));
  }
  return set;
}

function pickPivot(markets) {
  // If MARKET specified, prefer its pivot; else take the first enabled's pivot; fallback to en
  for (const m of markets) {
    const p = normalizeBcp47(m.pivot_lang || "");
    if (p) return p;
  }
  return "en";
}

async function collectJobsForCluster(clusterId, globalTargets, pivotDefault) {
  // Pick pivot: prefer market pivot if a current AI exists in it; else any current; else skip
  const { data: currents, error } = await supabase
    .from("cluster_ai")
    .select(
      "id, lang, ai_title, ai_summary, ai_details, is_current, created_at, pivot_hash, model"
    )
    .eq("cluster_id", clusterId)
    .eq("is_current", true);
  if (error) throw error;
  const rows = currents || [];
  if (!rows.length) return { enqueued: 0, skipped: 0 }; // pivot not ready yet

  const norm = (l) => (l || "").split("-")[0].toLowerCase();
  const pivotRow =
    rows.find((r) => normalizeBcp47(r.lang) === normalizeBcp47(pivotDefault)) ||
    rows[0];
  const pivotLang = normalizeBcp47(pivotRow.lang);
  const pivotSig = crypto
    .createHash("sha1")
    .update(
      `${pivotRow.ai_title || ""}\n${pivotRow.ai_summary || ""}\n${
        pivotRow.ai_details || ""
      }`
    )
    .digest("hex")
    .slice(0, 10);

  // Build target set minus pivot and minus already fresh langs.
  // Freshness priority:
  //  1) pivot_hash matches current pivotSig OR model tag contains #ph=<pivotSig>
  //  2) fallback: created_at >= pivot created_at (legacy when no pivot_hash)
  const pivotCreated = Date.parse(pivotRow.created_at || 0) || 0;
  const freshBySig = new Set(
    rows
      .filter(
        (r) =>
          (r.pivot_hash && r.pivot_hash === pivotSig) ||
          (r.model || "").includes(`#ph=${pivotSig}`)
      )
      .map((r) => normalizeBcp47(r.lang))
  );
  const freshByTime = new Set(
    rows
      .filter((r) => (Date.parse(r.created_at || 0) || 0) >= pivotCreated)
      .map((r) => normalizeBcp47(r.lang))
  );
  const haveFresh = (lang) => freshBySig.has(lang) || freshByTime.has(lang);
  const targets = [...globalTargets]
    .map((l) => normalizeBcp47(l))
    .filter((l) => l && norm(l) !== norm(pivotLang) && !haveFresh(l));
  if (!targets.length) return { enqueued: 0, skipped: 1 };

  let enqueued = 0;
  for (const dst of targets) {
    const ok = enqueueJob({
      cluster_id: clusterId,
      target_lang: dst,
      pivot_hash: pivotSig,
    });
    if (ok) enqueued++;
  }
  return { enqueued, skipped: enqueued ? 0 : 1 };
}

async function processJob(job, perItemTimeoutMs) {
  const idempotencyKey = `${job.cluster_id}|${job.target_lang}|${job.pivot_hash}`;
  if (isDone(idempotencyKey)) return { inserted: 0, skipped: 1 };

  // Fetch latest current rows to find the pivot row matching this pivot_hash
  const { data: rows, error } = await supabase
    .from("cluster_ai")
    .select(
      "id, lang, ai_title, ai_summary, ai_details, is_current, created_at, pivot_hash, model"
    )
    .eq("cluster_id", job.cluster_id)
    .eq("is_current", true);
  if (error) throw error;
  const currents = rows || [];
  // Try to locate pivot row by stored pivot_hash/model tag; if absent (legacy rows), recompute signatures
  let pivotRow = currents.find(
    (r) =>
      r.pivot_hash === job.pivot_hash ||
      (r.model || "").includes(`#ph=${job.pivot_hash}`)
  );
  if (!pivotRow) {
    for (const r of currents) {
      const sig = crypto
        .createHash("sha1")
        .update(
          `${r.ai_title || ""}\n${r.ai_summary || ""}\n${r.ai_details || ""}`
        )
        .digest("hex")
        .slice(0, 10);
      if (sig === job.pivot_hash) {
        pivotRow = r;
        break;
      }
    }
  }
  if (!pivotRow) {
    // Pivot changed or missing; skip per plan (a new job will be created next loop)
    markDone(idempotencyKey);
    return { inserted: 0, skipped: 1 };
  }
  // Recompute signature and ensure it matches
  const latestSig = crypto
    .createHash("sha1")
    .update(
      `${pivotRow.ai_title || ""}\n${pivotRow.ai_summary || ""}\n${
        pivotRow.ai_details || ""
      }`
    )
    .digest("hex")
    .slice(0, 10);
  if (latestSig !== job.pivot_hash) {
    markDone(idempotencyKey);
    return { inserted: 0, skipped: 1 };
  }

  const pivotLang = normalizeBcp47(pivotRow.lang);
  const dst = normalizeBcp47(job.target_lang);

  // Short-circuit if we already have a current row for dst with same pivot sig
  try {
    const { data: existing } = await supabase
      .from("cluster_ai")
      .select("id,pivot_hash,model")
      .eq("cluster_id", job.cluster_id)
      .eq("lang", dst)
      .eq("is_current", true);
    if (
      (existing || []).some(
        (r) =>
          r.pivot_hash === job.pivot_hash ||
          (r.model || "").includes(`#ph=${job.pivot_hash}`)
      )
    ) {
      markDone(idempotencyKey);
      return { inserted: 0, skipped: 1 };
    }
  } catch (_) {}

  const to = (p, ms) =>
    Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
    ]);

  try {
    const { title: cTitle, summary: cSummary, details: cDetails } = await to(
      withRetry(
        () =>
          translateFields(
            {
              title: pivotRow.ai_title || "",
              summary: pivotRow.ai_summary || "",
              details: pivotRow.ai_details || pivotRow.ai_summary || "",
            },
            { srcLang: pivotLang, dstLang: dst }
          ),
        2,
        200
      ),
      perItemTimeoutMs
    );

    const clean = (v) => (v || "").trim();
    // Guard: if nothing actually translated, skip insert to avoid creating fake target rows with pivot text
    if (!clean(cTitle) && !clean(cSummary) && !clean(cDetails)) {
      logger.debug("Skip insert: no translations produced", {
        clusterId: job.cluster_id,
        dst,
      });
      markDone(idempotencyKey);
      return { inserted: 0, skipped: 1 };
    }
    const ai_title = clean(cTitle) || clean(pivotRow.ai_title);
    const ai_summary = clean(cSummary) || clean(pivotRow.ai_summary);
    const ai_details =
      clean(cDetails) || clean(pivotRow.ai_details) || clean(pivotRow.ai_summary);

    // Flip previous current for this lang, then insert new current
    try {
      const { data: existing } = await supabase
        .from("cluster_ai")
        .select("id")
        .eq("cluster_id", job.cluster_id)
        .eq("lang", dst)
        .eq("is_current", true);
      for (const row of existing || []) {
        try {
          await updateRecord("cluster_ai", row.id, { is_current: false });
        } catch (_) {}
      }
    } catch (_) {}

    try {
      await insertRecord("cluster_ai", {
        cluster_id: job.cluster_id,
        lang: dst,
        ai_title,
        ai_summary,
        ai_details,
        model: `${process.env.MT_PROVIDER || "pretranslator"}#ph=${
          job.pivot_hash
        }`,
        pivot_hash: job.pivot_hash,
        is_current: true,
      });
    } catch (insErr) {
      // Fallback when pivot_hash column doesn't exist
      await insertRecord("cluster_ai", {
        cluster_id: job.cluster_id,
        lang: dst,
        ai_title,
        ai_summary,
        ai_details,
        model: `${process.env.MT_PROVIDER || "pretranslator"}#ph=${
          job.pivot_hash
        }`,
        is_current: true,
      });
    }
    markDone(idempotencyKey);
    return { inserted: 1, skipped: 0 };
  } catch (e) {
    logger.debug("Job processing skipped", {
      clusterId: job.cluster_id,
      dst,
      reason: e.message,
    });
    return { inserted: 0, skipped: 1 };
  }
}

async function processJobQueue(concurrency, perItemTimeoutMs) {
  let inserted = 0;
  const workers = Array.from({ length: concurrency }, () =>
    (async () => {
      while (_jobQueue.length) {
        const job = dequeueJob();
        if (!job) break;
        try {
          const res = await processJob(job, perItemTimeoutMs);
          inserted += res.inserted;
        } catch (e) {
          logger.debug("Job failed", { job, error: e.message });
        }
      }
    })()
  );
  await Promise.all(workers);
  return { inserted };
}

// Note: To harden against concurrent inserts, consider adding in your DB:
// CREATE UNIQUE INDEX IF NOT EXISTS uq_cluster_ai_current
//   ON public.cluster_ai (cluster_id, lang)
//   WHERE is_current = true;
