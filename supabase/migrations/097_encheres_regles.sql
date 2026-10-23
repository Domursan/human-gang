-- ===== Humane Gang — 097 : règles des enchères, réglables enchère par enchère =====
-- S'applique après 081 (enchères C11). Idempotente (add column if not exists, create or replace, bloc do).
-- Rétrocompatible : les valeurs par défaut reproduisent exactement les règles de 081 (plafond = moitié du solde du lundi,
-- prolongation de 5 minutes, une heure au plus, gagnant précédent exclu, pas de mise maximale, pas de limite d'offres).
--
-- Nouvelles colonnes de hg_card_auctions :
--   max_bid            mise maximale d'une offre (null = aucune)
--   cap_pct            plafond d'un membre en % de son solde du lundi (null = seulement son solde actuel)
--   extend_min         prolongation quand une offre arrive dans les N dernières minutes (0 = aucune)
--   extend_cap_min     prolongation totale au plus, en minutes (hard_end_at = fin + extend_cap_min)
--   max_bids_user      nombre d'offres par membre sur cette enchère (null = illimité)
--   block_last_winner  le gagnant de la dernière enchère ne peut pas enchérir
-- Nouvelle RPC : hg_auction_update(uuid, jsonb), Staff « cartes », journalisée (enchere_modifiee).
-- Les membres reçoivent les règles dans hg_auction_current (clé rules) et leur plafond effectif (me.cap, me.bids_left),
-- plus can_admin pour afficher le réglage depuis la page des enchères.
-- Clôture : tâche planifiée toutes les 5 minutes (hg-auctions-close) si pg_cron est présent.

alter table public.hg_card_auctions add column if not exists max_bid integer;
alter table public.hg_card_auctions add column if not exists cap_pct smallint default 50;
alter table public.hg_card_auctions add column if not exists extend_min smallint not null default 5;
alter table public.hg_card_auctions add column if not exists extend_cap_min smallint not null default 60;
alter table public.hg_card_auctions add column if not exists max_bids_user smallint;
alter table public.hg_card_auctions add column if not exists block_last_winner boolean not null default true;

do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'hg_card_auctions_rules_chk') then
    alter table public.hg_card_auctions add constraint hg_card_auctions_rules_chk check (
      (max_bid is null or max_bid between 1 and 1000000)
      and (cap_pct is null or cap_pct between 1 and 100)
      and extend_min between 0 and 60
      and extend_cap_min between 0 and 1440
      and (max_bids_user is null or max_bids_user between 1 and 1000));
  end if;
end $c$;

-- Lecture d'un entier facultatif d'un objet jsonb : null si absent ou vide, erreur si hors bornes. Fonction interne.
create or replace function public.hg_auction_opt_int(p jsonb, k text, lo integer, hi integer, label text)
returns integer
language plpgsql
immutable
set search_path to 'public'
as $$
declare v text := btrim(coalesce(p->>k, ''));
begin
  if v = '' then return null; end if;
  if v !~ '^\d{1,7}$' or v::int not between lo and hi then
    raise exception '% : de % à %', label, lo, hi;
  end if;
  return v::int;
end $$;

-- Plafond d'un membre pour une enchère : p_pct % de son solde du début de semaine (lundi, Zurich).
-- p_pct null : pas de plafond lié à la semaine (le solde actuel reste la seule limite). Fonction interne.
create or replace function public.hg_auction_cap(p_user uuid, p_pct integer)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when p_pct is null then 1000000 else
    greatest(0, (coalesce((select w.paillettes from hg_wallets w where w.user_id = p_user), 0)
      - coalesce((select sum(l.delta) from hg_wallet_log l where l.user_id = p_user and l.created_at >= hg_eco_week_start()), 0)) * p_pct / 100)::int
  end
$$;

-- Règles d'une enchère, telles qu'envoyées aux pages.
create or replace function public.hg_auction_rules_json(a public.hg_card_auctions)
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  select jsonb_build_object('min_bid', a.min_bid, 'step', a.step, 'max_bid', a.max_bid, 'cap_pct', a.cap_pct,
    'extend_min', a.extend_min, 'extend_cap_min', a.extend_cap_min, 'max_bids_user', a.max_bids_user,
    'block_last_winner', a.block_last_winner)
$$;

-- Membre : enchère en cours (ou la prochaine, ou la dernière close depuis 2 jours), 10 dernières offres, règles,
-- et pour moi : plafond effectif (plafond de semaine et mise maximale), offres restantes, gagnant de la précédente.
create or replace function public.hg_auction_current()
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare me uuid := auth.uid(); a hg_card_auctions; top hg_card_bids; last_win uuid; v_cap int; v_mine int;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  perform hg_auction_close();
  select * into a from hg_card_auctions where status in ('ouverte', 'prevue') order by (status = 'ouverte' or starts_at <= now()) desc, starts_at limit 1;
  if a.id is null then
    select * into a from hg_card_auctions where status = 'close' and closed_at > now() - interval '2 days' order by closed_at desc limit 1;
  end if;
  if a.id is null then return jsonb_build_object('auction', null, 'can_admin', hg_has_perm('cartes')); end if;
  select * into top from hg_card_bids where id = a.top_bid;
  select x.winner into last_win from hg_card_auctions x where x.status = 'close' and x.winner is not null and x.id <> a.id order by x.closed_at desc limit 1;
  v_cap := least(hg_auction_cap(me, a.cap_pct), coalesce(a.max_bid, 1000000), coalesce((select w.paillettes from hg_wallets w where w.user_id = me), 0));
  select count(*) into v_mine from hg_card_bids where auction_id = a.id and user_id = me;
  return jsonb_build_object(
    'can_admin', hg_has_perm('cartes'),
    'rules', hg_auction_rules_json(a),
    'auction', jsonb_build_object('id', a.id, 'status', case when a.status = 'prevue' and a.starts_at <= now() then 'ouverte' else a.status end,
      'starts_at', a.starts_at, 'ends_at', a.ends_at, 'hard_end_at', a.hard_end_at, 'min_bid', a.min_bid, 'step', a.step,
      'next_min', case when top.id is null then a.min_bid else top.amount + a.step end,
      'price', a.price, 'winner', (select p.pseudo from hg_profiles p where p.id = a.winner), 'won', a.winner = me,
      'card', (select jsonb_build_object('id', k.id, 'name', k.name, 'rarity', k.rarity, 'family', k.family, 'image_url', k.image_url,
                 'flavor', k.flavor, 'caption', k.caption, 'number', k.number, 'max_copies', k.max_copies, 'set_id', k.set_id)
               from hg_cards k where k.id = a.card_id),
      'top', case when top.id is null then null else jsonb_build_object('amount', top.amount, 'mine', top.user_id = me,
        'pseudo', (select p.pseudo from hg_profiles p where p.id = top.user_id),
        'avatar_url', (select p.avatar_url from hg_profiles p where p.id = top.user_id),
        'color', (select p.color from hg_profiles p where p.id = top.user_id)) end),
    'bids', (select coalesce(jsonb_agg(jsonb_build_object('amount', b.amount, 'created_at', b.created_at, 'mine', b.user_id = me,
               'pseudo', p.pseudo, 'avatar_url', p.avatar_url, 'color', p.color) order by b.created_at desc), '[]'::jsonb)
             from (select * from hg_card_bids where auction_id = a.id order by created_at desc limit 10) b
             left join hg_profiles p on p.id = b.user_id),
    'me', jsonb_build_object('cap', greatest(v_cap, 0), 'last_winner', a.block_last_winner and last_win = me,
      'bids', v_mine, 'bids_left', case when a.max_bids_user is null then null else greatest(a.max_bids_user - v_mine, 0) end,
      'balance', (select w.paillettes from hg_wallets w where w.user_id = me)));
end $$;

-- Membre : enchérit, selon les règles de l'enchère.
create or replace function public.hg_auction_bid(p_auction uuid, p_amount integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare me uuid := auth.uid(); a hg_card_auctions; top hg_card_bids; v_min int; v_cap int; bal int; v_bid bigint; last_win uuid;
  v_end timestamptz; v_mine int;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if p_amount is null or p_amount < 1 or p_amount > 1000000 then raise exception 'Montant invalide'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hg_auction:' || coalesce(p_auction::text, ''), 0));
  select * into a from hg_card_auctions where id = p_auction for update;
  if not found or a.status not in ('prevue', 'ouverte') or a.starts_at > now() then raise exception 'Cette enchère n’est pas ouverte'; end if;
  if a.ends_at <= now() then raise exception 'L’enchère est terminée'; end if;
  select * into top from hg_card_bids where id = a.top_bid;
  if top.user_id = me then raise exception 'Tu as déjà la meilleure offre'; end if;
  v_min := case when top.id is null then a.min_bid else top.amount + a.step end;
  if p_amount < v_min then raise exception 'L’offre minimale est de % Paillettes', v_min; end if;
  if a.max_bid is not null and p_amount > a.max_bid then raise exception 'Mise maximale de cette enchère : % Paillettes', a.max_bid; end if;
  if a.block_last_winner then
    select x.winner into last_win from hg_card_auctions x where x.status = 'close' and x.winner is not null and x.id <> a.id order by x.closed_at desc limit 1;
    if last_win = me then raise exception 'Tu as gagné la dernière enchère : laisse sa chance aux autres cette fois'; end if;
  end if;
  if a.max_bids_user is not null then
    select count(*) into v_mine from hg_card_bids where auction_id = a.id and user_id = me;
    if v_mine >= a.max_bids_user then raise exception 'Tu as fait le nombre maximal d’offres pour cette enchère (%)', a.max_bids_user; end if;
  end if;
  insert into hg_wallets(user_id) values (me) on conflict do nothing;
  perform 1 from hg_wallets where user_id in (me, top.user_id) order by user_id for update;
  select paillettes into bal from hg_wallets where user_id = me;
  if a.cap_pct is not null then
    v_cap := hg_auction_cap(me, a.cap_pct);
    if p_amount > v_cap then raise exception 'Plafond : % Paillettes (% %% de ton solde de lundi)', v_cap, a.cap_pct; end if;
  end if;
  if p_amount > bal then raise exception 'Pas assez de Paillettes (il en faut %)', p_amount; end if;
  insert into hg_card_bids(auction_id, user_id, amount) values (a.id, me, p_amount) returning id into v_bid;
  if not hg_wallet_add(me, -p_amount, 'enchere', 'bid:' || v_bid) then raise exception 'Offre déjà enregistrée'; end if;
  if top.id is not null then
    perform hg_wallet_add(top.user_id, top.amount, 'enchere_remboursee', 'bid:' || top.id);
    update hg_card_bids set refunded_at = now() where id = top.id;
  end if;
  v_end := a.ends_at;
  if a.extend_min > 0 and a.ends_at - now() < make_interval(mins => a.extend_min) then
    v_end := least(now() + make_interval(mins => a.extend_min), a.hard_end_at);
  end if;
  update hg_card_auctions set top_bid = v_bid, status = 'ouverte', ends_at = greatest(v_end, a.ends_at) where id = a.id;
  return jsonb_build_object('bid', v_bid, 'amount', p_amount, 'ends_at', greatest(v_end, a.ends_at),
    'outbid', case when top.id is null then null else top.user_id end);
end $$;

-- Staff « cartes » : planifie une enchère. p = { card_id, starts_at, ends_at, min_bid, step, max_bid?, cap_pct?,
-- extend_min?, extend_cap_min?, max_bids_user?, block_last_winner? } (absents : règles par défaut de 081).
create or replace function public.hg_auction_create(p jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare k hg_cards; v_start timestamptz; v_end timestamptz; v_min int; v_step int; v_id uuid;
  v_max int; v_pct int; v_ext int; v_extcap int; v_nb int; v_block boolean;
begin
  if not hg_has_perm('cartes') then raise exception 'Réservé au Staff « cartes »'; end if;
  select * into k from hg_cards where id = nullif(p->>'card_id', '')::uuid for update;
  if not found then raise exception 'Choisis une carte'; end if;
  if k.rarity <> 'unique' then raise exception 'Seule une carte unique peut être mise aux enchères'; end if;
  if k.member_id is not null or k.family = 'membre' then raise exception 'Une carte qui représente un membre ne se met pas aux enchères'; end if;
  if exists (select 1 from hg_card_copies x where x.card_id = k.id) then raise exception 'Cette carte unique a déjà été attribuée'; end if;
  if exists (select 1 from hg_card_auctions x where x.card_id = k.id and x.status in ('prevue', 'ouverte')) then raise exception 'Cette carte est déjà aux enchères'; end if;
  v_start := coalesce(nullif(p->>'starts_at', '')::timestamptz, now());
  v_end := nullif(p->>'ends_at', '')::timestamptz;
  if v_end is null then raise exception 'Indique la fin de l’enchère'; end if;
  if v_end <= greatest(v_start, now()) + interval '30 minutes' then raise exception 'L’enchère dure au moins 30 minutes'; end if;
  if v_end - v_start > interval '7 days' then raise exception 'L’enchère dure 7 jours au plus'; end if;
  if v_start > now() + interval '60 days' then raise exception 'Début : dans 60 jours au plus'; end if;
  v_min := hg_auction_opt_int(p, 'min_bid', 1, 100000, 'Mise de départ');
  v_step := hg_auction_opt_int(p, 'step', 1, 10000, 'Pas minimal');
  if v_min is null then raise exception 'Mise de départ : de 1 à 100 000'; end if;
  if v_step is null then raise exception 'Pas minimal : de 1 à 10 000'; end if;
  v_max := hg_auction_opt_int(p, 'max_bid', 1, 1000000, 'Mise maximale');
  if v_max is not null and v_max < v_min then raise exception 'La mise maximale doit être au moins la mise de départ'; end if;
  v_pct := case when p ? 'cap_pct' then hg_auction_opt_int(p, 'cap_pct', 1, 100, 'Plafond (% du solde)') else 50 end;
  v_ext := coalesce(hg_auction_opt_int(p, 'extend_min', 0, 60, 'Prolongation'), 5);
  v_extcap := coalesce(hg_auction_opt_int(p, 'extend_cap_min', 0, 1440, 'Prolongation totale'), 60);
  v_nb := hg_auction_opt_int(p, 'max_bids_user', 1, 1000, 'Offres par membre');
  v_block := coalesce((p->>'block_last_winner')::boolean, true);
  insert into hg_card_auctions(card_id, starts_at, ends_at, hard_end_at, min_bid, step, created_by,
      max_bid, cap_pct, extend_min, extend_cap_min, max_bids_user, block_last_winner)
    values (k.id, v_start, v_end, v_end + make_interval(mins => v_extcap), v_min, v_step, auth.uid(),
      v_max, v_pct, v_ext, v_extcap, v_nb, v_block) returning id into v_id;
  perform hg_admin_audit('enchere_creee', null, v_id::text, jsonb_build_object('carte', k.id, 'nom', k.name, 'debut', v_start, 'fin', v_end,
    'mise', v_min, 'pas', v_step, 'max', v_max, 'plafond_pct', v_pct, 'prolongation', v_ext, 'prolongation_max', v_extcap,
    'offres_par_membre', v_nb, 'gagnant_exclu', v_block));
  return v_id;
end $$;

-- Staff « cartes » : modifie une enchère prévue ou ouverte. p contient TOUTES les règles (champ vide = aucune limite).
-- Une fois ouverte : début figé ; mise de départ figée dès la première offre ; fin à 5 minutes au moins d'ici.
create or replace function public.hg_auction_update(p_id uuid, p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare a hg_card_auctions; v_start timestamptz; v_end timestamptz; v_min int; v_step int;
  v_max int; v_pct int; v_ext int; v_extcap int; v_nb int; v_block boolean; v_started boolean; v_top int;
begin
  if not hg_has_perm('cartes') then raise exception 'Réservé au Staff « cartes »'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hg_auction:' || coalesce(p_id::text, ''), 0));
  select * into a from hg_card_auctions where id = p_id for update;
  if not found then raise exception 'Enchère introuvable'; end if;
  if a.status not in ('prevue', 'ouverte') then raise exception 'Cette enchère est déjà terminée'; end if;
  v_started := a.starts_at <= now();
  v_start := case when v_started then a.starts_at else coalesce(nullif(p->>'starts_at', '')::timestamptz, a.starts_at) end;
  v_end := coalesce(nullif(p->>'ends_at', '')::timestamptz, a.ends_at);
  if v_started then
    if v_end < now() + interval '5 minutes' then raise exception 'La fin doit être dans 5 minutes au moins'; end if;
  else
    if v_end <= greatest(v_start, now()) + interval '30 minutes' then raise exception 'L’enchère dure au moins 30 minutes'; end if;
    if v_start > now() + interval '60 days' then raise exception 'Début : dans 60 jours au plus'; end if;
  end if;
  if v_end - v_start > interval '7 days' then raise exception 'L’enchère dure 7 jours au plus'; end if;
  v_min := coalesce(hg_auction_opt_int(p, 'min_bid', 1, 100000, 'Mise de départ'), a.min_bid);
  if a.top_bid is not null and v_min <> a.min_bid then raise exception 'La mise de départ ne change plus après la première offre'; end if;
  v_step := coalesce(hg_auction_opt_int(p, 'step', 1, 10000, 'Pas minimal'), a.step);
  v_max := hg_auction_opt_int(p, 'max_bid', 1, 1000000, 'Mise maximale');
  if v_max is not null and v_max < v_min then raise exception 'La mise maximale doit être au moins la mise de départ'; end if;
  select b.amount into v_top from hg_card_bids b where b.id = a.top_bid;
  if v_max is not null and v_top is not null and v_max < v_top then raise exception 'La mise maximale est sous la meilleure offre (% Paillettes)', v_top; end if;
  v_pct := hg_auction_opt_int(p, 'cap_pct', 1, 100, 'Plafond (% du solde)');
  v_ext := coalesce(hg_auction_opt_int(p, 'extend_min', 0, 60, 'Prolongation'), 0);
  v_extcap := coalesce(hg_auction_opt_int(p, 'extend_cap_min', 0, 1440, 'Prolongation totale'), 0);
  v_nb := hg_auction_opt_int(p, 'max_bids_user', 1, 1000, 'Offres par membre');
  v_block := coalesce((p->>'block_last_winner')::boolean, a.block_last_winner);
  update hg_card_auctions set starts_at = v_start, ends_at = v_end, hard_end_at = v_end + make_interval(mins => v_extcap),
      min_bid = v_min, step = v_step, max_bid = v_max, cap_pct = v_pct, extend_min = v_ext, extend_cap_min = v_extcap,
      max_bids_user = v_nb, block_last_winner = v_block
    where id = a.id returning * into a;
  perform hg_admin_audit('enchere_modifiee', null, a.id::text, hg_auction_rules_json(a)
    || jsonb_build_object('carte', a.card_id, 'debut', a.starts_at, 'fin', a.ends_at));
  return hg_auction_rules_json(a) || jsonb_build_object('starts_at', a.starts_at, 'ends_at', a.ends_at);
end $$;

-- Staff « cartes » : 50 dernières enchères, avec leurs règles.
create or replace function public.hg_auctions_admin()
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare res jsonb;
begin
  if not hg_has_perm('cartes') then raise exception 'Réservé au Staff « cartes »'; end if;
  perform hg_auction_close();
  select coalesce(jsonb_agg(x order by x->>'starts_at' desc), '[]'::jsonb) into res from (
    select jsonb_build_object('id', a.id, 'card_id', a.card_id, 'card_name', k.name, 'starts_at', a.starts_at, 'ends_at', a.ends_at,
      'min_bid', a.min_bid, 'step', a.step, 'status', a.status, 'price', a.price,
      'started', a.starts_at <= now(), 'rules', hg_auction_rules_json(a),
      'winner', (select p.pseudo from hg_profiles p where p.id = a.winner),
      'top', (select b.amount from hg_card_bids b where b.id = a.top_bid),
      'top_pseudo', (select p.pseudo from hg_card_bids b join hg_profiles p on p.id = b.user_id where b.id = a.top_bid),
      'bids', (select count(*) from hg_card_bids b where b.auction_id = a.id)) as x
    from hg_card_auctions a join hg_cards k on k.id = a.card_id order by a.starts_at desc limit 50) s;
  return res;
end $$;

do $g$
declare f text;
begin
  foreach f in array array['hg_auction_opt_int(jsonb, text, integer, integer, text)', 'hg_auction_cap(uuid, integer)',
    'hg_auction_rules_json(public.hg_card_auctions)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['hg_auction_current()', 'hg_auction_bid(uuid, integer)', 'hg_auction_create(jsonb)',
    'hg_auction_update(uuid, jsonb)', 'hg_auctions_admin()']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $g$;

-- Clôture régulière des enchères échues (sans attendre qu'un membre ouvre la page).
do $cron$ begin
  if exists (select 1 from pg_proc where proname = 'schedule' and pronamespace = (select oid from pg_namespace where nspname = 'cron')) then
    perform cron.schedule('hg-auctions-close', '*/5 * * * *', 'select public.hg_auction_close()');
  end if;
end $cron$;
