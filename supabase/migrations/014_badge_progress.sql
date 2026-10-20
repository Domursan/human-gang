-- 014 — Progression des badges à niveaux (page Mon compte) : valeur actuelle de chaque compteur pour moi.
-- hg_metric_value n'est pas exécutable par les membres (security definer interne) : cette fonction n'expose
-- que MES valeurs, et seulement pour les badges à niveaux. Sans elle, compte.html calcule ce qu'il peut côté
-- client (ancienneté, images attrapées, événements) et affiche seulement le niveau actuel pour le reste.
-- À coller dans l'éditeur SQL Supabase (non appliquée automatiquement).
create or replace function public.hg_my_badge_progress()
returns table(badge_code text, metric text, value numeric)
language sql stable security definer set search_path = public
as $$
  select b.code, b.metric, public.hg_metric_value(auth.uid(), b.metric, b.event_id)
    from public.hg_badges b
   where public.hg_is_member() and auth.uid() is not null
     and b.levels_enabled and b.metric is not null
$$;
revoke all on function public.hg_my_badge_progress() from public, anon;
grant execute on function public.hg_my_badge_progress() to authenticated;
