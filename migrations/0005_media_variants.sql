-- 0005_media_variants.sql
-- Adds media_variants for responsive images and extends media_assets.origin to include 'og_card'

-- Extend origin enum-like check to include 'og_card'
DO $$ BEGIN
  ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS media_assets_origin_check;
  ALTER TABLE media_assets
    ADD CONSTRAINT media_assets_origin_check
      CHECK (origin in ('publisher','stock','ai_generated','og_card'));
EXCEPTION WHEN undefined_table THEN
  -- media_assets may not exist yet in a pristine environment
  NULL;
END $$;

-- Create media_variants to track responsive renditions per media
CREATE TABLE IF NOT EXISTS media_variants (
  media_id text REFERENCES media_assets(id) ON DELETE CASCADE,
  width int NOT NULL,
  storage_path text,
  public_url text,
  bytes int,
  PRIMARY KEY (media_id, width)
);

CREATE INDEX IF NOT EXISTS idx_media_variants_media ON media_variants(media_id);
