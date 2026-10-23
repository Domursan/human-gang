-- 039b_rarete_libelle — appliquée en production le 21/10/2026 (version 20261021212137), sans fichier dans le dépôt.
-- Fichier reconstitué le 23/10/2026 à partir de l'historique des migrations de production
-- (supabase_migrations.schema_migrations, colonne statements) : texte identique à ce qui a été exécuté.
-- Rôle : libellé lisible d'une rareté (« peu commune », « épique »…) et son usage dans l'annonce du don admin
-- d'une carte (hg_cards_admin_give, qui affichait la clé brute « peu_commune »).
-- Rejouable (create or replace).

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
