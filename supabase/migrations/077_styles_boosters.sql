-- ===== Humane Gang — 077 : 44 nouveaux styles de cartouche de booster (30 couleurs, 14 thèmes) =====
-- Rôle : autoriser 44 styles supplémentaires (30 couleurs et 14 thèmes) pour hg_booster_types.style (en plus des 9 d'origine),
-- choisis dans l'éditeur de types de l'admin (onglet Boosters des cartes).
--   1. hg_booster_styles() : liste de référence des 53 classes (même liste que assets/js/booster-styles.js ;
--      CSS : cartes-boosters.css pour les 9 d'origine, boosters-styles.css pour les 30 couleurs).
--   2. hg_booster_type_save : identique à 071 (et à la définition en production), sauf la liste des styles,
--      désormais lue dans hg_booster_styles() ; un style inconnu reste refusé (« Style inconnu »).
--   3. Contrainte hg_booster_types_style_check (style = une des 53 classes) : filet de sécurité en plus de la RPC.
--      Posée NOT VALID puis validée (les 9 types existants utilisent des styles d'origine).
-- Idempotente (create or replace, contrainte posée seulement si absente), rétrocompatible (aucun style retiré).

-- 1. Liste de référence
create or replace function public.hg_booster_styles()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'cart--classique', 'cart--serie', 'cart--argente', 'cart--dore', 'cart--diamant', 'cart--quitte',
    'cart--holo', 'cart--collection', 'cart--identite',
    -- 30 couleurs (077) : rouges, roses et violets, oranges et bruns, jaunes et verts, bleus et cyans, indigos et neutres
    'cart--rubis', 'cart--paprika', 'cart--braise', 'cart--corail', 'cart--framboise', 'cart--dragee',
    'cart--fuchsia', 'cart--mauve', 'cart--lavande', 'cart--prune', 'cart--abricot', 'cart--mandarine',
    'cart--miel', 'cart--cuivre', 'cart--cacao', 'cart--citron', 'cart--pistache', 'cart--kiwi',
    'cart--olive', 'cart--acide', 'cart--menthe', 'cart--lagon', 'cart--petrole', 'cart--azur',
    'cart--saphir', 'cart--pervenche', 'cart--amethyste', 'cart--indigo', 'cart--ardoise', 'cart--ivoire',
    -- 14 thèmes (077) : dessins génériques, classes cart--theme-<slug>
    'cart--theme-pate', 'cart--theme-saucisse', 'cart--theme-pate-saucisse', 'cart--theme-raclette', 'cart--theme-fondue', 'cart--theme-arene', 'cart--theme-blocs',
    'cart--theme-usine', 'cart--theme-noel', 'cart--theme-halloween', 'cart--theme-paques', 'cart--theme-saint-nicolas', 'cart--theme-feux-artifice', 'cart--theme-gateau-anniversaire'
  ]::text[];
$$;
comment on function public.hg_booster_styles() is 'Classes CSS autorisées pour hg_booster_types.style (9 d''origine + 30 couleurs, migration 077). Même liste que assets/js/booster-styles.js.';
revoke all on function public.hg_booster_styles() from public, anon, authenticated;
grant execute on function public.hg_booster_styles() to service_role;

-- 2. Enregistrement d'un type : la liste des styles vient de hg_booster_styles()
create or replace function public.hg_booster_type_save(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  keys text[] := array['commune','peu_commune','rare','epique','legendaire','mythique','identite'];
  styles text[] := public.hg_booster_styles();  -- 077 : liste partagée avec la contrainte de la table
  v_id text;
  v_create boolean;
  old_t hg_booster_types;
  r hg_booster_types;
  v jsonb;
  x numeric;
  k text;
  total numeric;
  new_rates jsonb;
  arr text[];
  unknown text;
  removed text[] := '{}';
begin
  if not public.hg_has_perm('cartes') then raise exception 'Réservé à l''admin et au Staff « cartes »'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Données invalides'; end if;
  v_create := coalesce(p->'create' = 'true'::jsonb, false);
  v_id := btrim(coalesce(p->>'id', ''));
  if v_id !~ '^[a-z0-9_]{2,30}$' then
    raise exception 'Identifiant invalide : de 2 à 30 caractères parmi a à z, 0 à 9 et _';
  end if;

  -- Verrou de la table des types (petite) : gratuit du jour et création sans course.
  perform 1 from hg_booster_types for update;
  select * into old_t from hg_booster_types where id = v_id;
  if v_create then
    if found then raise exception 'Un type « % » existe déjà (l''identifiant ne se change pas)', v_id; end if;
    foreach k in array array['name', 'price', 'rates'] loop
      if not (p ? k) then
        raise exception 'Champ obligatoire : %', case k when 'name' then 'nom' when 'price' then 'prix' else 'taux' end;
      end if;
    end loop;
    r.id := v_id; r.size := 5; r.shiny_rate := 3; r.pity_epique := 0; r.pool := 'tous';
    r.weekly_limit := null; r.free_daily := false; r.style := 'cart--classique'; r.description := null;
    r.active := true; r.excluded_rarities := '{}'; r.excluded_sets := '{}';
    r.sort := coalesce((select max(sort) from hg_booster_types), 0) + 10;
  else
    if not found then raise exception 'Type de booster inconnu'; end if;
    r := old_t;
  end if;

  -- Nom
  if p ? 'name' then
    r.name := btrim(coalesce(p->>'name', ''));
    if char_length(r.name) not between 1 and 60 then raise exception 'Le nom doit faire de 1 à 60 caractères'; end if;
  end if;
  -- Prix
  if p ? 'price' then
    x := hg_booster_num(p->'price');
    if x is null or x <> trunc(x) or x < 0 or x > 1000000 then
      raise exception 'Le prix doit être un nombre entier entre 0 et 1 000 000';
    end if;
    r.price := x::int;
  end if;
  -- Nombre de cartes
  if p ? 'size' then
    x := hg_booster_num(p->'size');
    if x is null or x <> trunc(x) or x < 1 or x > 10 then
      raise exception 'Le nombre de cartes doit être un entier entre 1 et 10';
    end if;
    r.size := x::int;
  end if;
  -- Taux : les 7 raretés, >= 0, somme 100
  if p ? 'rates' then
    v := p->'rates';
    if v is null or jsonb_typeof(v) <> 'object' then raise exception 'Les taux sont invalides'; end if;
    select string_agg(q, ', ') into unknown from jsonb_object_keys(v) q where not (q = any(keys));
    if unknown is not null then raise exception 'Rareté inconnue dans les taux : %', unknown; end if;
    new_rates := '{}'::jsonb; total := 0;
    foreach k in array keys loop
      x := hg_booster_num(v->k);
      if x is null then raise exception 'Taux manquant ou invalide pour la rareté « % »', hg_rarity_label(k); end if;
      if x < 0 then raise exception 'Un taux ne peut pas être négatif (« % »)', hg_rarity_label(k); end if;
      new_rates := new_rates || jsonb_build_object(k, x);
      total := total + x;
    end loop;
    if total not between 99.99 and 100.01 then
      raise exception 'Les taux doivent faire 100 %% au total (actuellement % %%)', trim_scale(round(total, 4));
    end if;
    r.rates := new_rates;
  end if;
  -- Brillante
  if p ? 'shiny_rate' then
    x := hg_booster_num(p->'shiny_rate');
    if x is null or x < 0 or x > 100 then raise exception 'Le taux de brillante doit être entre 0 et 100'; end if;
    r.shiny_rate := x;
  end if;
  -- Garantie Épique
  if p ? 'pity_epique' then
    x := hg_booster_num(p->'pity_epique');
    if x is null or x <> trunc(x) or x < 0 or x > 1000 then
      raise exception 'La garantie Épique doit être un entier entre 0 et 1 000 (0 = aucune)';
    end if;
    r.pity_epique := x::int;
  end if;
  -- Contenu
  if p ? 'pool' then
    r.pool := p->>'pool';
    if r.pool is null or r.pool not in ('tous', 'serie', 'manquantes') then
      raise exception 'Contenu inconnu : « tous », « serie » ou « manquantes »';
    end if;
  end if;
  -- Limite par semaine (null = aucune)
  if p ? 'weekly_limit' then
    if p->'weekly_limit' = 'null'::jsonb or btrim(coalesce(p->>'weekly_limit', '')) = '' then
      r.weekly_limit := null;
    else
      x := hg_booster_num(p->'weekly_limit');
      if x is null or x <> trunc(x) or x < 1 or x > 1000 then
        raise exception 'La limite par semaine doit être vide (aucune) ou un entier entre 1 et 1 000';
      end if;
      r.weekly_limit := x::int;
    end if;
  end if;
  -- Booléens
  if p ? 'free_daily' then
    if jsonb_typeof(p->'free_daily') <> 'boolean' then raise exception 'Valeur invalide pour « gratuit du jour »'; end if;
    r.free_daily := (p->>'free_daily')::boolean;
  end if;
  if p ? 'active' then
    if jsonb_typeof(p->'active') <> 'boolean' then raise exception 'Valeur invalide pour « en vente »'; end if;
    r.active := (p->>'active')::boolean;
  end if;
  -- Style
  if p ? 'style' then
    r.style := p->>'style';
    if r.style is null or not (r.style = any(styles)) then raise exception 'Style inconnu : « % »', coalesce(r.style, ''); end if;
  end if;
  -- Description (vide = aucune)
  if p ? 'description' then
    r.description := nullif(btrim(coalesce(p->>'description', '')), '');
    if char_length(r.description) > 300 then raise exception 'La description fait au plus 300 caractères'; end if;
  end if;
  -- Ordre d'affichage
  if p ? 'sort' then
    x := hg_booster_num(p->'sort');
    if x is null or x <> trunc(x) or x < -100000 or x > 100000 then raise exception 'L''ordre doit être un nombre entier'; end if;
    r.sort := x::int;
  end if;
  -- Raretés exclues
  if p ? 'excluded_rarities' then
    v := coalesce(p->'excluded_rarities', '[]'::jsonb);
    if v = 'null'::jsonb then v := '[]'::jsonb; end if;
    if jsonb_typeof(v) <> 'array' or exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'string') then
      raise exception 'Raretés exclues : liste invalide';
    end if;
    select string_agg(e, ', ') into unknown from jsonb_array_elements_text(v) e where not (e = any(keys));
    if unknown is not null then raise exception 'Rareté exclue inconnue : %', unknown; end if;
    select coalesce(array_agg(distinct e order by e), '{}') into arr from jsonb_array_elements_text(v) e;
    if keys <@ arr then raise exception 'Toutes les raretés ne peuvent pas être exclues'; end if;
    r.excluded_rarities := array(select q from unnest(keys) with ordinality u(q, o) where q = any(arr) order by o);
  end if;
  -- Séries exclues (codes existants)
  if p ? 'excluded_sets' then
    v := coalesce(p->'excluded_sets', '[]'::jsonb);
    if v = 'null'::jsonb then v := '[]'::jsonb; end if;
    if jsonb_typeof(v) <> 'array' or exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'string') then
      raise exception 'Séries exclues : liste invalide';
    end if;
    select string_agg(e, ', ') into unknown from jsonb_array_elements_text(v) e
     where not exists (select 1 from hg_card_sets s where s.code = e);
    if unknown is not null then raise exception 'Série inconnue : %', unknown; end if;
    select coalesce(array_agg(distinct e order by e), '{}') into arr from jsonb_array_elements_text(v) e;
    r.excluded_sets := arr;
  end if;

  -- Cohérence : la garantie Épique doit pouvoir tomber sur une rareté autorisée.
  if r.pity_epique > 0 and array['epique','legendaire','mythique','identite']::text[] <@ r.excluded_rarities then
    raise exception 'La garantie Épique demande au moins une rareté Épique ou mieux non exclue (mets-la à 0)';
  end if;

  -- Gratuit du jour : un seul type ; on l'enlève des autres.
  if r.free_daily then
    select coalesce(array_agg(id order by id), '{}') into removed from hg_booster_types where free_daily and id <> r.id;
    update hg_booster_types set free_daily = false, updated_at = now(), updated_by = auth.uid()
     where free_daily and id <> r.id;
  end if;

  r.updated_at := now();
  r.updated_by := auth.uid();
  if v_create then
    insert into hg_booster_types (id, name, price, size, rates, shiny_rate, pity_epique, pool, weekly_limit,
      free_daily, style, description, active, sort, updated_at, excluded_rarities, excluded_sets, updated_by)
    values (r.id, r.name, r.price, r.size, r.rates, r.shiny_rate, r.pity_epique, r.pool, r.weekly_limit,
      r.free_daily, r.style, r.description, r.active, r.sort, r.updated_at, r.excluded_rarities, r.excluded_sets, r.updated_by);
  else
    update hg_booster_types set name = r.name, price = r.price, size = r.size, rates = r.rates,
      shiny_rate = r.shiny_rate, pity_epique = r.pity_epique, pool = r.pool, weekly_limit = r.weekly_limit,
      free_daily = r.free_daily, style = r.style, description = r.description, active = r.active, sort = r.sort,
      updated_at = r.updated_at, excluded_rarities = r.excluded_rarities, excluded_sets = r.excluded_sets,
      updated_by = r.updated_by
     where id = r.id;
  end if;
  select * into r from hg_booster_types where id = v_id;

  perform hg_admin_audit('booster_type', null, r.id, jsonb_build_object(
    'creation', v_create,
    'avant', case when v_create then null else to_jsonb(old_t) end,
    'apres', to_jsonb(r),
    'gratuit_retire_de', to_jsonb(removed)));

  return jsonb_build_object('type', to_jsonb(r), 'created', v_create, 'free_daily_removed_from', to_jsonb(removed));
end $function$;

revoke all on function public.hg_booster_type_save(jsonb) from public, anon;
grant execute on function public.hg_booster_type_save(jsonb) to authenticated, service_role;

-- 3. Contrainte sur la colonne
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.hg_booster_types'::regclass and conname = 'hg_booster_types_style_check') then
    alter table public.hg_booster_types
      add constraint hg_booster_types_style_check check (style = any (public.hg_booster_styles())) not valid;
  end if;
end $$;
alter table public.hg_booster_types validate constraint hg_booster_types_style_check;
