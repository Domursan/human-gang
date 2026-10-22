-- Suggestions d'échanges à partir des souhaits de cartes (onglet Échanges, bloc « Échanges possibles »).
-- Ajout seulement, rétrocompatible : une seule fonction nouvelle, rien de modifié ni supprimé.
-- Le site l'appelle en premier ; s'il ne la trouve pas (PGRST202), il calcule les mêmes suggestions à partir
-- des lectures existantes (souhaits et exemplaires déjà lisibles par tous les membres, via RLS).

-- 1. hg_trade_suggestions() : pour le membre connecté, renvoie les membres actifs (pas fantômes) qui :
--    - « want » : possèdent en double (au moins 2 exemplaires vivants) une carte de MA liste de souhaits,
--      avec au moins un exemplaire libre (non bloqué par une offre) : je peux le demander ;
--    - « give » : ont DANS LEUR liste de souhaits une carte que je possède en double, avec un exemplaire libre
--      de ma part : je peux le donner.
--    Un membre présent dans les deux listes est marqué « both ». Aucune donnée privée : pas de solde, pas
--    d'offre, pas d'email ; seulement pseudo, avatar, couleur et identifiants de cartes/exemplaires.
--    Résultat : tableau jsonb trié (both d'abord, puis nombre de cartes concernées, puis pseudo), limité à p_limit.
create or replace function public.hg_trade_suggestions(p_limit int default 60)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  res jsonb;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;

  with
  -- Cartes que je possède en double (exemplaires vivants, carte active et échangeable)
  my_dup as (
    select x.card_id
      from hg_card_copies x join hg_cards k on k.id = x.card_id
     where x.owner_id = me and x.recycled_at is null and k.active is not false and k.tradeable
     group by x.card_id
    having count(*) >= 2
  ),
  -- Mes exemplaires libres des cartes en double (un par carte : celui que je mets dans l'offre)
  my_give as (
    select x.card_id, min(x.id) as copy_id
      from hg_card_copies x join hg_cards k on k.id = x.card_id
     where x.owner_id = me and x.recycled_at is null and x.locked_trade is null
       and k.active is not false and k.tradeable
       and x.card_id in (select card_id from my_dup)
     group by x.card_id
  ),
  -- Cartes de ma liste de souhaits
  my_wish as (select w.card_id from hg_card_wishlist w where w.user_id = me),
  -- « want » : exemplaires des autres (membres actifs) pour mes souhaits ; garde les membres en double
  their_dup as (
    select x.owner_id, x.card_id, count(*) as total, min(x.id) filter (where x.locked_trade is null) as copy_id
      from hg_card_copies x join hg_cards k on k.id = x.card_id
      join hg_profiles p on p.id = x.owner_id and not p.is_ghost and p.id <> me
     where x.recycled_at is null and k.active is not false and k.tradeable
       and x.card_id in (select card_id from my_wish)
     group by x.owner_id, x.card_id
  ),
  want_side as (
    select d.owner_id as uid, jsonb_agg(jsonb_build_object('card_id', d.card_id, 'copy_id', d.copy_id) order by d.card_id) as items,
           count(*) as n
      from their_dup d
     where d.total >= 2 and d.copy_id is not null
     group by d.owner_id
  ),
  -- « give » : membres (actifs) qui ont dans leur liste une de mes cartes en double
  give_side as (
    select w.user_id as uid, jsonb_agg(jsonb_build_object('card_id', g.card_id, 'copy_id', g.copy_id) order by g.card_id) as items,
           count(*) as n
      from hg_card_wishlist w
      join my_give g on g.card_id = w.card_id
      join hg_profiles p on p.id = w.user_id and not p.is_ghost and p.id <> me
     group by w.user_id
  ),
  merged as (
    select coalesce(a.uid, b.uid) as uid, coalesce(a.items, '[]'::jsonb) as want, coalesce(b.items, '[]'::jsonb) as give,
           coalesce(a.n, 0) as n_want, coalesce(b.n, 0) as n_give,
           (a.uid is not null and b.uid is not null) as both
      from want_side a full join give_side b on a.uid = b.uid
  )
  select coalesce(jsonb_agg(row_to_json(r)::jsonb order by r.both desc, (r.n_want + r.n_give) desc, r.pseudo), '[]'::jsonb)
    into res
    from (
      select m.uid as user_id, p.pseudo, p.avatar_url, p.color, m.want, m.give, m.both,
             m.n_want, m.n_give
        from merged m join hg_profiles p on p.id = m.uid
       order by m.both desc, (m.n_want + m.n_give) desc, p.pseudo
       limit greatest(coalesce(p_limit, 60), 1)
    ) r;

  return res;
end $$;

revoke all on function public.hg_trade_suggestions(int) from public, anon;
grant execute on function public.hg_trade_suggestions(int) to authenticated;
