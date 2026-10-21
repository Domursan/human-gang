-- Don d'une carte par l'admin / le Staff : ligne dans le fil d'actualité (sauf pour un fantôme).
-- Libellé de rareté lisible (accents) pour les textes du fil.
create or replace function public.hg_rarity_label(p text) returns text language sql immutable set search_path to 'public' as $$
  select case p when 'commune' then 'commune' when 'peu_commune' then 'peu commune' when 'rare' then 'rare'
    when 'epique' then 'épique' when 'legendaire' then 'légendaire' when 'mythique' then 'mythique'
    when 'identite' then 'identité' else replace(coalesce(p, ''), '_', ' ') end
$$;

create or replace function public.hg_cards_admin_give(p_user uuid, p_card uuid, p_shiny boolean default false, p_count integer default 1)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare i int; n int := greatest(least(coalesce(p_count, 1), 100), 1); k hg_cards; giver text; target hg_profiles;
begin
  if not public.hg_has_perm('cartes') then raise exception 'Réservé à l''admin'; end if;
  for i in 1..n loop perform hg_card_give(p_user, p_card, p_shiny, 'admin'); end loop;
  perform hg_card_check_sets(p_user);
  perform hg_admin_audit('carte_donnee', p_user, p_card::text,
    jsonb_build_object('exemplaires', n, 'brillante', coalesce(p_shiny, false)));
  select * into k from hg_cards where id = p_card;
  select * into target from hg_profiles where id = p_user;
  select pseudo into giver from hg_profiles where id = auth.uid();
  if target.id is not null and not target.is_ghost then
    insert into hg_activity(user_id, kind, text) values (p_user, 'cartes',
      coalesce(giver, 'L''admin') || ' a offert ' || case when n > 1 then n || ' exemplaires de ' else '' end
      || '« ' || k.name || ' » (' || hg_rarity_label(k.rarity) || case when coalesce(p_shiny, false) and k.can_shiny then ', brillante' else '' end
      || ') à ' || target.pseudo || ' !');
  end if;
  return n;
end $function$;
