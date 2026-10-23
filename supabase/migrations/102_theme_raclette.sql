-- ===== Humane Gang — 102 : thème saisonnier « Raclette » (idée F3) =====
-- Nouvel effet « fromage » : fromage fondu qui coule en haut de la page et sous les boutons principaux et les cadres,
-- cornichons et charcuterie qui se baladent (dessin côté site : core/effects.js et base.css).
-- Thème actif du 15 janvier au 29 février (priorité 3 : au-dessus des saisons, sous Noël et Halloween), réglable dans l'admin.
alter table public.hg_themes drop constraint if exists hg_themes_effect_check;
alter table public.hg_themes add constraint hg_themes_effect_check check (effect = any (array['aucun', 'pluie', 'neige', 'etoiles', 'fromage']));
insert into public.hg_themes (slug, name, is_default, active, start_md, end_md, priority, logo_url, emojis, effect, colors)
select 'raclette', 'Raclette', false, true, '01-15', '02-29', 3, null, array['🧀', '🥔', '🥒'], 'fromage',
  '{"bg":"#130E09","text":"#F6ECD8","muted":"#C2B096","accent":"#E8B52E","surface":"#1F1710","highlight":"#F2C14E"}'::jsonb
where not exists (select 1 from public.hg_themes where slug = 'raclette');
