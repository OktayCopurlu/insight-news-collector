-- 0002_add_pivot_hash.sql
-- Adds pivot_hash to cluster_ai for robust idempotency across restarts

ALTER TABLE IF EXISTS cluster_ai
  ADD COLUMN IF NOT EXISTS pivot_hash text;

-- Lightweight index to speed up lookups by (cluster_id, lang, is_current)
-- Index concept existed in the legacy per-article AI table; adding here if missing
CREATE INDEX IF NOT EXISTS idx_cluster_ai_current
  ON cluster_ai (cluster_id, lang, is_current);
