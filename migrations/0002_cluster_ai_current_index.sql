create unique index if not exists uq_cluster_ai_current_lang
  on public.cluster_ai (cluster_id, lang)
  where is_current = true;

create index if not exists ix_cluster_ai_cluster_lang
  on public.cluster_ai (cluster_id, lang);

do $$ begin
  -- Create table only if it does not exist (no-op otherwise)
  if to_regclass('public.app_markets') is null then
    create table public.app_markets (
      id bigserial primary key,
      market_code text unique,
      pivot_lang text default 'en',
      show_langs text[],
      pretranslate_langs text[],
      enabled boolean default true
    );
  end if;
end $$;

-- Seed a default market if none present; adapt to existing columns
do $$
declare
  has_pretrans boolean;
begin
  if not exists (select 1 from public.app_markets) then
    select exists(
      select 1 from information_schema.columns 
       where table_schema='public' and table_name='app_markets' and column_name='pretranslate_langs'
    ) into has_pretrans;

    if has_pretrans then
      insert into public.app_markets (market_code, pivot_lang, show_langs, pretranslate_langs, enabled)
      values ('global', 'en', array['en','tr'], array['tr'], true);
    else
      insert into public.app_markets (market_code, pivot_lang, show_langs, enabled)
      values ('global', 'en', array['en','tr'], true);
    end if;
  end if;
end $$;
