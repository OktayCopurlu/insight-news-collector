-- Add lang_base generated column for fast base language fallback
alter table if exists public.cluster_ai
  add column if not exists lang_base text
  generated always as (split_part(lower(lang), '-', 1)) stored;

-- Unique current row remains enforced; add supporting index on (cluster_id, lang_base)
create index if not exists ix_cluster_ai_cluster_langbase
  on public.cluster_ai (cluster_id, lang_base)
  where is_current = true;
