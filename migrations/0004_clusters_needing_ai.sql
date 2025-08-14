-- Helper view/function to list clusters lacking current AI for a given lang

CREATE OR REPLACE VIEW v_clusters_needing_ai AS
SELECT c.id AS cluster_id
FROM clusters c
LEFT JOIN LATERAL (
  SELECT 1 FROM cluster_ai ai
  WHERE ai.cluster_id = c.id AND ai.lang = 'en' AND ai.is_current
  LIMIT 1
) has_en ON TRUE
WHERE has_en IS NULL;

-- Optional: a function parameterized by lang
CREATE OR REPLACE FUNCTION clusters_needing_ai(p_lang text)
RETURNS TABLE (cluster_id text)
LANGUAGE sql AS $$
  SELECT c.id
  FROM clusters c
  WHERE NOT EXISTS (
    SELECT 1 FROM cluster_ai ai
    WHERE ai.cluster_id = c.id AND ai.lang = p_lang AND ai.is_current
  );
$$;
