-- ===== Humane Gang — migration 162 : booster gratuit du jour selon le thème =====
-- Pendant un thème (ex. Raclette), le booster gratuit du jour peut être celui du thème (hg_themes.free_booster)
-- au lieu du type réglé dans l'admin (hg_booster_types.free_daily, repli). Un booster de thème reste ouvrable
-- gratuitement même s'il n'est pas en vente (active = false) ; il n'apparaît pas à la vente pour autant.
-- Le thème du jour (hg_theme_du_jour) suit la règle de site/assets/commun/core/theme-calc.js (pickTheme) :
-- réglage forcé, sinon thème actif dont la plage contient la date (priorité, puis plage la plus courte, puis nom),
-- sinon le thème par défaut. Pâques : plage recalculée (de 7 jours avant le dimanche de Pâques au lundi de Pâques).
-- Pas de clause de suppression sur la clé étrangère : aucun type n'est retiré de la base (il se désactive).

alter table public.hg_themes add column if not exists free_booster text references public.hg_booster_types(id) on update cascade;
comment on column public.hg_themes.free_booster is 'Booster gratuit du jour pendant ce thème (null = règle normale : le type free_daily). Migration 162.';

-- « MM-DD » valide (même règle que isValidMd dans theme-calc.js, 29 février compris).
create or replace function public.hg_theme_md_valid(p_md text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(case when p_md ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
                       then substr(p_md, 4, 2)::int <= (array[31,29,31,30,31,30,31,31,30,31,30,31])[substr(p_md, 1, 2)::int]
                       else false end, false);
$$;

-- Numéro du jour dans l'année (1 à 366) pour un « MM-DD » valide, base du calcul de la longueur d'une plage.
create or replace function public.hg_theme_md_jour(p_md text)
returns int language sql immutable set search_path = public as $$
  select (array[0,31,60,91,121,152,182,213,244,274,305,335])[substr(p_md, 1, 2)::int] + substr(p_md, 4, 2)::int;
$$;

-- Thème du jour (slug), pour une date donnée (par défaut : aujourd'hui, fuseau de Zurich).
-- Même règle que pickTheme (theme-calc.js) : réglage « forcé » s'il existe, sinon thème actif non par défaut dont la
-- plage contient la date (priorité décroissante, plage la plus courte, nom), sinon le thème par défaut.
create or replace function public.hg_theme_du_jour(p_date date default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  d date := coalesce(p_date, (now() at time zone 'Europe/Zurich')::date);
  md text := to_char(d, 'MM-DD');
  reglage jsonb := coalesce((select value from hg_settings where key = 'theme'), '{}'::jsonb);
  forced text := coalesce(reglage->>'forced_slug', reglage->>'forced');
  y int := extract(year from d)::int;
  a int; b int; c int; dd int; e int; f int; g int; h int; i int; k int; l int; m int; mois int; jour int;
  eas date;
  res text;
begin
  if reglage->>'mode' = 'forced' and forced is not null
     and exists (select 1 from hg_themes t where t.slug = forced) then
    return forced;
  end if;
  -- Dimanche de Pâques (Meeus / Jones / Butcher), comme easterSunday() dans theme-calc.js.
  a := y % 19; b := y / 100; c := y % 100; dd := b / 4; e := b % 4; f := (b + 8) / 25;
  g := (b - f + 1) / 3; h := (19 * a + b - dd - g + 15) % 30; i := c / 4; k := c % 4;
  l := (32 + 2 * e + 2 * i - h - k) % 7; m := (a + 11 * h + 22 * l) / 451;
  mois := (h + l - 7 * m + 114) / 31; jour := ((h + l - 7 * m + 114) % 31) + 1;
  eas := make_date(y, mois, jour);
  select th.slug into res
    from (
      select t.slug, t.name, t.priority,
             case when t.slug = 'paques' then to_char(eas - 7, 'MM-DD') else t.start_md end as s,
             case when t.slug = 'paques' then to_char(eas + 1, 'MM-DD') else t.end_md end as en
        from hg_themes t
       where t.active and not t.is_default
    ) th
   where hg_theme_md_valid(th.s) and hg_theme_md_valid(th.en)
     and (case when th.s <= th.en then md >= th.s and md <= th.en else md >= th.s or md <= th.en end)
   order by coalesce(th.priority, 0) desc,
            case when hg_theme_md_jour(th.en) >= hg_theme_md_jour(th.s)
                 then hg_theme_md_jour(th.en) - hg_theme_md_jour(th.s)
                 else 366 - hg_theme_md_jour(th.s) + hg_theme_md_jour(th.en) end,
            th.name, th.slug
   limit 1;
  if res is not null then return res; end if;
  return coalesce((select t.slug from hg_themes t where t.is_default limit 1), 'classique');
end $$;

-- Type du booster gratuit d'aujourd'hui : celui du thème du jour (hg_themes.free_booster) s'il est réglé,
-- sinon le type marqué « gratuit chaque jour » dans l'admin (free_daily), sinon le classique.
create or replace function public.hg_free_booster_type()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
begin
  select th.free_booster into v_type
    from hg_themes th
    join hg_booster_types bt on bt.id = th.free_booster
   where th.slug = hg_theme_du_jour();
  if v_type is not null then return v_type; end if;
  select bt.id into v_type from hg_booster_types bt where bt.free_daily limit 1;
  return coalesce(v_type, 'classique');
end $$;

-- Ouverture : + contrôle de vente (mode achat), série unique (only_set), séries réservées refusées au choix « Série »,
-- finition des brillantes (shiny_style -> finish).
create or replace function public.hg_booster_open(p_type text, p_mode text, p_request text default null, p_set uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
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
  fin text;
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
  -- 162 : le booster gratuit du thème du jour reste ouvrable en gratuit même hors vente.
  if p_mode <> 'stock' and not t.active
     and not (p_mode = 'gratuit' and t.id = hg_free_booster_type()) then
    raise exception 'Ce booster n''est plus en vente';
  end if;
  if p_mode = 'achat' then perform hg_booster_sale_check(t.id, me, 1, god); end if;
  if t.pool = 'serie' then
    if p_set is null then raise exception 'Choisis une série'; end if;
    if not exists (
         select 1 from hg_card_sets s where s.id = p_set and s.active and s.booster_scope is null
            and (s.starts_at is null or s.starts_at <= now())
            and (s.ends_at is null or s.ends_at > now())) then
      raise exception 'Cette série n''est pas disponible';
    end if;
    if exists (select 1 from hg_card_sets s where s.id = p_set and s.code = any(t.excluded_sets)) then
      raise exception 'Cette série n''est pas disponible pour ce booster';
    end if;
    sel_set := p_set;
  elsif t.only_set is not null then
    select s.id into sel_set from hg_card_sets s where s.code = t.only_set;
    if sel_set is null then raise exception 'La série de ce booster n''existe plus'; end if;
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
    -- 162 : le gratuit du jour est le type du thème (hg_free_booster_type), sinon le type free_daily.
    if t.id is distinct from hg_free_booster_type() then raise exception 'Ce booster ne s''ouvre pas gratuitement'; end if;
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
    -- Finition (C3) : seulement sur une vraie brillante (hg_card_give respecte can_shiny).
    if t.shiny_style is not null then
      update hg_card_copies set finish = t.shiny_style where id = cp and shiny;
    end if;
    select * into k from hg_cards where id = cid;
    best := greatest(best, hg_card_rank(k.rarity));
    select x.finish into fin from hg_card_copies x where x.id = cp;
    out := out || jsonb_build_object('copy_id', cp, 'card_id', k.id, 'name', k.name, 'rarity', k.rarity,
      'family', k.family, 'image_url', k.image_url, 'flavor', k.flavor, 'number', k.number,
      'shiny', (select x.shiny from hg_card_copies x where x.id = cp),
      'serial', (select x.serial from hg_card_copies x where x.id = cp), 'max_copies', k.max_copies,
      'finish', fin);
    if hg_card_rank(k.rarity) >= 5 then
      insert into hg_activity(user_id, kind, text)
        select me, 'cartes', p.pseudo || ' a obtenu « ' || k.name || ' » (' || replace(k.rarity, '_', ' ') || ') !'
          from hg_profiles p where p.id = me;
    end if;
  end loop;

  if jsonb_array_length(out) = 0 then raise exception 'Aucune carte n''est disponible pour le moment'; end if;

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
end $$;

-- Types du membre : + fenêtre, plage horaire, limite par soirée, série unique, style des brillantes.
-- Un type hors de sa fenêtre de vente n'est renvoyé que si le membre en a en stock (on_shelf = false).
create or replace function public.hg_booster_types_me()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  c jsonb := hg_card_cfg();
  w hg_wallets;
  hrs numeric;
  arr jsonb;
  free_id text := hg_free_booster_type();
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  insert into hg_wallets(user_id) values (me) on conflict do nothing;
  select * into w from hg_wallets where user_id = me;
  hrs := coalesce((c->>'free_booster_hours')::numeric, 24);
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'name', t.name, 'price', t.price, 'size', t.size, 'rates', t.rates,
      'shiny_rate', t.shiny_rate, 'pity_epique', t.pity_epique, 'pool', t.pool,
      'weekly_limit', t.weekly_limit, 'free_daily', (t.id = free_id), 'free_only', (t.id = free_id and not t.active),
      'style', t.style,
      'description', t.description, 'sort', t.sort, 'active', t.active,
      'excluded_rarities', to_jsonb(t.excluded_rarities), 'excluded_sets', to_jsonb(t.excluded_sets),
      'stock', coalesce(s.qty, 0),
      'pity_count', coalesce(p.count, 0),
      'bought_week', b.qty,
      'remaining_week', case when t.weekly_limit is null then null else greatest(t.weekly_limit - b.qty, 0) end,
      'available_from', t.available_from, 'available_until', t.available_until,
      'only_set', t.only_set, 'only_set_name', os.name,
      'schedule', t.schedule, 'per_window_limit', t.per_window_limit, 'shiny_style', t.shiny_style,
      'on_shelf', sh.on_shelf,
      'open_now', sh.on_shelf and coalesce(sc.open_now, true),
      'opens_at', sc.next_open, 'closes_at', sc.closes_at,
      'bought_window', bw.qty,
      'remaining_window', case when t.per_window_limit is null or not coalesce(sc.open_now, false) then null
                               else greatest(t.per_window_limit - bw.qty, 0) end
    ) order by t.sort), '[]'::jsonb) into arr
    from public.hg_booster_types t
    left join public.hg_booster_stock s on s.user_id = me and s.type_id = t.id
    left join public.hg_booster_pity p on p.user_id = me and p.type_id = t.id
    left join public.hg_card_sets os on os.code = t.only_set
    join lateral (
      select t.active and (t.available_from is null or t.available_from <= now())
             and (t.available_until is null or t.available_until > now()) as on_shelf
    ) sh on true
    left join lateral (select * from public.hg_booster_sched(t.schedule) where t.schedule is not null) sc on true
    join lateral (
      select coalesce(sum(x.qty), 0)::int as qty
        from public.hg_booster_purchases x
       where x.user_id = me and x.type_id = t.id and x.created_at >= hg_booster_week_start()
    ) b on true
    join lateral (
      select coalesce(sum(x.qty), 0)::int as qty
        from public.hg_booster_purchases x
       where x.user_id = me and x.type_id = t.id and sc.opened_at is not null and x.created_at >= sc.opened_at
    ) bw on true
   -- 162 : le gratuit du jour figure toujours (free_only si hors vente) ; il ne sera pas vendu (on_shelf faux).
   where sh.on_shelf or coalesce(s.qty, 0) > 0 or t.id = free_id;
  return jsonb_build_object(
    'types', arr,
    'free_booster_at', case when w.last_free_booster is null then now()
                            else w.last_free_booster + make_interval(secs => hrs * 3600) end,
    'week_ends_at', hg_booster_week_start(now() + interval '7 days'));
end $$;

-- Droits : fonctions de calcul réservées au serveur (appelées par les RPC du booster, définer).
revoke all on function public.hg_theme_md_valid(text), public.hg_theme_md_jour(text),
  public.hg_theme_du_jour(date), public.hg_free_booster_type() from public, anon, authenticated;

-- Thème de la Raclette : son booster gratuit est le booster Raclette (type « raclette », hors vente).
update public.hg_themes set free_booster = 'raclette' where slug = 'raclette';

-- ===== Tests (à lancer après application ; bloc commenté) =====
-- do $t$
-- declare msg text := '';
-- begin
--   if hg_theme_du_jour(date '2027-02-10') is distinct from 'raclette' then msg := msg || ' raclette_10fev'; end if;
--   if hg_theme_du_jour(date '2027-03-21') is distinct from 'paques' then msg := msg || ' paques_debut'; end if;
--   if hg_theme_du_jour(date '2027-03-28') is distinct from 'paques' then msg := msg || ' paques_dimanche'; end if;
--   if hg_theme_du_jour(date '2027-03-30') = 'paques' then msg := msg || ' paques_fin_trop_tard'; end if;
--   if hg_theme_md_valid('02-30') then msg := msg || ' md_30_fevrier'; end if;
--   if not hg_theme_md_valid('02-29') then msg := msg || ' md_29_fevrier'; end if;
--   raise exception 'TEST_RESULT %', coalesce(nullif(msg, ''), 'OK');
-- end $t$;
