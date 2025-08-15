-- Add 'tr' to pretranslate_langs for markets with English pivot
update public.app_markets
   set pretranslate_langs = case
     when pretranslate_langs is null then array['tr']::text[]
     when not ('tr' = any(pretranslate_langs)) then pretranslate_langs || array['tr']::text[]
     else pretranslate_langs
   end
 where coalesce(lower(pivot_lang),'en') like 'en%';

-- Also include 'tr' in show_langs to make it visible in /config if missing
update public.app_markets
   set show_langs = case
     when show_langs is null then array['en','tr']::text[]
     when not ('tr' = any(show_langs)) then show_langs || array['tr']::text[]
     else show_langs
   end
 where coalesce(lower(pivot_lang),'en') like 'en%';
