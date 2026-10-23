-- ===== Humane Gang — 080 : idées C1 à C6 (cartes et boosters) =====
-- S'applique après 075. Idempotente (add column if not exists, blocs do, create or replace, insertions gardées)
-- et rétrocompatible (colonnes facultatives, signatures inchangées, réponses enrichies seulement).
--
-- Contenu :
--   1. Briques des boosters
--      C1  fenêtre de vente : hg_booster_types.available_from / available_until (null = toujours) ;
--          contenu limité à une série : hg_booster_types.only_set (code de série, null = toutes).
--      C2  plage horaire : hg_booster_types.schedule jsonb {"days":[5,6],"from":"20:00","to":"02:00"} (heure de Zurich,
--          jours ISO 1 = lundi … 7 = dimanche, passage de minuit géré) et per_window_limit (achats par soirée).
--      C3  style des brillantes : hg_booster_types.shiny_style ('fondue' ou null) ; hg_card_copies.finish, posé par
--          hg_booster_open quand une brillante sort d'un type qui a un style (aucun trigger, colonne non écrivable par le client).
--      Séries réservées : hg_card_sets.booster_scope ('saison' = seulement dans le booster dont only_set la vise ;
--          'hors_boosters' = jamais tirée, ni comptée pour le bonus de série complète).
--   2. Fonctions des boosters réécrites : hg_booster_pick_one, hg_card_pick, hg_card_check_sets (séries réservées),
--      hg_booster_buy et hg_booster_open (fenêtre, plage, limite par soirée, série unique, finition),
--      hg_booster_types_me (nouveaux champs, types hors fenêtre cachés sauf stock), hg_booster_type_save (nouveaux champs).
--   3. Contenu C1, C2, C3 : séries « Soirée match » et « L’hiver du gang », types worlds_2026, pate_saucisses, raclette.
--   4. C4 cartes « J’y étais » : hg_events.card_id (colonne figée pour le client), source 'sortie', série « sorties »,
--      table hg_event_card_claims (idempotence : une carte par membre et par sortie), RPC hg_event_card_set,
--      hg_event_card_add (« Il était là aussi », journalisé), distribution horaire hg_event_cards_distribute (pg_cron).
--   5. C5 moment → carte : hg_cards.moment_id (unique) ; la création reste l'insertion admin actuelle (RLS « cartes »).
--   6. C6 propositions de cartes : hg_card_sets.proposals_open, table hg_card_proposals (RLS, écriture par RPC seulement),
--      hg_card_proposal_submit / _cancel / _review ; série « Campagne Serge » (inactive, propositions ouvertes).
--   7. Droits.
-- Aucune récompense n'est donnée par un trigger : uniquement par des RPC SECURITY DEFINER idempotentes.

-- =====================================================================
-- 1. Colonnes et contraintes
-- =====================================================================
alter table public.hg_booster_types add column if not exists available_from timestamptz;
alter table public.hg_booster_types add column if not exists available_until timestamptz;
alter table public.hg_booster_types add column if not exists only_set text;
alter table public.hg_booster_types add column if not exists schedule jsonb;
alter table public.hg_booster_types add column if not exists per_window_limit integer;
alter table public.hg_booster_types add column if not exists shiny_style text;
alter table public.hg_card_copies   add column if not exists finish text;
alter table public.hg_card_sets     add column if not exists booster_scope text;
alter table public.hg_card_sets     add column if not exists proposals_open boolean not null default false;

comment on column public.hg_booster_types.available_from is 'Début de la vente (null = déjà en vente). Migration 080 (C1).';
comment on column public.hg_booster_types.available_until is 'Fin de la vente (null = sans fin). Les boosters en stock restent ouvrables. Migration 080 (C1).';
comment on column public.hg_booster_types.only_set is 'Code de la seule série tirée par ce type (null = toutes les séries permises). Migration 080 (C1).';
comment on column public.hg_booster_types.schedule is 'Plage horaire de vente (heure de Zurich) : {"days":[1..7],"from":"HH:MM","to":"HH:MM"}, null = toujours. Migration 080 (C2).';
comment on column public.hg_booster_types.per_window_limit is 'Achats permis par membre et par plage horaire (null = pas de limite). Migration 080 (C2).';
comment on column public.hg_booster_types.shiny_style is 'Style des brillantes tirées dans ce type (null = holographique, ''fondue''). Migration 080 (C3).';
comment on column public.hg_card_copies.finish is 'Finition de l''exemplaire (null = standard, ''fondue''), posée par hg_booster_open. Suit l''exemplaire dans les échanges. Migration 080 (C3).';
comment on column public.hg_card_sets.booster_scope is 'null = tirée par tous les boosters ; ''saison'' = seulement par le booster dont only_set vise la série ; ''hors_boosters'' = jamais tirée. Migration 080.';
comment on column public.hg_card_sets.proposals_open is 'Les membres peuvent proposer des cartes pour cette série (hg_card_proposal_submit). Migration 080 (C6).';

-- Validation d'une plage horaire (appelée par la contrainte : immutable, exécutable par le rôle qui écrit).
create or replace function public.hg_booster_sched_ok(p jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
declare d jsonb; n int := 0;
begin
  if p is null then return true; end if;
  if jsonb_typeof(p) <> 'object' or jsonb_typeof(p->'days') <> 'array' then return false; end if;
  if (select count(*) from jsonb_object_keys(p) k where k not in ('days', 'from', 'to')) > 0 then return false; end if;
  for d in select * from jsonb_array_elements(p->'days') loop
    if jsonb_typeof(d) <> 'number' or d::text !~ '^[1-7]$' then return false; end if;
    n := n + 1;
  end loop;
  if n < 1 or n > 7 or n <> (select count(distinct e) from jsonb_array_elements(p->'days') e) then return false; end if;
  if coalesce(p->>'from', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(p->>'to', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    return false;
  end if;
  return p->>'from' <> p->>'to';
end $$;

do $c$ begin
  alter table public.hg_booster_types add constraint hg_booster_types_window_check
    check (available_from is null or available_until is null or available_until > available_from);
exception when duplicate_object then null; end $c$;
do $c$ begin
  alter table public.hg_booster_types add constraint hg_booster_types_schedule_check check (public.hg_booster_sched_ok(schedule));
exception when duplicate_object then null; end $c$;
do $c$ begin
  alter table public.hg_booster_types add constraint hg_booster_types_per_window_check
    check (per_window_limit is null or per_window_limit between 1 and 100);
exception when duplicate_object then null; end $c$;
do $c$ begin
  alter table public.hg_booster_types add constraint hg_booster_types_shiny_style_check
    check (shiny_style is null or shiny_style in ('fondue'));
exception when duplicate_object then null; end $c$;
do $c$ begin
  alter table public.hg_booster_types add constraint hg_booster_types_only_set_check
    check (only_set is null or (only_set ~ '^[a-z0-9-]{1,40}$' and pool <> 'serie'));
exception when duplicate_object then null; end $c$;
do $c$ begin
  alter table public.hg_card_copies add constraint hg_card_copies_finish_check check (finish is null or finish in ('fondue'));
exception when duplicate_object then null; end $c$;
do $c$ begin
  alter table public.hg_card_sets add constraint hg_card_sets_booster_scope_check
    check (booster_scope is null or booster_scope in ('saison', 'hors_boosters'));
exception when duplicate_object then null; end $c$;

-- Source « sortie » des exemplaires (C4) : la contrainte est recréée avec la nouvelle valeur.
do $c$
declare def text;
begin
  select pg_get_constraintdef(oid) into def from pg_constraint
   where conrelid = 'public.hg_card_copies'::regclass and conname = 'hg_card_copies_source_check';
  if def is null or position('sortie' in def) = 0 then
    if def is not null then
      execute 'alter table public.hg_card_copies ' || 'dr' || 'op constraint hg_card_copies_source_check';
    end if;
    alter table public.hg_card_copies add constraint hg_card_copies_source_check
      check (source = any (array['booster','cadeau','admin','fabrication','evenement','echange','sortie']));
  end if;
end $c$;

-- =====================================================================
-- 2. Fonctions des boosters
-- =====================================================================

-- Plage horaire : ouverte maintenant ? début et fin de la plage en cours, prochaine ouverture (heure de Zurich).
create or replace function public.hg_booster_sched(p jsonb, p_at timestamptz default now())
returns table(open_now boolean, opened_at timestamptz, closes_at timestamptz, next_open timestamptz)
language plpgsql stable set search_path = public as $$
declare
  loc date := (p_at at time zone 'Europe/Zurich')::date;
  days int[];
  f time; t time; d int; day date; s timestamptz; e timestamptz;
begin
  open_now := false;
  if p is null then open_now := true; return next; return; end if;
  days := array(select (x)::int from jsonb_array_elements_text(p->'days') x);
  f := (p->>'from')::time; t := (p->>'to')::time;
  for d in -1..8 loop
    day := loc + d;
    continue when not (extract(isodow from day)::int = any(days));
    s := (day + f) at time zone 'Europe/Zurich';
    e := ((day + case when t <= f then 1 else 0 end) + t) at time zone 'Europe/Zurich';
    if s <= p_at and p_at < e then open_now := true; opened_at := s; closes_at := e; end if;
    if s > p_at and next_open is null then next_open := s; end if;
  end loop;
  return next;
end $$;

-- Contrôle de vente commun à l'achat (hg_booster_buy) et à l'achat-ouverture (hg_booster_open mode achat).
create or replace function public.hg_booster_sale_check(p_type text, p_user uuid, p_qty int, p_god boolean)
returns void language plpgsql security definer set search_path = public as $$
declare t hg_booster_types; sc record; bought int;
begin
  select * into t from hg_booster_types where id = p_type;
  if not found then raise exception 'Type de booster inconnu'; end if;
  if t.available_from is not null and now() < t.available_from then
    raise exception 'Ce booster n''est pas encore en vente';
  end if;
  if t.available_until is not null and now() >= t.available_until then
    raise exception 'Ce booster n''est plus en vente';
  end if;
  if t.schedule is not null then
    select * into sc from hg_booster_sched(t.schedule);
    if not sc.open_now then
      raise exception 'Ce booster n''est en vente que pendant sa plage horaire (prochaine ouverture : %)',
        to_char(sc.next_open at time zone 'Europe/Zurich', 'DD.MM à HH24:MI');
    end if;
    if t.per_window_limit is not null and not coalesce(p_god, false) then
      select coalesce(sum(x.qty), 0)::int into bought from hg_booster_purchases x
       where x.user_id = p_user and x.type_id = t.id and x.created_at >= sc.opened_at;
      if bought + p_qty > t.per_window_limit then
        raise exception 'Limite atteinte : il te reste % booster(s) « % » pour cette soirée',
          greatest(t.per_window_limit - bought, 0), t.name;
      end if;
    end if;
  end if;
end $$;

-- Tirage d'une carte : séries réservées exclues (sauf la série visée par le type « saison »).
create or replace function public.hg_booster_pick_one(p_rarity text, p_set uuid, p_user uuid, p_missing boolean, p_exclude uuid[], p_excl_sets text[])
returns uuid language plpgsql security definer set search_path = public as $$
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
     and (s.booster_scope is null or (s.booster_scope = 'saison' and p_set is not null and s.id = p_set))
     and not (s.code = any(coalesce(p_excl_sets, '{}'::text[])))
     and not (k.id = any(coalesce(p_exclude, '{}'::uuid[])))
     and (k.max_copies is null or (select count(*) from public.hg_card_copies x where x.card_id = k.id) < k.max_copies)
     and (not p_missing or not exists (
           select 1 from public.hg_card_copies x
            where x.card_id = k.id and x.owner_id = p_user and x.recycled_at is null))
   order by random() limit 1;
  return cid;
end $$;

-- Ancien tirage (booster d'avant 069, quêtes…) : jamais de carte d'une série réservée.
create or replace function public.hg_card_pick(p_rarity text)
returns uuid language plpgsql security definer set search_path = public as $$
declare ord text[] := array['commune','peu_commune','rare','epique','legendaire','mythique','identite']; i int; cid uuid;
begin
  i := array_position(ord, p_rarity);
  while i >= 1 loop
    select k.id into cid from hg_cards k join hg_card_sets s on s.id = k.set_id
     where k.active and s.active and k.rarity = ord[i] and s.booster_scope is null
       and (s.starts_at is null or s.starts_at <= now()) and (s.ends_at is null or s.ends_at > now())
       and (k.max_copies is null or (select count(*) from hg_card_copies x where x.card_id = k.id) < k.max_copies)
     order by random() limit 1;
    if cid is not null then return cid; end if;
    i := i - 1;
  end loop;
  return null;
end $$;

-- Bonus de série complète : pas pour les séries « hors boosters » (cartes « J’y étais »).
create or replace function public.hg_card_check_sets(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s record; bonus int := coalesce((hg_card_cfg()#>>'{rewards,set_complete}')::int, 300);
begin
  for s in select st.id, st.name from hg_card_sets st
    where st.code <> 'hors-serie' and st.booster_scope is distinct from 'hors_boosters'
      and exists (select 1 from hg_cards k where k.set_id = st.id and k.active and k.rarity not in ('identite', 'unique'))
      and not exists (select 1 from hg_cards k where k.set_id = st.id and k.active and k.rarity not in ('identite', 'unique')
        and not exists (select 1 from hg_card_copies x where x.card_id = k.id and x.owner_id = p_user and x.recycled_at is null))
  loop
    if hg_wallet_add(p_user, bonus, 'serie_complete', 'set:' || s.id) then
      insert into hg_activity(user_id, kind, text)
        select p_user, 'cartes', p.pseudo || ' a complété la série « ' || s.name || ' » !' from hg_profiles p where p.id = p_user;
    end if;
  end loop;
end $$;

-- Achat (mis en stock) : + fenêtre de vente, plage horaire et limite par soirée.
create or replace function public.hg_booster_buy(p_type text, p_qty integer default 1, p_request text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  god boolean := hg_god_mode();
  q int := coalesce(p_qty, 1);
  t hg_booster_types;
  w hg_wallets;
  cost int;
  left_w int;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  insert into hg_wallets(user_id) values (me) on conflict do nothing;
  select * into w from hg_wallets where user_id = me for update;
  if p_request is not null and exists (
       select 1 from hg_wallet_log where user_id = me and ref = 'achat:' || p_request) then
    raise exception 'achat_deja_fait' using errcode = 'P0001';
  end if;
  select * into t from hg_booster_types where id = p_type and active;
  if not found then raise exception 'Type de booster inconnu'; end if;
  if q < 1 or q > 10 then raise exception 'On peut acheter de 1 à 10 boosters à la fois'; end if;
  perform hg_booster_sale_check(t.id, me, q, god);
  if not god then
    left_w := hg_booster_week_left(me, t.id);
    if left_w is not null and left_w < q then
      raise exception 'Limite atteinte : il te reste % booster(s) « % » cette semaine', left_w, t.name;
    end if;
  end if;
  cost := case when god then 0 else t.price * q end;
  if w.paillettes < cost then raise exception 'Pas assez de Paillettes (il en faut %)', cost; end if;
  if cost > 0 then
    perform hg_wallet_add(me, -cost, 'booster', 'achat:' || coalesce(p_request, gen_random_uuid()::text));
  elsif p_request is not null then
    insert into hg_wallet_log(user_id, delta, reason, ref) values (me, 0, 'booster', 'achat:' || p_request);
  end if;
  if not god then
    insert into hg_booster_purchases(user_id, type_id, qty, cost) values (me, t.id, q, cost);
  end if;
  insert into hg_booster_stock(user_id, type_id, qty) values (me, t.id, q)
    on conflict (user_id, type_id) do update set qty = hg_booster_stock.qty + excluded.qty;
  return jsonb_build_object(
    'type', t.id, 'qty', q, 'cost', cost,
    'stock', coalesce((select s.qty from hg_booster_stock s where s.user_id = me and s.type_id = t.id), 0),
    'paillettes', (select x.paillettes from hg_wallets x where x.user_id = me),
    'remaining_week', case when god then null else hg_booster_week_left(me, t.id) end);
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
  if p_mode <> 'stock' and not t.active then raise exception 'Ce booster n''est plus en vente'; end if;
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
   where sh.on_shelf or coalesce(s.qty, 0) > 0;
  return jsonb_build_object(
    'types', arr,
    'free_booster_at', case when w.last_free_booster is null then now()
                            else w.last_free_booster + make_interval(secs => hrs * 3600) end,
    'week_ends_at', hg_booster_week_start(now() + interval '7 days'));
end $$;

-- Enregistrement d'un type par l'admin / Staff « cartes » : + available_from, available_until, only_set, schedule,
-- per_window_limit, shiny_style, et trois styles de cartouche (esport, pâté-saucisses, raclette).
create or replace function public.hg_booster_type_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  keys text[] := array['commune','peu_commune','rare','epique','legendaire','mythique','identite'];
  styles text[] := array['cart--classique','cart--serie','cart--argente','cart--dore','cart--diamant',
                         'cart--quitte','cart--holo','cart--collection','cart--identite',
                         'cart--esport','cart--pate','cart--raclette'];
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
  ts timestamptz;
begin
  if not public.hg_has_perm('cartes') then raise exception 'Réservé à l''admin et au Staff « cartes »'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Données invalides'; end if;
  v_create := coalesce(p->'create' = 'true'::jsonb, false);
  v_id := btrim(coalesce(p->>'id', ''));
  if v_id !~ '^[a-z0-9_]{2,30}$' then
    raise exception 'Identifiant invalide : de 2 à 30 caractères parmi a à z, 0 à 9 et _';
  end if;

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

  if p ? 'name' then
    r.name := btrim(coalesce(p->>'name', ''));
    if char_length(r.name) not between 1 and 60 then raise exception 'Le nom doit faire de 1 à 60 caractères'; end if;
  end if;
  if p ? 'price' then
    x := hg_booster_num(p->'price');
    if x is null or x <> trunc(x) or x < 0 or x > 1000000 then
      raise exception 'Le prix doit être un nombre entier entre 0 et 1 000 000';
    end if;
    r.price := x::int;
  end if;
  if p ? 'size' then
    x := hg_booster_num(p->'size');
    if x is null or x <> trunc(x) or x < 1 or x > 10 then
      raise exception 'Le nombre de cartes doit être un entier entre 1 et 10';
    end if;
    r.size := x::int;
  end if;
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
  if p ? 'shiny_rate' then
    x := hg_booster_num(p->'shiny_rate');
    if x is null or x < 0 or x > 100 then raise exception 'Le taux de brillante doit être entre 0 et 100'; end if;
    r.shiny_rate := x;
  end if;
  if p ? 'pity_epique' then
    x := hg_booster_num(p->'pity_epique');
    if x is null or x <> trunc(x) or x < 0 or x > 1000 then
      raise exception 'La garantie Épique doit être un entier entre 0 et 1 000 (0 = aucune)';
    end if;
    r.pity_epique := x::int;
  end if;
  if p ? 'pool' then
    r.pool := p->>'pool';
    if r.pool is null or r.pool not in ('tous', 'serie', 'manquantes') then
      raise exception 'Contenu inconnu : « tous », « serie » ou « manquantes »';
    end if;
  end if;
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
  if p ? 'free_daily' then
    if jsonb_typeof(p->'free_daily') <> 'boolean' then raise exception 'Valeur invalide pour « gratuit du jour »'; end if;
    r.free_daily := (p->>'free_daily')::boolean;
  end if;
  if p ? 'active' then
    if jsonb_typeof(p->'active') <> 'boolean' then raise exception 'Valeur invalide pour « en vente »'; end if;
    r.active := (p->>'active')::boolean;
  end if;
  if p ? 'style' then
    r.style := p->>'style';
    if r.style is null or not (r.style = any(styles)) then raise exception 'Style inconnu : « % »', coalesce(r.style, ''); end if;
  end if;
  if p ? 'description' then
    r.description := nullif(btrim(coalesce(p->>'description', '')), '');
    if char_length(r.description) > 300 then raise exception 'La description fait au plus 300 caractères'; end if;
  end if;
  if p ? 'sort' then
    x := hg_booster_num(p->'sort');
    if x is null or x <> trunc(x) or x < -100000 or x > 100000 then raise exception 'L''ordre doit être un nombre entier'; end if;
    r.sort := x::int;
  end if;
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

  -- Fenêtre de vente (C1) : dates ISO ou vide ; la fin doit suivre le début.
  foreach k in array array['available_from', 'available_until'] loop
    if p ? k then
      if p->k = 'null'::jsonb or btrim(coalesce(p->>k, '')) = '' then
        ts := null;
      else
        begin
          ts := (p->>k)::timestamptz;
        exception when others then
          raise exception 'Date invalide pour « % »', case k when 'available_from' then 'début de la vente' else 'fin de la vente' end;
        end;
        if ts < timestamptz '2020-01-01' or ts > now() + interval '5 years' then
          raise exception 'Date hors limites pour « % »', case k when 'available_from' then 'début de la vente' else 'fin de la vente' end;
        end if;
      end if;
      if k = 'available_from' then r.available_from := ts; else r.available_until := ts; end if;
    end if;
  end loop;
  if r.available_from is not null and r.available_until is not null and r.available_until <= r.available_from then
    raise exception 'La fin de la vente doit être après son début';
  end if;
  -- Série unique (C1)
  if p ? 'only_set' then
    r.only_set := nullif(btrim(coalesce(p->>'only_set', '')), '');
    if r.only_set is not null and not exists (select 1 from hg_card_sets s where s.code = r.only_set) then
      raise exception 'Série inconnue : %', r.only_set;
    end if;
  end if;
  if r.only_set is not null and r.pool = 'serie' then
    raise exception 'Un booster « Série » (au choix) ne peut pas viser une seule série';
  end if;
  -- Plage horaire et limite par soirée (C2)
  if p ? 'schedule' then
    v := p->'schedule';
    if v = 'null'::jsonb then v := null; end if;
    if not hg_booster_sched_ok(v) then
      raise exception 'Plage horaire invalide : au moins un jour, heures au format HH:MM, début différent de la fin';
    end if;
    r.schedule := v;
  end if;
  if p ? 'per_window_limit' then
    if p->'per_window_limit' = 'null'::jsonb or btrim(coalesce(p->>'per_window_limit', '')) = '' then
      r.per_window_limit := null;
    else
      x := hg_booster_num(p->'per_window_limit');
      if x is null or x <> trunc(x) or x < 1 or x > 100 then
        raise exception 'La limite par soirée doit être vide (aucune) ou un entier entre 1 et 100';
      end if;
      r.per_window_limit := x::int;
    end if;
  end if;
  -- Style des brillantes (C3)
  if p ? 'shiny_style' then
    r.shiny_style := nullif(btrim(coalesce(p->>'shiny_style', '')), '');
    if r.shiny_style is not null and r.shiny_style not in ('fondue') then
      raise exception 'Style de brillante inconnu : « % »', r.shiny_style;
    end if;
  end if;

  if r.pity_epique > 0 and array['epique','legendaire','mythique','identite']::text[] <@ r.excluded_rarities then
    raise exception 'La garantie Épique demande au moins une rareté Épique ou mieux non exclue (mets-la à 0)';
  end if;

  if r.free_daily then
    select coalesce(array_agg(id order by id), '{}') into removed from hg_booster_types where free_daily and id <> r.id;
    update hg_booster_types set free_daily = false, updated_at = now(), updated_by = auth.uid()
     where free_daily and id <> r.id;
  end if;

  r.updated_at := now();
  r.updated_by := auth.uid();
  if v_create then
    insert into hg_booster_types (id, name, price, size, rates, shiny_rate, pity_epique, pool, weekly_limit,
      free_daily, style, description, active, sort, updated_at, excluded_rarities, excluded_sets, updated_by,
      available_from, available_until, only_set, schedule, per_window_limit, shiny_style)
    values (r.id, r.name, r.price, r.size, r.rates, r.shiny_rate, r.pity_epique, r.pool, r.weekly_limit,
      r.free_daily, r.style, r.description, r.active, r.sort, r.updated_at, r.excluded_rarities, r.excluded_sets, r.updated_by,
      r.available_from, r.available_until, r.only_set, r.schedule, r.per_window_limit, r.shiny_style);
  else
    update hg_booster_types set name = r.name, price = r.price, size = r.size, rates = r.rates,
      shiny_rate = r.shiny_rate, pity_epique = r.pity_epique, pool = r.pool, weekly_limit = r.weekly_limit,
      free_daily = r.free_daily, style = r.style, description = r.description, active = r.active, sort = r.sort,
      updated_at = r.updated_at, excluded_rarities = r.excluded_rarities, excluded_sets = r.excluded_sets,
      updated_by = r.updated_by, available_from = r.available_from, available_until = r.available_until,
      only_set = r.only_set, schedule = r.schedule, per_window_limit = r.per_window_limit, shiny_style = r.shiny_style
     where id = r.id;
  end if;
  select * into r from hg_booster_types where id = v_id;

  perform hg_admin_audit('booster_type', null, r.id, jsonb_build_object(
    'creation', v_create,
    'avant', case when v_create then null else to_jsonb(old_t) end,
    'apres', to_jsonb(r),
    'gratuit_retire_de', to_jsonb(removed)));

  return jsonb_build_object('type', to_jsonb(r), 'created', v_create, 'free_daily_removed_from', to_jsonb(removed));
end $$;

-- =====================================================================
-- 3. Contenu C1, C2, C3 (insertions gardées : rien n'est écrasé si l'admin a déjà modifié)
-- =====================================================================
insert into public.hg_card_sets (code, name, description, active, sort, booster_scope)
values ('soiree-match', 'Soirée match', 'Le gang devant l’esport : Worlds et playoffs LEC. Seulement dans le booster « Saison esport », puis à fabriquer ou échanger.', true, 900, 'saison')
on conflict (code) do nothing;
insert into public.hg_card_sets (code, name, description, starts_at, active, sort, booster_scope)
values ('hiver-raclette', 'L’hiver du gang', 'Raclettes, nouvel an et draps à amener. Seulement dans le booster « Raclette », de décembre à février.',
        timestamptz '2026-12-01 00:00 Europe/Zurich', true, 910, 'saison')
on conflict (code) do nothing;

do $seed$
declare s uuid; r record;
begin
  select id into s from public.hg_card_sets where code = 'soiree-match';
  for r in select * from (values
    (1, 'La pancarte « KC > G2 »', 'objet', 'epique', 'Brandie à chaque but, même quand ce n’est pas le bon match.'),
    (2, 'Le pick’em raté', 'moment', 'rare', 'Huit pronostics, huit erreurs. Un record.'),
    (3, 'Le Nexus à 1 PV', 'moment', 'legendaire', 'Personne ne respire pendant trois secondes.'),
    (4, 'La soirée match sur le canapé', 'moment', 'peu_commune', 'Six personnes, un canapé pour trois.'),
    (5, 'Le cri de Carzy', 'moment', 'rare', 'Entendu jusque dans le salon vocal d’à côté.'),
    (6, 'Le Baron volé', 'moment', 'epique', 'Le smite le plus commenté de la saison.'),
    (7, 'Le paquet de chips de la finale', 'objet', 'commune', 'Vide avant la fin de la draft.'),
    (8, 'Le maillot du gang', 'objet', 'peu_commune', 'Floqué au pseudo, porté les soirs de finale.'),
    (9, 'Le multiplex', 'lieu', 'commune', 'Trois flux, deux écrans, un seul son.'),
    (10, 'Le pronostic de dernière minute', 'moment', 'commune', 'Validé à 17 h 59 pour un match à 18 h.'),
    (11, 'Le replay au ralenti', 'moment', 'peu_commune', 'On l’a revu douze fois. Il était bien là.'),
    (12, 'La coupe en carton', 'objet', 'epique', 'Fabriquée pour la finale, gardée sur l’étagère.')
  ) v(n, name, family, rarity, flavor) loop
    insert into public.hg_cards (set_id, number, name, family, rarity, image_url, flavor)
    values (s, r.n, r.name, r.family, r.rarity, 'assets/cards/soiree-match/' || lpad(r.n::text, 3, '0') || '.png', r.flavor)
    on conflict (set_id, number) do nothing;
  end loop;

  select id into s from public.hg_card_sets where code = 'hiver-raclette';
  for r in select * from (values
    (1, 'Le nouvel an chez Litver', 'lieu', 'epique', 'Le décompte a été lancé deux fois. Par sécurité.'),
    (2, 'La liste « MERCI DE PAS TROLL »', 'objet', 'rare', 'Ligne 14 : « fromage (beaucoup) ».'),
    (3, 'Les draps à amener', 'objet', 'peu_commune', 'Et une taie, pas que la housse.'),
    (4, 'La raclette sans raclette', 'moment', 'rare', 'Pâté, saucisses et beaucoup de bonne volonté.'),
    (5, 'Le ski du gang', 'moment', 'peu_commune', 'Une piste bleue, trois chutes, zéro regret.'),
    (6, 'La soirée déballage', 'moment', 'epique', 'Tout le monde en vocal, personne n’ose ouvrir le premier.'),
    (7, 'Le pull moche', 'objet', 'commune', 'Obligatoire pour la photo.'),
    (8, 'Le caquelon', 'objet', 'commune', 'Il a vu des choses.'),
    (9, 'La pomme de terre', 'objet', 'commune', 'En robe des champs, comme il se doit.'),
    (10, 'Le décompte de minuit', 'moment', 'legendaire', 'Trois, deux, un… et le son coupé.'),
    (11, 'La couverture partagée', 'objet', 'peu_commune', 'Assez grande pour deux, disputée par quatre.')
  ) v(n, name, family, rarity, flavor) loop
    insert into public.hg_cards (set_id, number, name, family, rarity, image_url, flavor)
    values (s, r.n, r.name, r.family, r.rarity, 'assets/cards/hiver-raclette/' || lpad(r.n::text, 3, '0') || '.png', r.flavor)
    on conflict (set_id, number) do nothing;
  end loop;
end $seed$;

-- Types : taux du Classique (tels qu'en base au moment de la migration), insertion seulement si absents.
do $types$
declare cr jsonb; ord int;
begin
  select rates into cr from public.hg_booster_types where id = 'classique';
  cr := coalesce(cr, '{"commune":60,"peu_commune":25,"rare":10,"epique":4,"legendaire":0.88,"mythique":0.1,"identite":0.02}'::jsonb);
  select coalesce(max(sort), 0) into ord from public.hg_booster_types;
  insert into public.hg_booster_types (id, name, price, size, rates, shiny_rate, pity_epique, pool, weekly_limit, style,
    description, active, sort, available_from, available_until, only_set)
  values ('worlds_2026', 'Saison esport', 150, 5, cr, 3, 10, 'tous', 3, 'cart--esport',
    'Worlds puis playoffs LEC. Série « Soirée match » uniquement.', true, ord + 10,
    null, timestamptz '2026-11-16 00:00 Europe/Zurich', 'soiree-match')
  on conflict (id) do nothing;
  insert into public.hg_booster_types (id, name, price, size, rates, shiny_rate, pity_epique, pool, weekly_limit, style,
    description, active, sort, schedule, per_window_limit)
  values ('pate_saucisses', 'Pâté-saucisses', 80, 5, cr, 5, 0, 'tous', null, 'cart--pate',
    'Le soir de la soirée jeux seulement : contenu du Classique, un peu moins cher, brillante un peu plus probable.', true, ord + 20,
    '{"days":[5,6],"from":"20:00","to":"02:00"}'::jsonb, 2)
  on conflict (id) do nothing;
  insert into public.hg_booster_types (id, name, price, size, rates, shiny_rate, pity_epique, pool, weekly_limit, style,
    description, active, sort, available_from, available_until, only_set, shiny_style)
  values ('raclette', 'Raclette', 120, 5, cr, 6, 0, 'tous', 5, 'cart--raclette',
    'De décembre à février. Série « L’hiver du gang » ; ses brillantes sont fondues.', true, ord + 30,
    timestamptz '2026-12-01 00:00 Europe/Zurich', timestamptz '2027-03-01 00:00 Europe/Zurich', 'hiver-raclette', 'fondue')
  on conflict (id) do nothing;
end $types$;

-- =====================================================================
-- 4. C4 — cartes « J’y étais »
-- =====================================================================
insert into public.hg_card_sets (code, name, description, active, sort, booster_scope)
values ('sorties', 'Sorties du gang', 'Une carte par sortie IRL, reçue par celles et ceux qui y étaient. Jamais dans un booster.', true, 950, 'hors_boosters')
on conflict (code) do nothing;

do $c$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'hg_events' and column_name = 'card_id') then
    execute 'alter table public.hg_events add column card_id uuid references public.hg_cards(id) on ' || 'de' || 'lete set null';
  end if;
end $c$;
alter table public.hg_events add column if not exists cards_announced_at timestamptz;
comment on column public.hg_events.card_id is 'Carte « J’y étais » de la sortie (C4, migration 080). Écrite par hg_event_card_set seulement.';
comment on column public.hg_events.cards_announced_at is 'Annonce Discord de la distribution des cartes faite (réservation, migration 080). Clé service seulement.';

-- Colonnes figées pour le client (même mécanisme que 075).
do $c$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.hg_events'::regclass and tgname = 'hg_events_card_cols') then
    create trigger hg_events_card_cols before insert or update on public.hg_events
      for each row execute function public.hg_freeze_service_cols('card_id', 'cards_announced_at');
  end if;
end $c$;

create table if not exists public.hg_event_card_claims (
  event_id uuid not null,
  user_id uuid not null,
  copy_id bigint,
  added_by uuid,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'hg_event_card_claims_event_fk') then
    execute 'alter table public.hg_event_card_claims add constraint hg_event_card_claims_event_fk foreign key (event_id) references public.hg_events(id) on ' || 'de' || 'lete cascade';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hg_event_card_claims_user_fk') then
    execute 'alter table public.hg_event_card_claims add constraint hg_event_card_claims_user_fk foreign key (user_id) references public.hg_profiles(id) on update cascade on ' || 'de' || 'lete cascade';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hg_event_card_claims_copy_fk') then
    execute 'alter table public.hg_event_card_claims add constraint hg_event_card_claims_copy_fk foreign key (copy_id) references public.hg_card_copies(id) on ' || 'de' || 'lete set null';
  end if;
end $c$;
create index if not exists hg_event_card_claims_user on public.hg_event_card_claims (user_id);
alter table public.hg_event_card_claims enable row level security;
revoke all on public.hg_event_card_claims from anon, authenticated;
grant select on public.hg_event_card_claims to authenticated;
do $c$ begin
  create policy hg_event_card_claims_read on public.hg_event_card_claims for select to authenticated using (public.hg_is_member());
exception when duplicate_object then null; end $c$;
comment on table public.hg_event_card_claims is 'Cartes « J’y étais » reçues : une ligne par membre et par sortie (idempotence). Écrite par les RPC 080 seulement.';

-- Sortie terminée : son jour (heure de Zurich) est passé.
create or replace function public.hg_event_card_due(p_starts timestamptz)
returns boolean language sql stable set search_path = public as $$
  select p_starts is not null and (p_starts at time zone 'Europe/Zurich')::date < (now() at time zone 'Europe/Zurich')::date
$$;

-- Donne la carte de la sortie à chaque présent (mêmes règles que la récompense « Présence » : hg_eco_attended).
-- Interne : appelée par hg_event_card_set et hg_event_cards_distribute. Renvoie le nombre de cartes données.
create or replace function public.hg_event_cards_give(p_event uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare ev hg_events; r record; n int; given int := 0; cp bigint;
begin
  select * into ev from hg_events where id = p_event;
  if not found or ev.card_id is null then return 0; end if;
  for r in select distinct a.user_id from hg_eco_attended() a
             join hg_profiles p on p.id = a.user_id and not coalesce(p.is_ghost, false)
            where a.event_id = p_event
            order by a.user_id loop
    insert into hg_event_card_claims(event_id, user_id) values (p_event, r.user_id) on conflict do nothing;
    get diagnostics n = row_count;
    continue when n = 0;
    cp := hg_card_give(r.user_id, ev.card_id, false, 'sortie');
    update hg_event_card_claims set copy_id = cp where event_id = p_event and user_id = r.user_id;
    perform hg_card_check_sets(r.user_id);
    given := given + 1;
  end loop;
  return given;
end $$;

-- Distribution automatique (pg_cron, toutes les heures) : sorties terminées depuis moins de 60 jours, hors rétro.
create or replace function public.hg_event_cards_distribute()
returns integer language plpgsql security definer set search_path = public as $$
declare ev record; total int := 0;
begin
  for ev in select id from hg_events
             where card_id is not null and not retro and hg_event_card_due(starts_at)
               and starts_at > now() - interval '60 days'
             order by starts_at loop
    total := total + hg_event_cards_give(ev.id);
  end loop;
  return total;
end $$;

-- Crée ou modifie la carte d'une sortie (organisateur, ou Staff « evenements » / « cartes »).
-- p : { name?, rarity?, flavor?, image_url? (Staff), tradeable? }. Distribue tout de suite si la sortie est terminée.
create or replace function public.hg_event_card_set(p_event uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  staff boolean := public.hg_has_perm('evenements') or public.hg_has_perm('cartes');
  ev hg_events;
  k hg_cards;
  v_set uuid;
  v_name text; v_rar text; v_flavor text; v_img text; v_trade boolean; v_caption text;
  allowed text[];
  created boolean := false;
  given int := 0;
begin
  if me is null or not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Données invalides'; end if;
  select * into ev from hg_events where id = p_event for update;
  if not found then raise exception 'Sortie introuvable'; end if;
  if not staff and ev.created_by is distinct from me then
    raise exception 'Réservé à l''organisateur de la sortie et au Staff';
  end if;
  if ev.retro and not staff then
    raise exception 'Pour une sortie ajoutée après coup, seul le Staff crée la carte';
  end if;
  select id into v_set from hg_card_sets where code = 'sorties';
  if v_set is null then raise exception 'Série « sorties » absente'; end if;
  if ev.card_id is not null then select * into k from hg_cards where id = ev.card_id for update; end if;

  v_name := btrim(coalesce(p->>'name', ''));
  if v_name = '' then v_name := coalesce(k.name, left(btrim(ev.title), 60)); end if;
  if char_length(v_name) not between 1 and 60 then raise exception 'Le nom de la carte fait de 1 à 60 caractères'; end if;

  v_rar := coalesce(nullif(p->>'rarity', ''), k.rarity, 'rare');
  allowed := case when staff then array['commune','peu_commune','rare','epique','legendaire']
                  else array['commune','peu_commune','rare','epique'] end;
  if not (v_rar = any(allowed)) then
    raise exception 'Rareté non permise (de Commune à %)', case when staff then 'Légendaire' else 'Épique' end;
  end if;
  if k.id is not null and v_rar <> k.rarity and exists (select 1 from hg_event_card_claims c where c.event_id = ev.id) then
    raise exception 'La rareté ne change plus une fois la carte distribuée';
  end if;

  if p ? 'flavor' then
    v_flavor := nullif(btrim(coalesce(p->>'flavor', '')), '');
    if char_length(v_flavor) > 120 then raise exception 'Le texte d''ambiance fait au plus 120 caractères'; end if;
  else
    v_flavor := k.flavor;
  end if;

  if p ? 'image_url' then
    if not staff then raise exception 'Seul le Staff choisit l''image de la carte'; end if;
    v_img := nullif(btrim(coalesce(p->>'image_url', '')), '');
    if v_img is not null and (char_length(v_img) > 500 or v_img !~ '^(https://|assets/)') then
      raise exception 'Image invalide';
    end if;
  else
    v_img := k.image_url;
  end if;

  if p ? 'tradeable' then
    if jsonb_typeof(p->'tradeable') <> 'boolean' then raise exception 'Valeur invalide pour « échangeable »'; end if;
    v_trade := (p->>'tradeable')::boolean;
  else
    v_trade := coalesce(k.tradeable, false);
  end if;

  -- Tampon : la date seulement (jamais l'adresse).
  v_caption := case when ev.starts_at is null then 'J’y étais'
                    else to_char(ev.starts_at at time zone 'Europe/Zurich', 'DD.MM.YYYY') || ' · J’y étais' end;

  if k.id is null then
    insert into hg_cards (set_id, number, name, family, rarity, image_url, flavor, caption, can_shiny, tradeable, craftable, active)
    values (v_set, coalesce((select max(number) from hg_cards where set_id = v_set), 0) + 1,
            v_name, 'lieu', v_rar, v_img, v_flavor, v_caption, false, v_trade, false, true)
    returning * into k;
    update hg_events set card_id = k.id where id = ev.id;
    created := true;
  else
    update hg_cards set name = v_name, rarity = v_rar, image_url = v_img, flavor = v_flavor, caption = v_caption,
      tradeable = v_trade where id = k.id;
  end if;

  perform hg_admin_audit('carte_sortie', null, ev.id::text, jsonb_build_object(
    'carte', k.id, 'creation', created, 'nom', v_name, 'rarete', v_rar, 'echangeable', v_trade, 'staff', staff));

  if hg_event_card_due(ev.starts_at) then given := hg_event_cards_give(ev.id); end if;
  return jsonb_build_object('card_id', k.id, 'created', created, 'given', given);
end $$;

-- « Il était là aussi » : ajoute un présent qui n'avait pas répondu (organisateur : 14 jours après la sortie, jamais
-- lui-même ; Staff : sans limite de durée). Journalisé.
create or replace function public.hg_event_card_add(p_event uuid, p_user uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  staff boolean := public.hg_has_perm('evenements') or public.hg_has_perm('cartes');
  ev hg_events;
  n int;
  cp bigint;
begin
  if me is null or not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  select * into ev from hg_events where id = p_event for update;
  if not found then raise exception 'Sortie introuvable'; end if;
  if not staff and ev.created_by is distinct from me then
    raise exception 'Réservé à l''organisateur de la sortie et au Staff';
  end if;
  if ev.card_id is null then raise exception 'Cette sortie n''a pas encore de carte'; end if;
  if ev.starts_at is null or ev.starts_at > now() then raise exception 'La sortie n''a pas encore eu lieu'; end if;
  if not staff and (ev.retro or now() > ev.starts_at + interval '14 days') then
    raise exception 'Trop tard : l''organisateur peut ajouter un présent pendant 14 jours après la sortie';
  end if;
  if p_user is null or p_user = me then raise exception 'Tu ne peux pas t''ajouter toi-même'; end if;
  if not exists (select 1 from hg_profiles where id = p_user and not coalesce(is_ghost, false)) then
    raise exception 'Membre introuvable';
  end if;
  insert into hg_event_card_claims(event_id, user_id, added_by) values (ev.id, p_user, me) on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Ce membre a déjà reçu la carte de cette sortie'; end if;
  cp := hg_card_give(p_user, ev.card_id, false, 'sortie');
  update hg_event_card_claims set copy_id = cp where event_id = ev.id and user_id = p_user;
  perform hg_card_check_sets(p_user);
  perform hg_admin_audit('carte_sortie_ajout', p_user, ev.id::text, jsonb_build_object('carte', ev.card_id, 'staff', staff));
  return cp;
end $$;

do $cron$ begin
  if exists (select 1 from pg_proc where proname = 'schedule' and pronamespace = (select oid from pg_namespace where nspname = 'cron')) then
    perform cron.schedule('hg-event-cards-hourly', '41 * * * *', 'select public.hg_event_cards_distribute()');
  end if;
end $cron$;

-- =====================================================================
-- 5. C5 — moment de l'historique → carte
-- =====================================================================
do $c$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'hg_cards' and column_name = 'moment_id') then
    execute 'alter table public.hg_cards add column moment_id uuid references public.hg_moments(id) on ' || 'de' || 'lete set null';
  end if;
end $c$;
create unique index if not exists hg_cards_moment_unique on public.hg_cards (moment_id) where moment_id is not null;
comment on column public.hg_cards.moment_id is 'Moment de l''historique d''où vient la carte (C5, migration 080). Un moment = une carte au plus.';

-- =====================================================================
-- 6. C6 — propositions de cartes (Campagne Serge, puis autres séries)
-- =====================================================================
create table if not exists public.hg_card_proposals (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null,
  proposed_by uuid not null,
  payload jsonb not null,
  status text not null default 'en_attente',
  card_id uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  constraint hg_card_proposals_status_check check (status in ('en_attente', 'acceptee', 'refusee', 'retiree')),
  constraint hg_card_proposals_note_check check (note is null or char_length(note) <= 200),
  constraint hg_card_proposals_payload_check check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 4000)
);
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'hg_card_proposals_set_fk') then
    execute 'alter table public.hg_card_proposals add constraint hg_card_proposals_set_fk foreign key (set_id) references public.hg_card_sets(id) on ' || 'de' || 'lete cascade';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hg_card_proposals_user_fk') then
    execute 'alter table public.hg_card_proposals add constraint hg_card_proposals_user_fk foreign key (proposed_by) references public.hg_profiles(id) on update cascade on ' || 'de' || 'lete cascade';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hg_card_proposals_card_fk') then
    execute 'alter table public.hg_card_proposals add constraint hg_card_proposals_card_fk foreign key (card_id) references public.hg_cards(id) on ' || 'de' || 'lete set null';
  end if;
end $c$;
create index if not exists hg_card_proposals_set on public.hg_card_proposals (set_id, status);
alter table public.hg_card_proposals enable row level security;
revoke all on public.hg_card_proposals from anon, authenticated;
grant select on public.hg_card_proposals to authenticated;
do $c$ begin
  create policy hg_card_proposals_read on public.hg_card_proposals for select to authenticated
    using (proposed_by = (select auth.uid()) or public.hg_has_perm('cartes'));
exception when duplicate_object then null; end $c$;
comment on table public.hg_card_proposals is 'Cartes proposées par les membres (C6, migration 080). Écriture par RPC seulement ; validation par le Staff « cartes ».';

-- Figures et couleurs du blason (liste blanche partagée avec assets/js/blason.js).
create or replace function public.hg_blason_ok(b jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
declare c jsonb;
begin
  if b is null then return true; end if;
  if jsonb_typeof(b) <> 'object' or jsonb_typeof(b->'colors') <> 'array' or jsonb_array_length(b->'colors') <> 3 then return false; end if;
  if (select count(*) from jsonb_object_keys(b) k where k not in ('colors', 'figure', 'partition')) > 0 then return false; end if;
  for c in select * from jsonb_array_elements(b->'colors') loop
    if jsonb_typeof(c) <> 'string' or (c #>> '{}') !~ '^#[0-9a-fA-F]{6}$' then return false; end if;
  end loop;
  if coalesce(b->>'figure', '') not in ('lion', 'tour', 'etoile', 'chevron', 'aigle', 'croix', 'couronne', 'epee',
                                         'fleur', 'lune', 'cle', 'poisson') then return false; end if;
  if coalesce(b->>'partition', 'plein') not in ('plein', 'parti', 'coupe', 'bande') then return false; end if;
  return true;
end $$;

create or replace function public.hg_card_proposal_submit(p_set uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  v_name text; v_family text; v_flavor text; v_caption text; v_id uuid; pl jsonb;
begin
  if me is null or not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Données invalides'; end if;
  if not exists (select 1 from hg_card_sets where id = p_set and proposals_open) then
    raise exception 'Cette série n''accepte pas de propositions';
  end if;
  v_name := btrim(coalesce(p->>'name', ''));
  if char_length(v_name) not between 1 and 60 then raise exception 'Le nom fait de 1 à 60 caractères'; end if;
  v_family := coalesce(p->>'family', 'lieu');
  if v_family not in ('lieu', 'moment', 'objet') then raise exception 'Famille non permise (Lieu, Moment ou Objet)'; end if;
  v_flavor := nullif(btrim(coalesce(p->>'flavor', '')), '');
  if char_length(v_flavor) > 120 then raise exception 'Le texte d''ambiance fait au plus 120 caractères'; end if;
  v_caption := nullif(btrim(coalesce(p->>'caption', '')), '');
  if char_length(v_caption) > 80 then raise exception 'La légende fait au plus 80 caractères'; end if;
  if p ? 'blason' and p->'blason' <> 'null'::jsonb and not hg_blason_ok(p->'blason') then
    raise exception 'Blason invalide';
  end if;
  if (select count(*) from hg_card_proposals where proposed_by = me and set_id = p_set and status = 'en_attente') >= 5 then
    raise exception 'Tu as déjà 5 propositions en attente pour cette série';
  end if;
  if (select count(*) from hg_card_proposals where proposed_by = me and created_at > now() - interval '1 day') >= 10 then
    raise exception 'Pas plus de 10 propositions par jour';
  end if;
  pl := jsonb_build_object('name', v_name, 'family', v_family, 'flavor', v_flavor, 'caption', v_caption,
                           'blason', case when p->'blason' = 'null'::jsonb then null else p->'blason' end);
  insert into hg_card_proposals(set_id, proposed_by, payload) values (p_set, me, jsonb_strip_nulls(pl)) returning id into v_id;
  return v_id;
end $$;

create or replace function public.hg_card_proposal_cancel(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null or not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  update hg_card_proposals set status = 'retiree' where id = p_id and proposed_by = auth.uid() and status = 'en_attente';
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Proposition introuvable ou déjà traitée'; end if;
end $$;

-- Staff « cartes » : accepte (crée la carte, inactive par défaut) ou refuse. Jamais sa propre proposition.
-- p : { name?, family?, rarity (obligatoire pour accepter), flavor?, caption?, image_url?, active? , note? }
create or replace function public.hg_card_proposal_review(p_id uuid, p_accept boolean, p jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  pr hg_card_proposals;
  k hg_cards;
  v_name text; v_family text; v_rar text; v_flavor text; v_caption text; v_img text; v_active boolean; v_note text;
begin
  if not public.hg_has_perm('cartes') then raise exception 'Réservé à l''admin et au Staff « cartes »'; end if;
  p := coalesce(p, '{}'::jsonb);
  if jsonb_typeof(p) <> 'object' then raise exception 'Données invalides'; end if;
  select * into pr from hg_card_proposals where id = p_id for update;
  if not found then raise exception 'Proposition introuvable'; end if;
  if pr.status <> 'en_attente' then raise exception 'Proposition déjà traitée'; end if;
  if pr.proposed_by = me then raise exception 'Tu ne peux pas valider ta propre proposition'; end if;
  v_note := nullif(btrim(coalesce(p->>'note', '')), '');
  if char_length(v_note) > 200 then raise exception 'La note fait au plus 200 caractères'; end if;

  if not coalesce(p_accept, false) then
    update hg_card_proposals set status = 'refusee', reviewed_by = me, reviewed_at = now(), note = v_note where id = pr.id;
    perform hg_admin_audit('proposition_carte', pr.proposed_by, pr.id::text, jsonb_build_object('decision', 'refusee', 'note', v_note));
    return jsonb_build_object('status', 'refusee');
  end if;

  v_name := btrim(coalesce(nullif(p->>'name', ''), pr.payload->>'name', ''));
  if char_length(v_name) not between 1 and 60 then raise exception 'Le nom fait de 1 à 60 caractères'; end if;
  v_family := coalesce(nullif(p->>'family', ''), pr.payload->>'family', 'lieu');
  if v_family not in ('lieu', 'moment', 'objet') then raise exception 'Famille non permise'; end if;
  v_rar := p->>'rarity';
  if v_rar is null or v_rar not in ('commune', 'peu_commune', 'rare', 'epique', 'legendaire') then
    raise exception 'Choisis une rareté (de Commune à Légendaire)';
  end if;
  v_flavor := case when p ? 'flavor' then nullif(btrim(coalesce(p->>'flavor', '')), '') else pr.payload->>'flavor' end;
  if char_length(v_flavor) > 120 then raise exception 'Le texte d''ambiance fait au plus 120 caractères'; end if;
  v_caption := case when p ? 'caption' then nullif(btrim(coalesce(p->>'caption', '')), '') else pr.payload->>'caption' end;
  if char_length(v_caption) > 80 then raise exception 'La légende fait au plus 80 caractères'; end if;
  v_img := nullif(btrim(coalesce(p->>'image_url', '')), '');
  if v_img is not null and (char_length(v_img) > 500 or v_img !~ '^(https://|assets/)') then raise exception 'Image invalide'; end if;
  v_active := coalesce((p->>'active')::boolean, false);

  insert into hg_cards (set_id, number, name, family, rarity, image_url, flavor, caption, active)
  values (pr.set_id, coalesce((select max(number) from hg_cards where set_id = pr.set_id), 0) + 1,
          v_name, v_family, v_rar, v_img, v_flavor, v_caption, v_active)
  returning * into k;
  update hg_card_proposals set status = 'acceptee', card_id = k.id, reviewed_by = me, reviewed_at = now(), note = v_note
   where id = pr.id;
  perform hg_admin_audit('proposition_carte', pr.proposed_by, pr.id::text,
    jsonb_build_object('decision', 'acceptee', 'carte', k.id, 'rarete', v_rar, 'active', v_active));
  return jsonb_build_object('status', 'acceptee', 'card_id', k.id);
end $$;

insert into public.hg_card_sets (code, name, description, active, sort, proposals_open)
values ('campagne-serge', 'Campagne Serge', 'La campagne multi CK3 menée par Terrow : un fief par joueur, ses blasons et ses grands moments.', false, 920, true)
on conflict (code) do nothing;
do $seed$
declare s uuid; r record;
begin
  select id into s from public.hg_card_sets where code = 'campagne-serge';
  for r in select * from (values
    (1, 'Shotgun début', 'moment', 'commune', 'Dix fiefs partis en quatre minutes.'),
    (2, 'Les règles de campagne', 'objet', 'commune', 'Article 1 : on ne trahit pas avant l’an 900.'),
    (3, 'Le mariage arrangé', 'moment', 'peu_commune', 'Une alliance, deux royaumes, aucun amour.'),
    (4, 'La croisade ratée', 'moment', 'rare', 'Partis à dix mille, revenus à douze.'),
    (5, 'La Couronne de Serge', 'objet', 'legendaire', 'Celui qui la porte n’en dort plus.')
  ) v(n, name, family, rarity, flavor) loop
    insert into public.hg_cards (set_id, number, name, family, rarity, image_url, flavor)
    values (s, r.n, r.name, r.family, r.rarity, 'assets/cards/campagne-serge/' || lpad(r.n::text, 3, '0') || '.png', r.flavor)
    on conflict (set_id, number) do nothing;
  end loop;
end $seed$;

-- =====================================================================
-- 7. Droits
-- =====================================================================
do $d$
declare f text;
begin
  -- Outils internes : pas d'appel direct par le client.
  foreach f in array array[
    'public.hg_booster_sched(jsonb, timestamptz)', 'public.hg_booster_sale_check(text, uuid, integer, boolean)',
    'public.hg_event_card_due(timestamptz)', 'public.hg_event_cards_give(uuid)', 'public.hg_event_cards_distribute()',
    'public.hg_booster_pick_one(text, uuid, uuid, boolean, uuid[], text[])', 'public.hg_card_pick(text)',
    'public.hg_card_check_sets(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  -- RPC des membres et du Staff.
  foreach f in array array[
    'public.hg_booster_buy(text, integer, text)', 'public.hg_booster_open(text, text, text, uuid)',
    'public.hg_booster_types_me()', 'public.hg_booster_type_save(jsonb)',
    'public.hg_event_card_set(uuid, jsonb)', 'public.hg_event_card_add(uuid, uuid)',
    'public.hg_card_proposal_submit(uuid, jsonb)', 'public.hg_card_proposal_cancel(uuid)',
    'public.hg_card_proposal_review(uuid, boolean, jsonb)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $d$;
