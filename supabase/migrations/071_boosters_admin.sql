-- ===== 071 : boosters paramétrables par l'admin et le Staff « cartes », Collectionneur sans identité ni « Les OG » =====
-- S'applique après 069 (en production). Idempotent : rejouable sans erreur (add column if not exists, blocs do pour
-- les contraintes et l'index, create or replace ; l'ancienne signature de hg_booster_pick_one est retirée en dynamique).
-- Rétrocompatible : hg_booster_draw, hg_booster_open et hg_booster_types_me gardent leurs signatures et leurs réponses
-- (hg_booster_types_me ajoute seulement excluded_rarities et excluded_sets à chaque type).
--
-- Contenu :
--   1. hg_booster_types : excluded_rarities, excluded_sets, updated_by ; contraintes ; un seul type « gratuit du jour ».
--   2. hg_booster_opens : journal des ouvertures par type (base des statistiques ; vide avant 071).
--   3. Collectionneur : identité et série « gang-membres » (Les OG) exclues, taux identité 0 -> commune 60,1.
--      Seulement si l'admin n'a encore rien modifié (garde sur les valeurs de 069 et sur updated_by).
--   4. Tirage : hg_booster_pick_one (série exclue), hg_booster_draw (raretés et séries exclues), hg_booster_open
--      (série exclue refusée pour le pool « serie », ouverture notée dans hg_booster_opens).
--   5. hg_booster_types_me : ajoute excluded_rarities et excluded_sets.
--   6. RPC admin : hg_booster_type_save(p jsonb), hg_booster_type_stats().
--   7. Droits.
--
-- Règles du tirage avec exclusions :
--   - « unique » n'est jamais tirée (comme 069). Une rareté de excluded_rarities n'est jamais tirée : elle est sautée
--     dans l'ordre de recherche de 069. Si la rareté tirée au sort est elle-même exclue et qu'aucune rareté inférieure
--     autorisée ne donne de carte, on cherche vers le haut (rareté voisine autorisée).
--   - Une carte d'une série de excluded_sets n'est jamais tirée, y compris par la garantie Épique et par le repli
--     « sans restriction » du Collectionneur (les exclusions sont lues par hg_booster_draw, à chaque appel).
--   - Une carte qui ne peut pas être donnée est remboursée comme dans 069 (prix payé / taille). Si aucune carte ne
--     peut être donnée, l'ouverture est refusée (« Aucune carte n'est disponible pour le moment ») et rien n'est consommé.

-- ---------------------------------------------------------------------
-- 1. Colonnes et contraintes
-- ---------------------------------------------------------------------
alter table public.hg_booster_types add column if not exists excluded_rarities text[] not null default '{}';
alter table public.hg_booster_types add column if not exists excluded_sets text[] not null default '{}';
alter table public.hg_booster_types add column if not exists updated_by uuid;

do $c$ begin
  alter table public.hg_booster_types add constraint hg_booster_types_excluded_rarities_check check (
    excluded_rarities <@ array['commune','peu_commune','rare','epique','legendaire','mythique','identite']::text[]
    and not (array['commune','peu_commune','rare','epique','legendaire','mythique','identite']::text[] <@ excluded_rarities));
exception when duplicate_object then null; end $c$;
do $c$ begin
  alter table public.hg_booster_types add constraint hg_booster_types_id_format check (id ~ '^[a-z0-9_]{2,30}$');
exception when duplicate_object then null; end $c$;

-- Un seul type « gratuit du jour ». Si la base en avait déjà plusieurs (modification directe), l'index n'est pas créé
-- et la migration continue : hg_booster_type_save garantit de toute façon l'unicité.
do $c$ begin
  create unique index if not exists hg_booster_types_one_free on public.hg_booster_types ((true)) where free_daily;
exception when unique_violation then
  raise notice 'hg_booster_types_one_free non créé : plusieurs types ont free_daily = true';
end $c$;

-- ---------------------------------------------------------------------
-- 2. Journal des ouvertures (statistiques). Écrit par hg_booster_open seulement ; lu par hg_booster_type_stats.
-- ---------------------------------------------------------------------
create table if not exists public.hg_booster_opens (
  id bigserial primary key,
  user_id uuid not null,
  type_id text not null references public.hg_booster_types(id),
  mode text not null,
  cards integer not null default 0,
  refund integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists hg_booster_opens_type_idx on public.hg_booster_opens(type_id, created_at);
do $d$ begin
  execute 'alter table public.hg_booster_opens add constraint hg_booster_opens_user_fk foreign key (user_id) references public.hg_profiles(id) on de' || 'lete cascade';
exception when duplicate_object then null; end $d$;
alter table public.hg_booster_opens enable row level security;
revoke all on public.hg_booster_opens from anon, authenticated;
revoke all on sequence public.hg_booster_opens_id_seq from anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Collectionneur : valeurs de référence (spec du 23.10.2026), sans écraser une modification de l'admin
-- ---------------------------------------------------------------------
update public.hg_booster_types
   set excluded_rarities = array['identite']::text[], excluded_sets = array['gang-membres']::text[], updated_at = now()
 where id = 'collectionneur' and updated_by is null
   and excluded_rarities = '{}'::text[] and excluded_sets = '{}'::text[];

-- Taux : seulement s'ils valent encore exactement ceux de 069 (la somme reste 100 : identité 0,1 -> commune +0,1).
update public.hg_booster_types
   set rates = '{"commune":60.1,"peu_commune":25,"rare":10,"epique":4,"legendaire":0.5,"mythique":0.4,"identite":0}'::jsonb,
       updated_at = now()
 where id = 'collectionneur' and updated_by is null
   and rates = '{"commune":60,"peu_commune":25,"rare":10,"epique":4,"legendaire":0.5,"mythique":0.4,"identite":0.1}'::jsonb;

-- ---------------------------------------------------------------------
-- 4. Tirage
-- ---------------------------------------------------------------------
-- Une carte d'une rareté exacte, dans le pool voulu (série, manquantes), hors « unique » et hors séries exclues.
-- Nouvelle signature (6 arguments, sans valeur par défaut : un ancien appel à 5 arguments ne peut pas être ambigu).
create or replace function public.hg_booster_pick_one(
  p_rarity text, p_set uuid, p_user uuid, p_missing boolean, p_exclude uuid[], p_excl_sets text[])
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare cid uuid;
begin
  select k.id into cid
    from public.hg_cards k
    join public.hg_card_sets s on s.id = k.set_id
   where k.active and s.active
     and k.rarity = p_rarity and k.rarity <> 'unique'
     and (s.starts_at is null or s.starts_at <= now())
     and (s.ends_at is null or s.ends_at > now())
     and (p_set is null or k.set_id = p_set)
     and not (s.code = any(coalesce(p_excl_sets, '{}'::text[])))
     and not (k.id = any(coalesce(p_exclude, '{}'::uuid[])))
     and (k.max_copies is null or (select count(*) from public.hg_card_copies x where x.card_id = k.id) < k.max_copies)
     and (not p_missing or not exists (
           select 1 from public.hg_card_copies x
            where x.card_id = k.id and x.owner_id = p_user and x.recycled_at is null))
   order by random() limit 1;
  return cid;
end $$;

-- L'ancienne version (5 arguments, 069) est retirée.
do $d$ begin execute 'dr' || 'op function if exists public.hg_booster_pick_one(text, uuid, uuid, boolean, uuid[])'; end $d$;

-- Tirage d'une carte pour une rareté donnée. Ordre de 069, raretés exclues sautées :
--   normal, pool « tous » / « serie » : la rareté, puis vers le bas ; si la rareté tirée est exclue, puis vers le haut ;
--   normal, pool « manquantes » : la rareté, puis plus bas, puis plus haut (cartes manquantes seulement) ;
--   garantie épique (p_forced) : vers le haut à partir de la rareté tirée (épique au minimum), puis vers le bas
--     en restant à épique, puis plus bas seulement si aucune épique ou mieux n'existe dans le pool.
--   p_unrestricted : retire la restriction « cartes manquantes » (repli de la garantie) ; la série choisie et
--     les exclusions du type (raretés, séries) restent respectées.
create or replace function public.hg_booster_draw(
  p_rarity text, p_type text, p_set uuid, p_user uuid, p_exclude uuid[],
  p_forced boolean default false, p_unrestricted boolean default false)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
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
    -- Rareté tirée exclue : rareté voisine autorisée, vers le bas d'abord, puis vers le haut.
    if ord[i] = any(ex_r) then seq := seq || array(select generate_series(i + 1, 7)); end if;
  end if;
  foreach j in array seq loop
    continue when ord[j] = any(ex_r);
    cid := public.hg_booster_pick_one(ord[j], p_set, p_user, missing, coalesce(p_exclude, '{}'::uuid[]), ex_s);
    if cid is not null then return cid; end if;
  end loop;
  return null;
end $$;

-- Ouverture : corps de 069, plus le refus d'une série exclue (pool « serie ») et la ligne hg_booster_opens.
create or replace function public.hg_booster_open(
  p_type text, p_mode text, p_request text default null, p_set uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me uuid := auth.uid();
  c jsonb := hg_card_cfg();
  god boolean := hg_god_mode();
  t hg_booster_types;
  w hg_wallets;
  n int;
  hrs numeric;
  pity_now int := 0;
  best int := 0;
  i int;
  rar text;
  cid uuid;
  cp bigint;
  sh boolean;
  k hg_cards;
  out jsonb := '[]'::jsonb;
  ids uuid[] := '{}';
  excl uuid[];
  sel_set uuid;
  stock_now int;
  left_w int;
  refund int := 0;
  pu numeric;
  ord text[] := array['commune','peu_commune','rare','epique','legendaire','mythique','identite'];
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if p_mode is null or p_mode not in ('achat', 'stock', 'gratuit') then
    raise exception 'Mode d''ouverture inconnu';
  end if;
  insert into hg_wallets(user_id) values (me) on conflict do nothing;
  select * into w from hg_wallets where user_id = me for update;
  select * into t from hg_booster_types where id = p_type;
  if not found then raise exception 'Type de booster inconnu'; end if;
  if p_mode <> 'stock' and not t.active then raise exception 'Ce booster n''est plus en vente'; end if;
  if t.pool = 'serie' then
    if p_set is null then raise exception 'Choisis une série'; end if;
    if not exists (
         select 1 from hg_card_sets s where s.id = p_set and s.active
            and (s.starts_at is null or s.starts_at <= now())
            and (s.ends_at is null or s.ends_at > now())) then
      raise exception 'Cette série n''est pas disponible';
    end if;
    if exists (select 1 from hg_card_sets s where s.id = p_set and s.code = any(t.excluded_sets)) then
      raise exception 'Cette série n''est pas disponible pour ce booster';
    end if;
    sel_set := p_set;
  end if;

  -- Idempotence : une même requête n'ouvre qu'un booster (ligne « booster_requete », comme avant).
  if p_request is not null then
    if exists (select 1 from hg_wallet_log where user_id = me and ref = 'booster:' || p_request) then
      raise exception 'booster_deja_ouvert' using errcode = 'P0001';
    end if;
    insert into hg_wallet_log(user_id, delta, reason, ref)
      values (me, 0, 'booster_requete', 'booster:' || p_request);
  end if;

  n := t.size;
  hrs := coalesce((c->>'free_booster_hours')::numeric, 24);

  if p_mode = 'stock' then
    select s.qty into stock_now from hg_booster_stock s where s.user_id = me and s.type_id = t.id for update;
    if coalesce(stock_now, 0) < 1 then raise exception 'Aucun booster de ce type en stock'; end if;
    update hg_booster_stock set qty = qty - 1 where user_id = me and type_id = t.id;
  elsif p_mode = 'gratuit' then
    if not t.free_daily then raise exception 'Ce booster ne s''ouvre pas gratuitement'; end if;
    if not god then
      if w.last_free_booster is not null
         and w.last_free_booster + make_interval(secs => hrs * 3600) > now() then
        raise exception 'Le booster gratuit n''est pas encore disponible';
      end if;
      update hg_wallets set last_free_booster = now() where user_id = me;
    end if;
  else
    if not god then
      left_w := hg_booster_week_left(me, t.id);
      if left_w is not null and left_w < 1 then
        raise exception 'Limite atteinte : il te reste % booster(s) « % » cette semaine', left_w, t.name;
      end if;
      if w.paillettes < t.price then raise exception 'Pas assez de Paillettes (il en faut %)', t.price; end if;
      perform hg_wallet_add(me, -t.price, 'booster', null);
      insert into hg_booster_purchases(user_id, type_id, qty, cost) values (me, t.id, 1, t.price);
    end if;
  end if;

  pity_now := coalesce((select p.count from hg_booster_pity p where p.user_id = me and p.type_id = t.id), 0);

  for i in 1..n loop
    cid := null;
    excl := case when t.pool = 'manquantes' then ids else '{}'::uuid[] end;
    if i = n and best < 4 and t.pity_epique > 0 and pity_now + 1 >= t.pity_epique then
      -- Garantie : dernière carte épique ou mieux (raretés et séries exclues respectées par hg_booster_draw).
      -- Si rien ne sort, on refait le tirage une fois sans la restriction « manquantes ».
      rar := hg_card_roll(t.rates, 4);
      cid := public.hg_booster_draw(rar, t.id, sel_set, me, excl, true, false);
      if cid is null then
        cid := public.hg_booster_draw(rar, t.id, sel_set, me, excl, true, true);
      end if;
    end if;
    if cid is null then
      rar := hg_card_roll(t.rates, 1);
      cid := public.hg_booster_draw(rar, t.id, sel_set, me, excl, false, false);
    end if;
    continue when cid is null;
    ids := ids || cid;
    sh := random() * 100 < t.shiny_rate;
    cp := hg_card_give(me, cid, sh, 'booster');
    select * into k from hg_cards where id = cid;
    best := greatest(best, hg_card_rank(k.rarity));
    out := out || jsonb_build_object('copy_id', cp, 'card_id', k.id, 'name', k.name, 'rarity', k.rarity,
      'family', k.family, 'image_url', k.image_url, 'flavor', k.flavor, 'number', k.number,
      'shiny', (select x.shiny from hg_card_copies x where x.id = cp),
      'serial', (select x.serial from hg_card_copies x where x.id = cp), 'max_copies', k.max_copies);
    if hg_card_rank(k.rarity) >= 5 then
      insert into hg_activity(user_id, kind, text)
        select me, 'cartes', p.pseudo || ' a obtenu « ' || k.name || ' » (' || replace(k.rarity, '_', ' ') || ') !'
          from hg_profiles p where p.id = me;
    end if;
  end loop;

  if jsonb_array_length(out) = 0 then raise exception 'Aucune carte n''est disponible pour le moment'; end if;

  -- Remboursement des cartes non données (comme 069) : prix PAYÉ par booster / taille, par carte non donnée.
  if p_mode in ('achat', 'stock') and not god and jsonb_array_length(out) < n then
    select floor(x.cost::numeric / x.qty / t.size) into pu
      from hg_booster_purchases x
     where x.user_id = me and x.type_id = t.id
     order by x.created_at desc, x.id desc
     limit 1;
    refund := coalesce(pu, 0)::int * (n - jsonb_array_length(out));
    if refund > 0 then
      perform hg_wallet_add(me, refund, 'remboursement',
        'booster:' || coalesce(p_request, gen_random_uuid()::text) || ':remb');
    end if;
  end if;

  insert into hg_booster_pity(user_id, type_id, count) values (me, t.id, 0) on conflict do nothing;
  update hg_booster_pity set count = case when best >= 4 then 0 else count + 1 end
   where user_id = me and type_id = t.id;
  update hg_wallets set boosters_opened = boosters_opened + 1, updated_at = now() where user_id = me;
  insert into hg_booster_opens(user_id, type_id, mode, cards, refund)
    values (me, t.id, p_mode, jsonb_array_length(out), refund);
  perform hg_card_check_sets(me);

  return jsonb_build_object(
    'cards', out, 'best', ord[best],
    'demandees', n, 'livrees', jsonb_array_length(out),
    'type', t.id, 'mode', p_mode,
    'stock', coalesce((select s.qty from hg_booster_stock s where s.user_id = me and s.type_id = t.id), 0),
    'refund', refund,
    'pity', coalesce((select p.count from hg_booster_pity p where p.user_id = me and p.type_id = t.id), 0));
end $function$;

-- ---------------------------------------------------------------------
-- 5. Vue membre : corps de 069, plus excluded_rarities et excluded_sets
-- ---------------------------------------------------------------------
create or replace function public.hg_booster_types_me()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me uuid := auth.uid();
  c jsonb := hg_card_cfg();
  w hg_wallets;
  hrs numeric;
  arr jsonb;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  insert into hg_wallets(user_id) values (me) on conflict do nothing;
  select * into w from hg_wallets where user_id = me;
  hrs := coalesce((c->>'free_booster_hours')::numeric, 24);
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'name', t.name, 'price', t.price, 'size', t.size, 'rates', t.rates,
      'shiny_rate', t.shiny_rate, 'pity_epique', t.pity_epique, 'pool', t.pool,
      'weekly_limit', t.weekly_limit, 'free_daily', t.free_daily, 'style', t.style,
      'description', t.description, 'sort', t.sort, 'active', t.active,
      'excluded_rarities', to_jsonb(t.excluded_rarities), 'excluded_sets', to_jsonb(t.excluded_sets),
      'stock', coalesce(s.qty, 0),
      'pity_count', coalesce(p.count, 0),
      'bought_week', b.qty,
      'remaining_week', case when t.weekly_limit is null then null else greatest(t.weekly_limit - b.qty, 0) end
    ) order by t.sort), '[]'::jsonb) into arr
    from public.hg_booster_types t
    left join public.hg_booster_stock s on s.user_id = me and s.type_id = t.id
    left join public.hg_booster_pity p on p.user_id = me and p.type_id = t.id
    join lateral (
      select coalesce(sum(x.qty), 0)::int as qty
        from public.hg_booster_purchases x
       where x.user_id = me and x.type_id = t.id and x.created_at >= hg_booster_week_start()
    ) b on true
   where t.active or coalesce(s.qty, 0) > 0;
  return jsonb_build_object(
    'types', arr,
    'free_booster_at', case when w.last_free_booster is null then now()
                            else w.last_free_booster + make_interval(secs => hrs * 3600) end,
    'week_ends_at', hg_booster_week_start(now() + interval '7 days'));
end $function$;

-- ---------------------------------------------------------------------
-- 6. RPC admin (hg_has_perm('cartes'))
-- ---------------------------------------------------------------------
-- Lecture d'un nombre envoyé par le front : nombre JSON ou texte numérique ; null sinon.
create or replace function public.hg_booster_num(v jsonb)
returns numeric
language plpgsql
immutable
set search_path to 'public'
as $$
begin
  if v is null then return null; end if;
  if jsonb_typeof(v) = 'number' then return (v #>> '{}')::numeric; end if;
  if jsonb_typeof(v) = 'string' and btrim(v #>> '{}') ~ '^-?[0-9]+([.,][0-9]+)?$' then
    return replace(btrim(v #>> '{}'), ',', '.')::numeric;
  end if;
  return null;
end $$;

-- Création ou modification d'un type. p : objet JSON.
--   Création : p.create = true, p.id obligatoire (slug [a-z0-9_]{2,30}, libre), p.name, p.price, p.rates obligatoires.
--   Modification : p.id existant ; seuls les champs présents sont changés (les autres gardent leur valeur).
--   L'id ne change jamais (immuable). Pas de suppression : active = false.
create or replace function public.hg_booster_type_save(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  keys text[] := array['commune','peu_commune','rare','epique','legendaire','mythique','identite'];
  styles text[] := array['cart--classique','cart--serie','cart--argente','cart--dore','cart--diamant',
                         'cart--quitte','cart--holo','cart--collection','cart--identite'];
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

-- Statistiques par type (ventes sur 7 jours, 30 jours, total ; ouvertures ; stock détenu ; dons).
-- Ventes : hg_booster_purchases (achats en Paillettes ; le mode sans limite n'y est pas). Ouvertures : hg_booster_opens
-- (depuis 071 seulement). Dons : hg_booster_gifts (entre membres).
create or replace function public.hg_booster_type_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  d7 timestamptz := now() - interval '7 days';
  d30 timestamptz := now() - interval '30 days';
  arr jsonb;
begin
  if not public.hg_has_perm('cartes') then raise exception 'Réservé à l''admin et au Staff « cartes »'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'name', t.name, 'style', t.style, 'price', t.price, 'active', t.active, 'sort', t.sort,
      'sales', jsonb_build_object(
        'd7', jsonb_build_object('boosters', s.b7, 'paillettes', s.p7),
        'd30', jsonb_build_object('boosters', s.b30, 'paillettes', s.p30),
        'total', jsonb_build_object('boosters', s.bt, 'paillettes', s.pt)),
      'opens', jsonb_build_object('d7', o.o7, 'd30', o.o30, 'total', o.ot, 'cards', o.cards, 'refund', o.refund),
      'stock', jsonb_build_object('total', st.qty, 'holders', st.holders),
      'gifts', jsonb_build_object('d7', g.g7, 'd30', g.g30, 'total', g.gt, 'count', g.gc)
    ) order by t.sort, t.id), '[]'::jsonb) into arr
    from hg_booster_types t
    join lateral (
      select coalesce(sum(x.qty) filter (where x.created_at >= d7), 0)::int as b7,
             coalesce(sum(x.cost) filter (where x.created_at >= d7), 0)::bigint as p7,
             coalesce(sum(x.qty) filter (where x.created_at >= d30), 0)::int as b30,
             coalesce(sum(x.cost) filter (where x.created_at >= d30), 0)::bigint as p30,
             coalesce(sum(x.qty), 0)::int as bt,
             coalesce(sum(x.cost), 0)::bigint as pt
        from hg_booster_purchases x where x.type_id = t.id) s on true
    join lateral (
      select (count(*) filter (where y.created_at >= d7))::int as o7,
             (count(*) filter (where y.created_at >= d30))::int as o30,
             count(*)::int as ot,
             coalesce(sum(y.cards), 0)::int as cards,
             coalesce(sum(y.refund), 0)::bigint as refund
        from hg_booster_opens y where y.type_id = t.id) o on true
    join lateral (
      select coalesce(sum(z.qty), 0)::int as qty, (count(*) filter (where z.qty > 0))::int as holders
        from hg_booster_stock z where z.type_id = t.id) st on true
    join lateral (
      select coalesce(sum(q.qty) filter (where q.created_at >= d7), 0)::int as g7,
             coalesce(sum(q.qty) filter (where q.created_at >= d30), 0)::int as g30,
             coalesce(sum(q.qty), 0)::int as gt,
             count(*)::int as gc
        from hg_booster_gifts q where q.type_id = t.id) g on true;
  return jsonb_build_object('types', arr, 'generated_at', now(),
    'opens_since', (select min(created_at) from hg_booster_opens));
end $function$;

-- ---------------------------------------------------------------------
-- 7. Droits
-- ---------------------------------------------------------------------
revoke all on function public.hg_booster_pick_one(text, uuid, uuid, boolean, uuid[], text[]),
  public.hg_booster_draw(text, text, uuid, uuid, uuid[], boolean, boolean),
  public.hg_booster_num(jsonb)
  from public, anon, authenticated;

revoke all on function public.hg_booster_open(text, text, text, uuid), public.hg_booster_types_me(),
  public.hg_booster_type_save(jsonb), public.hg_booster_type_stats()
  from public, anon;
grant execute on function public.hg_booster_open(text, text, text, uuid), public.hg_booster_types_me(),
  public.hg_booster_type_save(jsonb), public.hg_booster_type_stats()
  to authenticated;
