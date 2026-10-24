-- 116 : booster série d'une série qui n'a pas toutes les raretés (ex. « Les OG », que des légendaires) :
-- si la rareté tirée n'existe pas dans la série (ni en dessous), on prend la rareté disponible juste au-dessus
-- au lieu de renvoyer un booster vide (« Aucune carte n'est disponible »). Choix validé par Ethan le 24.10.2026.
create or replace function public.hg_booster_draw(p_rarity text, p_type text, p_set uuid, p_user uuid, p_exclude uuid[],
  p_forced boolean default false, p_unrestricted boolean default false)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare
  ord text[] := array['commune','peu_commune','rare','epique','legendaire','mythique','identite'];
  i int := array_position(ord, p_rarity);
  missing boolean;
  ex_r text[];
  ex_s text[];
  seq int[];
  j int;
  cid uuid;
begin
  if i is null then return null; end if;
  select t.pool = 'manquantes', t.excluded_rarities, t.excluded_sets into missing, ex_r, ex_s
    from public.hg_booster_types t where t.id = p_type;
  missing := coalesce(missing, false) and not coalesce(p_unrestricted, false);
  ex_r := coalesce(ex_r, '{}'::text[]);
  ex_s := coalesce(ex_s, '{}'::text[]);
  if coalesce(p_forced, false) then
    seq := array(select generate_series(i, 7))
        || array(select generate_series(i - 1, 4, -1))
        || array(select generate_series(3, 1, -1));
  elsif missing then
    seq := array(select generate_series(i, 1, -1)) || array(select generate_series(i + 1, 7));
  else
    seq := array(select generate_series(i, 1, -1));
    if ord[i] = any(ex_r) or p_set is not null then seq := seq || array(select generate_series(i + 1, 7)); end if;
  end if;
  foreach j in array seq loop
    continue when ord[j] = any(ex_r);
    cid := public.hg_booster_pick_one(ord[j], p_set, p_user, missing, coalesce(p_exclude, '{}'::uuid[]), ex_s);
    if cid is not null then return cid; end if;
  end loop;
  return null;
end $function$;
