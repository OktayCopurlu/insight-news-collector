-- Optional translations cache table used by translationHelper.js
create table if not exists public.translations (
  key text primary key,
  src_lang text,
  dst_lang text,
  text text,
  created_at timestamptz default now()
);

-- No RLS for simplicity; restrict via service role only in server-side usage
