-- ===== Humane Gang — 164 : thèmes Saint-Nicolas et Pâté-saucisse, effets « neige-emojis » et « braises », Raclette en fromage fondu =====
-- Deux nouveaux effets dessinés côté site (core/effects.js, décor dans assets/commun/themes-decor.css) :
--   neige-emojis : neige bien visible et quelques emojis du thème qui tombent ;
--   braises      : braises et étincelles qui montent, avec la pluie d'emojis du thème.
-- Saint-Nicolas : du 1er au 6 décembre, priorité 11 (au-dessus de Noël et de l'hiver).
-- Pâté-saucisse : sans dates, inactif ; s'affiche quand l'admin le force (réglage du thème du site).
-- Raclette : retour à l'effet « fromage » (fromage fondu sur tout le site, gourmandises et emojis).
alter table public.hg_themes drop constraint if exists hg_themes_effect_check;
alter table public.hg_themes add constraint hg_themes_effect_check
  check (effect = any (array['aucun', 'pluie', 'neige', 'neige-emojis', 'etoiles', 'fromage', 'braises']));

insert into public.hg_themes (slug, name, is_default, active, start_md, end_md, priority, logo_url, emojis, effect, colors)
select 'saint-nicolas', 'Saint-Nicolas', false, true, '12-01', '12-06', 11, null,
  array['🍊', '🫏', '🍪', '⭐', '🎁', '🥜', '🕯️', '🌟'], 'neige-emojis',
  '{"bg":"#0F1838","surface":"#1A2650","text":"#FBF6EC","muted":"#C5CDE3","accent":"#D42630","highlight":"#F2C14E"}'::jsonb
where not exists (select 1 from public.hg_themes where slug = 'saint-nicolas');

insert into public.hg_themes (slug, name, is_default, active, start_md, end_md, priority, logo_url, emojis, effect, colors)
select 'pate-saucisse', 'Pâté-saucisse', false, false, null, null, 12, null,
  array['🌭', '🥖', '🧺', '🍷', '🌿', '🔥', '🥔', '🥒'], 'braises',
  '{"bg":"#2A1409","surface":"#3D2214","text":"#FFF4E0","muted":"#E0C7A6","accent":"#C8262C","highlight":"#F2B441"}'::jsonb
where not exists (select 1 from public.hg_themes where slug = 'pate-saucisse');

update public.hg_themes set effect = 'fromage' where slug = 'raclette';
