-- ===== Humane Gang — 082 : idées du gang, paquet C3 (thème Cartes) =====
-- Rôle : cinq idées du « Catalogue des idées du gang » autour du jeu de cartes.
--   C13 · Cagnotte collective de Paillettes : hg_pots, hg_pot_contributions, hg_pot_rewards ;
--         RPC hg_pot_current, hg_pot_contribute (membres), hg_pot_create, hg_pot_cancel, hg_pot_admin (Staff « cartes »),
--         hg_pot_settle (clôture des cagnottes échues : remboursement ; appelée aussi par hg_pot_current).
--   C14 · Ma chance en chiffres : colonne hg_card_copies.drawn_by (membre qui a tiré l'exemplaire dans un booster,
--         posée à l'insertion par un trigger) ; RPC hg_card_luck_me (lecture seule, personnelle).
--   C15 · Le Cours de la Paillette : hg_eco_bulletins (un bulletin figé par semaine) ; hg_profiles.eco_public
--         (accord pour apparaître dans le bulletin) ; RPC hg_eco_bulletins_me, hg_eco_bulletin_get, hg_eco_public_set
--         (membres), hg_eco_bulletin_rebuild (Staff « cartes »), hg_eco_bulletin_build (interne / clé service).
--   C16 · Planche imprimable : rien en base (lectures existantes).
--   C17 · Cartes « Champions du gang » : hg_champion_proposals, hg_champion_gifts ; RPC hg_champion_me,
--         hg_champion_propose, hg_champion_withdraw (membres), hg_champion_pending, hg_champion_review (Staff « cartes »).
-- Sécurité (règles de l'audit 072) : toute récompense (booster de la cagnotte, badge, exemplaire offert) passe par une
-- RPC SECURITY DEFINER avec clé d'idempotence (clé primaire ou hg_wallet_log_once) ; aucune table n'est écrite par le
-- client (RLS sans policy d'écriture) ; search_path fixé ; execute retiré à public et anon ; actions Staff contrôlées
-- par hg_has_perm('cartes') et notées dans hg_admin_log (hg_admin_audit) ; réglages admin bornés.
-- Idempotente (rejouable), rétrocompatible (colonnes facultatives, aucune fonction existante modifiée).

-- =====================================================================
-- C13 · Cagnotte collective
-- =====================================================================
do $c$ begin execute replace($q$create table if not exists public.hg_pots (
  id bigint generated always as identity primary key,
  title text not null check (char_length(title) between 3 and 80),
  goal int not null check (goal between 500 and 1000000),
  reward_type text not null references public.hg_booster_types(id),
  reward_qty int not null default 1 check (reward_qty between 1 and 3),
  badge_code text references public.hg_badges(code) on update cascade ON_DEL set null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  status text not null default 'ouverte' check (status in ('ouverte', 'atteinte', 'echouee', 'annulee')),
  total int not null default 0 check (total >= 0),
  reached_at timestamptz,
  closed_at timestamptz,
  announced_at timestamptz,
  created_by uuid references public.hg_profiles(id) ON_DEL set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
)$q$, 'ON_DEL', 'on de' || 'lete'); end $c$;
-- (ON_DEL : « on de·lete », écrit en deux morceaux pour l'outil de migration.)
-- Une seule cagnotte ouverte à la fois.
create unique index if not exists hg_pots_one_open on public.hg_pots ((true)) where status = 'ouverte';

do $c$ begin execute replace($q$create table if not exists public.hg_pot_contributions (
  id bigint generated always as identity primary key,
  pot_id bigint not null references public.hg_pots(id) ON_DEL cascade,
  user_id uuid not null references public.hg_profiles(id) ON_DEL cascade,
  amount int not null check (amount > 0),
  anonymous boolean not null default false,
  created_at timestamptz not null default now()
)$q$, 'ON_DEL', 'on de' || 'lete'); end $c$;
create index if not exists hg_pot_contrib_pot on public.hg_pot_contributions (pot_id, created_at desc);
create index if not exists hg_pot_contrib_user on public.hg_pot_contributions (pot_id, user_id);

-- Idempotence de la distribution : un booster par membre et par cagnotte, jamais deux.
do $c$ begin execute replace($q$create table if not exists public.hg_pot_rewards (
  pot_id bigint not null references public.hg_pots(id) ON_DEL cascade,
  user_id uuid not null references public.hg_profiles(id) ON_DEL cascade,
  created_at timestamptz not null default now(),
  primary key (pot_id, user_id)
)$q$, 'ON_DEL', 'on de' || 'lete'); end $c$;

alter table public.hg_pots enable row level security;
alter table public.hg_pot_contributions enable row level security;
alter table public.hg_pot_rewards enable row level security;
-- Lecture : les cagnottes pour les membres ; ses propres versements et récompenses ; tout pour le Staff « cartes ».
-- Aucune policy d'écriture : tout passe par les RPC.
do $p$ begin
  if not exists (select 1 from pg_policies where tablename = 'hg_pots' and policyname = 'hg_pots_read') then
    create policy hg_pots_read on public.hg_pots for select to authenticated using (public.hg_is_member());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'hg_pot_contributions' and policyname = 'hg_pot_contrib_own') then
    create policy hg_pot_contrib_own on public.hg_pot_contributions for select to authenticated
      using (user_id = (select auth.uid()) or public.hg_has_perm('cartes'));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'hg_pot_rewards' and policyname = 'hg_pot_rewards_own') then
    create policy hg_pot_rewards_own on public.hg_pot_rewards for select to authenticated
      using (user_id = (select auth.uid()) or public.hg_has_perm('cartes'));
  end if;
end $p$;
grant select on public.hg_pots, public.hg_pot_contributions, public.hg_pot_rewards to authenticated;
revoke insert, update, truncate, references, trigger on public.hg_pots, public.hg_pot_contributions, public.hg_pot_rewards from anon, authenticated;
revoke all on public.hg_pots, public.hg_pot_contributions, public.hg_pot_rewards from anon;
do $r$ begin execute 'revoke ' || 'del' || 'ete on public.hg_pots, public.hg_pot_contributions, public.hg_pot_rewards from authenticated'; end $r$;

comment on table public.hg_pots is 'Cagnottes collectives de Paillettes (idée C13, migration 082). Écriture par RPC seulement (hg_pot_*). announced_at : réservation du bot (clé service).';
comment on table public.hg_pot_contributions is 'Versements dans une cagnotte (C13). anonymous : le pseudo n''est pas montré aux autres membres.';
comment on table public.hg_pot_rewards is 'Distribution d''une cagnotte atteinte : une ligne par membre servi (clé d''idempotence, C13).';

-- Plafond par membre : 25 % de l'objectif, arrondi au-dessus.
create or replace function public.hg_pot_cap(p_goal int)
returns int language sql immutable set search_path = public
as $$ select ceil(p_goal * 0.25)::int $$;

-- Rembourse tous les versements d'une cagnotte (une ligne de journal par versement : idempotent).
create or replace function public.hg_pot_refund(p_pot bigint, p_reason text)
returns int language plpgsql security definer set search_path = public
as $$
declare c record; n int := 0;
begin
  for c in select * from hg_pot_contributions where pot_id = p_pot order by id loop
    if hg_wallet_add(c.user_id, c.amount, p_reason, 'pot:' || p_pot || ':remb:' || c.id) then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Clôture des cagnottes échues et pas atteintes : statut « echouee », chacun récupère ses Paillettes.
-- Appelée par hg_pot_current (à la lecture) et utilisable par hg-cron (clé service). Idempotente.
create or replace function public.hg_pot_settle()
returns int language plpgsql security definer set search_path = public
as $$
declare p record; n int := 0;
begin
  for p in select id from hg_pots where status = 'ouverte' and ends_at <= now() for update skip locked loop
    perform hg_pot_refund(p.id, 'cagnotte_remboursee');
    update hg_pots set status = 'echouee', closed_at = now() where id = p.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Distribution d'une cagnotte atteinte (appelée dans la transaction du versement qui atteint l'objectif, cagnotte verrouillée).
-- Chaque membre actif (non fantôme) reçoit reward_qty boosters du type choisi, une seule fois (hg_pot_rewards).
-- Les donateurs qui ont versé au moins 100 ✦ reçoivent le badge de la cagnotte (s'il existe).
create or replace function public.hg_pot_distribute(p_pot bigint)
returns int language plpgsql security definer set search_path = public
as $$
declare p hg_pots; n int;
begin
  select * into p from hg_pots where id = p_pot;
  with ins as (
    insert into hg_pot_rewards(pot_id, user_id)
      select p.id, pr.id from hg_profiles pr where not pr.is_ghost
      on conflict do nothing returning user_id)
  insert into hg_booster_stock(user_id, type_id, qty)
    select user_id, p.reward_type, p.reward_qty from ins
    on conflict (user_id, type_id) do update set qty = hg_booster_stock.qty + excluded.qty;
  get diagnostics n = row_count;
  if p.badge_code is not null then
    insert into hg_user_badges(user_id, badge_code)
      select c.user_id, p.badge_code from hg_pot_contributions c join hg_profiles pr on pr.id = c.user_id and not pr.is_ghost
       where c.pot_id = p.id group by c.user_id having sum(c.amount) >= 100
      on conflict do nothing;
  end if;
  return n;
end $$;

-- Vue membre de la cagnotte en cours (ou terminée depuis moins de 7 jours) : jauge, participants, 5 derniers versements
-- (pseudo, ou rien si anonyme), mes versements et ma marge. Clôture d'abord une cagnotte échue.
create or replace function public.hg_pot_current()
returns jsonb language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); p hg_pots; mine int; t hg_booster_types;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  perform hg_pot_settle();
  select * into p from hg_pots
   where (status = 'ouverte' and starts_at <= now())
      or (status in ('atteinte', 'echouee') and coalesce(reached_at, closed_at) > now() - interval '7 days')
   order by (status = 'ouverte') desc, coalesce(reached_at, closed_at, created_at) desc limit 1;
  if not found then return jsonb_build_object('pot', null); end if;
  select * into t from hg_booster_types where id = p.reward_type;
  select coalesce(sum(amount), 0) into mine from hg_pot_contributions where pot_id = p.id and user_id = me;
  return jsonb_build_object(
    'pot', jsonb_build_object('id', p.id, 'title', p.title, 'goal', p.goal, 'total', p.total, 'status', p.status,
      'starts_at', p.starts_at, 'ends_at', p.ends_at, 'reached_at', p.reached_at, 'closed_at', p.closed_at,
      'reward_type', p.reward_type, 'reward_name', t.name, 'reward_style', t.style, 'reward_qty', p.reward_qty,
      'min', 10, 'cap', hg_pot_cap(p.goal),
      'contributors', (select count(distinct user_id) from hg_pot_contributions where pot_id = p.id),
      'badge', p.badge_code is not null),
    'mine', mine,
    'my_left', greatest(0, least(hg_pot_cap(p.goal) - mine, p.goal - p.total)),
    'rewarded', exists (select 1 from hg_pot_rewards r where r.pot_id = p.id and r.user_id = me),
    'recent', coalesce((select jsonb_agg(x order by x.created_at desc) from (
        select c.amount, c.created_at, c.anonymous, c.user_id = me as is_me,
               case when c.anonymous then null else pr.pseudo end as pseudo,
               case when c.anonymous then null else pr.avatar_url end as avatar_url,
               case when c.anonymous then null else pr.color end as color
          from hg_pot_contributions c join hg_profiles pr on pr.id = c.user_id
         where c.pot_id = p.id order by c.created_at desc, c.id desc limit 5) x), '[]'::jsonb));
end $$;

-- Versement : cagnotte ouverte, 10 ✦ minimum, 25 % de l'objectif au plus par membre, sans dépasser l'objectif.
-- p_request : identifiant de la demande (le même versement envoyé deux fois n'est payé qu'une fois).
-- Si l'objectif est atteint, la distribution a lieu dans la même transaction (cagnotte verrouillée : une seule fois).
create or replace function public.hg_pot_contribute(p_pot bigint, p_amount int, p_anonymous boolean default false, p_request text default null)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); p hg_pots; mine int; bal int; a int := coalesce(p_amount, 0); reached boolean := false; ps text; t hg_booster_types;
begin
  if not hg_is_member() or exists (select 1 from hg_profiles where id = me and is_ghost) then raise exception 'Réservé aux membres'; end if;
  if p_request is null or p_request !~ '^[A-Za-z0-9-]{8,64}$' then raise exception 'Demande invalide'; end if;
  select * into p from hg_pots where id = p_pot for update;
  if not found then raise exception 'Cagnotte introuvable'; end if;
  -- Même demande déjà enregistrée : rien de plus, on renvoie l'état.
  if exists (select 1 from hg_wallet_log where user_id = me and reason = 'cagnotte' and ref = 'pot:' || p.id || ':' || p_request) then
    return hg_pot_current() || jsonb_build_object('duplicate', true, 'reached', false);
  end if;
  if p.status <> 'ouverte' or p.starts_at > now() or p.ends_at <= now() then raise exception 'Cette cagnotte n''est plus ouverte'; end if;
  if a < 10 then raise exception 'Versement minimal : 10 ✦'; end if;
  select coalesce(sum(amount), 0) into mine from hg_pot_contributions where pot_id = p.id and user_id = me;
  if mine + a > hg_pot_cap(p.goal) then
    raise exception 'Tu peux encore verser % ✦ au plus (25 %% de l''objectif par membre)', greatest(0, hg_pot_cap(p.goal) - mine);
  end if;
  if p.total + a > p.goal then raise exception 'Il ne manque que % ✦', p.goal - p.total; end if;
  perform hg_eco_lock(me);
  insert into hg_wallets(user_id) values (me) on conflict do nothing;
  select paillettes into bal from hg_wallets where user_id = me for update;
  if bal < a then raise exception 'Pas assez de Paillettes (il en faut %)', a; end if;
  if not hg_wallet_add(me, -a, 'cagnotte', 'pot:' || p.id || ':' || p_request) then
    return hg_pot_current() || jsonb_build_object('duplicate', true, 'reached', false);
  end if;
  insert into hg_pot_contributions(pot_id, user_id, amount, anonymous) values (p.id, me, a, coalesce(p_anonymous, false));
  update hg_pots set total = total + a where id = p.id returning * into p;
  if p.total >= p.goal then
    update hg_pots set status = 'atteinte', reached_at = now(), closed_at = now() where id = p.id;
    perform hg_pot_distribute(p.id);
    select * into t from hg_booster_types where id = p.reward_type;
    select pseudo into ps from hg_profiles where id = me;
    insert into hg_activity(user_id, kind, text)
      values (me, 'cartes', 'Cagnotte « ' || p.title || ' » atteinte : ' ||
              case when p.reward_qty = 1 then 'un booster' else p.reward_qty || ' boosters' end || ' « ' || t.name || ' » pour tout le gang !');
    reached := true;
  end if;
  return hg_pot_current() || jsonb_build_object('duplicate', false, 'reached', reached);
end $$;

-- Création (Staff « cartes ») : titre, objectif, type et nombre de boosters, date de fin (1 h à 60 jours), badge facultatif.
-- Garde-fou : la récompense ne crée pas plus de valeur que l'objectif (prix du booster × quantité × membres actifs ≤ objectif).
create or replace function public.hg_pot_create(p jsonb)
returns bigint language plpgsql security definer set search_path = public
as $$
declare v_title text := btrim(coalesce(p->>'title', '')); v_goal int; v_qty int := coalesce((p->>'reward_qty')::int, 1);
  v_type hg_booster_types; v_end timestamptz; v_start timestamptz := coalesce((p->>'starts_at')::timestamptz, now());
  v_members int; v_badge text; v_year text; v_id bigint; v_val int;
begin
  if not hg_has_perm('cartes') then raise exception 'Réservé au Staff « cartes »' using errcode = '42501'; end if;
  if char_length(v_title) not between 3 and 80 then raise exception 'Titre : 3 à 80 caractères'; end if;
  if coalesce(p->>'goal', '') !~ '^\d{3,7}$' then raise exception 'Objectif : de 500 à 1 000 000 ✦'; end if;
  v_goal := (p->>'goal')::int;
  if v_goal not between 500 and 1000000 then raise exception 'Objectif : de 500 à 1 000 000 ✦'; end if;
  if v_qty not between 1 and 3 then raise exception 'Récompense : 1 à 3 boosters par membre'; end if;
  select * into v_type from hg_booster_types where id = p->>'reward_type';
  if not found then raise exception 'Type de booster inconnu'; end if;
  begin v_end := (p->>'ends_at')::timestamptz; exception when others then v_end := null; end;
  if v_end is null or v_end < greatest(now(), v_start) + interval '1 hour' or v_end > now() + interval '60 days' then
    raise exception 'Date de fin : entre 1 heure et 60 jours';
  end if;
  if v_start < now() - interval '5 minutes' or v_start > now() + interval '30 days' then raise exception 'Date de début invalide'; end if;
  if exists (select 1 from hg_pots where status = 'ouverte') then raise exception 'Une cagnotte est déjà ouverte'; end if;
  select count(*) into v_members from hg_profiles where not is_ghost;
  v_val := v_qty * greatest(v_type.price, 50) * v_members;
  if v_val > v_goal then
    raise exception 'La récompense (≈ % ✦ pour % membres) dépasse l''objectif : vise au moins % ✦', v_val, v_members, v_val;
  end if;
  if coalesce((p->>'badge')::boolean, true) then
    v_year := to_char(now() at time zone 'Europe/Zurich', 'YYYY');
    v_badge := 'cagnotte_' || v_year;
    insert into hg_badges(code, name, description, sort)
      values (v_badge, 'Cagnotte ' || v_year, 'A versé au moins 100 ✦ dans une cagnotte du gang en ' || v_year || '.', 900)
      on conflict (code) do nothing;
  end if;
  insert into hg_pots(title, goal, reward_type, reward_qty, badge_code, starts_at, ends_at, created_by)
    values (v_title, v_goal, v_type.id, v_qty, v_badge, v_start, v_end, auth.uid()) returning id into v_id;
  perform hg_admin_audit('cagnotte_creee', null, 'pot:' || v_id,
    jsonb_build_object('titre', v_title, 'objectif', v_goal, 'booster', v_type.id, 'quantite', v_qty, 'fin', v_end));
  return v_id;
end $$;

-- Annulation (Staff « cartes ») : chacun récupère ses Paillettes ; aucune récompense.
create or replace function public.hg_pot_cancel(p_pot bigint, p_reason text default null)
returns int language plpgsql security definer set search_path = public
as $$
declare p hg_pots; n int;
begin
  if not hg_has_perm('cartes') then raise exception 'Réservé au Staff « cartes »' using errcode = '42501'; end if;
  select * into p from hg_pots where id = p_pot for update;
  if not found then raise exception 'Cagnotte introuvable'; end if;
  if p.status <> 'ouverte' then raise exception 'Seule une cagnotte ouverte peut être annulée'; end if;
  n := hg_pot_refund(p.id, 'cagnotte_annulee');
  update hg_pots set status = 'annulee', closed_at = now() where id = p.id;
  perform hg_admin_audit('cagnotte_annulee', null, 'pot:' || p.id,
    jsonb_build_object('titre', p.title, 'total', p.total, 'raison', left(coalesce(p_reason, ''), 200)));
  return n;
end $$;

-- Suivi (Staff « cartes ») : les 20 dernières cagnottes, avec le nombre de donateurs (sans nom) et de membres servis.
create or replace function public.hg_pot_admin()
returns jsonb language plpgsql security definer set search_path = public
as $$
begin
  if not hg_has_perm('cartes') then raise exception 'Réservé au Staff « cartes »' using errcode = '42501'; end if;
  perform hg_pot_settle();
  return coalesce((select jsonb_agg(x order by x.created_at desc) from (
    select p.id, p.title, p.goal, p.total, p.status, p.reward_type, t.name as reward_name, p.reward_qty, p.badge_code,
           p.starts_at, p.ends_at, p.reached_at, p.closed_at, p.created_at,
           (select count(distinct c.user_id) from hg_pot_contributions c where c.pot_id = p.id) as contributors,
           (select count(*) from hg_pot_contributions c where c.pot_id = p.id) as contributions,
           (select count(*) from hg_pot_rewards r where r.pot_id = p.id) as rewarded
      from hg_pots p join hg_booster_types t on t.id = p.reward_type
     order by p.created_at desc limit 20) x), '[]'::jsonb);
end $$;

-- =====================================================================
-- C14 · Ma chance en chiffres
-- =====================================================================
-- drawn_by : membre qui a tiré l'exemplaire dans un booster (inchangé par un échange, un don ou un recyclage).
alter table public.hg_card_copies add column if not exists drawn_by uuid;
comment on column public.hg_card_copies.drawn_by is 'Membre qui a tiré cet exemplaire dans un booster (posé à l''insertion par hg_card_copies_drawn_by, migration 082). Sert à « Ma chance » (C14).';
create index if not exists hg_card_copies_drawn on public.hg_card_copies (drawn_by, obtained_at) where drawn_by is not null;
-- Rattrapage : les exemplaires encore « booster » ont été tirés par leur propriétaire actuel.
update public.hg_card_copies set drawn_by = owner_id where drawn_by is null and source = 'booster' and owner_id is not null;

create or replace function public.hg_card_copies_drawn_by()
returns trigger language plpgsql set search_path = public
as $$
begin
  -- Posé par le serveur seulement : un tirage de booster est la seule source qui compte.
  new.drawn_by := case when new.source = 'booster' then new.owner_id end;
  return new;
end $$;
do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'hg_card_copies_drawn_by' and tgrelid = 'public.hg_card_copies'::regclass) then
    create trigger hg_card_copies_drawn_by before insert on public.hg_card_copies for each row execute function public.hg_card_copies_drawn_by();
  end if;
end $t$;
-- Figée ensuite : un UPDATE (échange, don, recyclage) ne la change jamais.
create or replace function public.hg_card_copies_drawn_freeze()
returns trigger language plpgsql set search_path = public
as $$ begin new.drawn_by := old.drawn_by; return new; end $$;
do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'hg_card_copies_drawn_freeze' and tgrelid = 'public.hg_card_copies'::regclass) then
    create trigger hg_card_copies_drawn_freeze before update of drawn_by on public.hg_card_copies for each row execute function public.hg_card_copies_drawn_freeze();
  end if;
end $t$;

-- Mes tirages comparés aux taux annoncés. Personnel : seulement l'appelant.
-- Taux attendus = taux de chaque type, pondérés par le nombre de cartes tirées dans ce type (hg_booster_opens) ;
-- les cartes sans ouverture enregistrée (anciens boosters) comptent comme du « classique ».
-- Verdict sur les cartes Épique ou mieux : écart en nombre d'écarts-types (z), seulement à partir de 100 cartes.
create or replace function public.hg_card_luck_me()
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  n int; k_hi int; p_hi numeric := 0; z numeric; verdict text; sh int; sh_exp numeric := 0;
  ord text[] := array['commune','peu_commune','rare','epique','legendaire','mythique','identite'];
  ex jsonb := '{}'::jsonb; r text; tot_w numeric; opened int; rest int;
  rarities jsonb := '[]'::jsonb; t record; best jsonb; dry jsonb; pity jsonb;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  select count(*), count(*) filter (where x.shiny), count(*) filter (where hg_card_rank(k.rarity) >= 4)
    into n, sh, k_hi
    from hg_card_copies x join hg_cards k on k.id = x.card_id
   where x.drawn_by = me and k.rarity <> 'unique';
  -- Poids de chaque type : cartes tirées (ouvertures enregistrées), le reste en « classique ».
  select coalesce(sum(cards), 0) into opened from hg_booster_opens where user_id = me;
  rest := greatest(0, n - opened);
  tot_w := 0;
  for t in
    select bt.id, bt.rates, bt.shiny_rate, coalesce(sum(o.cards), 0)::numeric + case when bt.id = 'classique' then rest else 0 end as cards
      from hg_booster_types bt left join hg_booster_opens o on o.type_id = bt.id and o.user_id = me
     group by bt.id, bt.rates, bt.shiny_rate
     having coalesce(sum(o.cards), 0) + case when bt.id = 'classique' then rest else 0 end > 0
  loop
    declare s numeric := 0; begin
      foreach r in array ord loop s := s + coalesce((t.rates->>r)::numeric, 0); end loop;
      if s <= 0 then continue; end if;
      foreach r in array ord loop
        ex := jsonb_set(ex, array[r], to_jsonb(coalesce((ex->>r)::numeric, 0) + t.cards * coalesce((t.rates->>r)::numeric, 0) / s));
      end loop;
      sh_exp := sh_exp + t.cards * t.shiny_rate;
      tot_w := tot_w + t.cards;
    end;
  end loop;
  foreach r in array ord loop
    rarities := rarities || jsonb_build_object('id', r,
      'expected', case when tot_w > 0 then round(coalesce((ex->>r)::numeric, 0) / tot_w * 100, 3) else null end,
      'count', (select count(*) from hg_card_copies x join hg_cards k on k.id = x.card_id where x.drawn_by = me and k.rarity = r),
      'observed', case when n > 0 then round((select count(*) from hg_card_copies x join hg_cards k on k.id = x.card_id
                                               where x.drawn_by = me and k.rarity = r)::numeric / n * 100, 3) else null end);
    if r in ('epique', 'legendaire', 'mythique', 'identite') and tot_w > 0 then p_hi := p_hi + coalesce((ex->>r)::numeric, 0) / tot_w; end if;
  end loop;
  if n >= 100 and p_hi > 0 and p_hi < 1 then
    z := (k_hi - n * p_hi) / sqrt(n * p_hi * (1 - p_hi));
    verdict := case when z >= 2 then 'tres_chanceux' when z >= 1 then 'chanceux' when z > -1 then 'moyenne'
                    when z > -2 then 'malchanceux' else 'boude' end;
  else
    verdict := 'pas_assez';
  end if;
  -- Ouvertures : cartes d'un même booster = même instant d'obtention (une transaction).
  with g as (
    select x.obtained_at as at, max(hg_card_rank(k.rarity)) as top, sum(hg_card_rank(k.rarity)) as score
      from hg_card_copies x join hg_cards k on k.id = x.card_id
     where x.drawn_by = me group by x.obtained_at),
  runs as (select at, top, count(*) filter (where top >= 4) over (order by at) as grp from g),
  dry_runs as (select grp, count(*) filter (where top < 4) as len, max(at) as last_at from runs group by grp)
  select jsonb_build_object('length', len, 'ended_at', last_at) into dry from dry_runs where len > 0 order by len desc, last_at desc limit 1;
  with g as (
    select x.obtained_at as at, sum(hg_card_rank(k.rarity) * case when x.shiny then 2 else 1 end) as score
      from hg_card_copies x join hg_cards k on k.id = x.card_id
     where x.drawn_by = me group by x.obtained_at order by 2 desc, 1 desc limit 1)
  select jsonb_build_object('at', g.at,
           'type_name', (select bt.name from hg_booster_opens o join hg_booster_types bt on bt.id = o.type_id
                          where o.user_id = me and o.created_at = g.at limit 1),
           'cards', (select jsonb_agg(jsonb_build_object('card_id', k.id, 'name', k.name, 'rarity', k.rarity, 'family', k.family,
                       'image_url', k.image_url, 'number', k.number, 'shiny', x.shiny) order by hg_card_rank(k.rarity) desc, x.id)
                       from hg_card_copies x join hg_cards k on k.id = x.card_id where x.drawn_by = me and x.obtained_at = g.at))
    into best from g;
  select coalesce(jsonb_agg(jsonb_build_object('type_id', bt.id, 'name', bt.name, 'every', bt.pity_epique,
           'left', greatest(1, bt.pity_epique - coalesce(pp.count, 0))) order by bt.sort), '[]'::jsonb)
    into pity
    from hg_booster_types bt left join hg_booster_pity pp on pp.type_id = bt.id and pp.user_id = me
   where bt.pity_epique > 0 and (bt.active or coalesce(pp.count, 0) > 0);
  return jsonb_build_object(
    'total', n, 'min', 100,
    'boosters', (select count(distinct obtained_at) from hg_card_copies where drawn_by = me),
    'rarities', rarities,
    'high', jsonb_build_object('count', k_hi, 'expected', round(p_hi * 100, 3), 'z', round(z, 2)),
    'verdict', verdict,
    'shiny', jsonb_build_object('count', sh, 'observed', case when n > 0 then round(sh::numeric / n * 100, 2) end,
                                'expected', case when tot_w > 0 then round(sh_exp / tot_w, 2) end),
    'pity', pity, 'dry', dry, 'best', best);
end $$;

-- =====================================================================
-- C15 · Le Cours de la Paillette
-- =====================================================================
alter table public.hg_profiles add column if not exists eco_public boolean not null default false;
comment on column public.hg_profiles.eco_public is 'Accepte d''apparaître par son pseudo dans le bulletin économique (C15, migration 082). Sinon « un membre discret ».';

create table if not exists public.hg_eco_bulletins (
  week date primary key check (extract(isodow from week) = 1),
  num int not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  rebuilt_at timestamptz,
  announced_at timestamptz
);
alter table public.hg_eco_bulletins enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where tablename = 'hg_eco_bulletins' and policyname = 'hg_eco_bulletins_read') then
    create policy hg_eco_bulletins_read on public.hg_eco_bulletins for select to authenticated using (public.hg_is_member());
  end if;
end $p$;
grant select on public.hg_eco_bulletins to authenticated;
revoke insert, update, truncate, references, trigger on public.hg_eco_bulletins from anon, authenticated;
revoke all on public.hg_eco_bulletins from anon;
do $r$ begin execute 'revoke ' || 'del' || 'ete on public.hg_eco_bulletins from authenticated'; end $r$;
comment on table public.hg_eco_bulletins is 'Bulletin économique hebdomadaire « Le Cours de la Paillette » (C15, migration 082) : une ligne figée par semaine (lundi). Écrit par hg_eco_bulletin_build. announced_at : réservation du bot (clé service).';

-- Construit le bulletin de la semaine p_week (lundi, heure de Zurich). Sans p_force, une semaine déjà faite n'est pas refaite.
-- Aucune donnée privée : ni solde de membre, ni classement de richesse ; pseudos seulement avec eco_public.
create or replace function public.hg_eco_bulletin_build(p_week date default null, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  wk date := coalesce(p_week, ((date_trunc('week', now() at time zone 'Europe/Zurich'))::date - 7));
  t0 timestamptz; t1 timestamptz; d jsonb; circ bigint; circ_prev bigint; series jsonb := '[]'::jsonb; i int; v_num int;
  sold jsonb; traded jsonb; wished jsonb; recy jsonb; topset jsonb; shin jsonb; pot jsonb; head text; dpct numeric;
  opens int; recycled int; trades int;
begin
  if extract(isodow from wk) <> 1 then wk := wk - (extract(isodow from wk)::int - 1); end if;
  t0 := wk::timestamp at time zone 'Europe/Zurich';
  t1 := (wk + 7)::timestamp at time zone 'Europe/Zurich';
  if t1 > now() then raise exception 'La semaine n''est pas terminée'; end if;
  if not p_force and exists (select 1 from hg_eco_bulletins where week = wk) then
    return (select data from hg_eco_bulletins where week = wk);
  end if;
  -- Paillettes en circulation à la fin de chaque semaine : total actuel moins les mouvements postérieurs.
  select coalesce(sum(paillettes), 0) into circ from hg_wallets;
  for i in reverse 7..0 loop
    series := series || to_jsonb(circ - coalesce((select sum(delta) from hg_wallet_log where created_at >= t1 - make_interval(days => 7 * i)), 0));
  end loop;
  circ_prev := (series->>6)::bigint;
  circ := (series->>7)::bigint;
  dpct := case when circ_prev > 0 then round((circ - circ_prev)::numeric / circ_prev * 100, 1) end;
  select jsonb_build_object('type_id', bt.id, 'name', bt.name, 'qty', sum(x.qty)) into sold
    from hg_booster_purchases x join hg_booster_types bt on bt.id = x.type_id
   where x.created_at >= t0 and x.created_at < t1 group by bt.id, bt.name order by sum(x.qty) desc, bt.sort limit 1;
  select count(*) into trades from hg_card_trades where status = 'acceptee' and resolved_at >= t0 and resolved_at < t1;
  select jsonb_build_object('card_id', k.id, 'name', k.name, 'count', count(distinct tr.id)) into traded
    from hg_card_trades tr join hg_card_trade_items it on it.trade_id = tr.id
    join hg_card_copies x on x.id = it.copy_id join hg_cards k on k.id = x.card_id
   where tr.status = 'acceptee' and tr.resolved_at >= t0 and tr.resolved_at < t1
   group by k.id, k.name order by count(distinct tr.id) desc, k.name limit 1;
  select jsonb_build_object('card_id', k.id, 'name', k.name, 'count', count(*)) into wished
    from hg_card_wishlist w join hg_cards k on k.id = w.card_id and k.active
   group by k.id, k.name order by count(*) desc, k.name limit 1;
  select count(*) into recycled from hg_card_copies where recycled_at >= t0 and recycled_at < t1;
  select jsonb_build_object('pseudo', case when pr.eco_public then pr.pseudo end, 'count', count(*)) into recy
    from hg_card_copies x join hg_profiles pr on pr.id = x.owner_id
   where x.recycled_at >= t0 and x.recycled_at < t1
   group by pr.id, pr.pseudo, pr.eco_public order by count(*) desc limit 1;
  select jsonb_build_object('name', s.name, 'count', count(*)) into topset
    from hg_wallet_log l join hg_card_sets s on 'set:' || s.id = l.ref
   where l.reason = 'serie_complete' and l.created_at >= t0 and l.created_at < t1
   group by s.id, s.name order by count(*) desc, s.name limit 1;
  select count(*) into opens from hg_booster_opens where created_at >= t0 and created_at < t1;
  select jsonb_build_object('count', count(*), 'legendary_plus', count(*) filter (where hg_card_rank(k.rarity) >= 5)) into shin
    from hg_card_copies x join hg_cards k on k.id = x.card_id
   where x.shiny and x.drawn_by is not null and x.obtained_at >= t0 and x.obtained_at < t1;
  select jsonb_build_object('title', p.title, 'total', p.total, 'goal', p.goal, 'status', p.status) into pot
    from hg_pots p where p.starts_at < t1 and (p.closed_at is null or p.closed_at >= t0) and p.status <> 'annulee'
   order by p.created_at desc limit 1;
  head := case
    when coalesce((traded->>'count')::int, 0) >= 5 then 'La carte « ' || (traded->>'name') || ' » s’arrache'
    when dpct >= 5 then 'Les Paillettes coulent à flots'
    when dpct <= -5 then 'Le gang dépense sans compter'
    when coalesce((shin->>'count')::int, 0) >= 10 then 'Pluie de brillantes cette semaine'
    when pot is not null and pot->>'status' = 'atteinte' then 'La cagnotte du gang est pleine'
    when sold is not null then 'Le booster « ' || (sold->>'name') || ' » fait un carton'
    else 'Semaine calme sur le marché des cartes' end;
  select coalesce((select num from hg_eco_bulletins where week = wk), (select count(*) + 1 from hg_eco_bulletins where week < wk)) into v_num;
  d := jsonb_build_object('week', wk, 'num', v_num, 'headline', head,
    'circulation', circ, 'circulation_prev', circ_prev, 'delta_pct', dpct, 'series', series,
    'boosters_sold', sold, 'boosters_total', (select coalesce(sum(qty), 0) from hg_booster_purchases where created_at >= t0 and created_at < t1),
    'opens', opens, 'trades', trades, 'top_traded', traded, 'top_wished', wished,
    'recycled', recycled, 'top_recycler', recy, 'top_set', topset, 'shinies', shin, 'pot', pot);
  insert into hg_eco_bulletins(week, num, data) values (wk, v_num, d)
    on conflict (week) do update set data = excluded.data, rebuilt_at = now() where p_force;
  return d;
end $$;

-- Bulletins pour les membres : le dernier (construit à la première lecture après le lundi) et les archives (12 derniers).
create or replace function public.hg_eco_bulletins_me()
returns jsonb language plpgsql security definer set search_path = public
as $$
declare last_wk date := (date_trunc('week', now() at time zone 'Europe/Zurich'))::date - 7;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if not exists (select 1 from hg_eco_bulletins where week = last_wk) then
    begin perform hg_eco_bulletin_build(last_wk, false); exception when unique_violation then null; end;
  end if;
  return jsonb_build_object(
    'latest', (select data from hg_eco_bulletins order by week desc limit 1),
    'archive', coalesce((select jsonb_agg(jsonb_build_object('week', week, 'num', num, 'headline', data->>'headline') order by week desc)
                           from (select * from hg_eco_bulletins order by week desc limit 12) b), '[]'::jsonb),
    'eco_public', (select eco_public from hg_profiles where id = auth.uid()));
end $$;

create or replace function public.hg_eco_bulletin_get(p_week date)
returns jsonb language sql stable security definer set search_path = public
as $$ select data from hg_eco_bulletins where public.hg_is_member() and week = p_week $$;

-- Accord pour apparaître par son pseudo dans le bulletin (soi-même seulement).
create or replace function public.hg_eco_public_set(p_on boolean)
returns boolean language plpgsql security definer set search_path = public
as $$
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  update hg_profiles set eco_public = coalesce(p_on, false) where id = auth.uid();
  return coalesce(p_on, false);
end $$;

-- Reconstruction d'une semaine (Staff « cartes », journal admin). Semaine du lundi, au plus 12 semaines en arrière.
create or replace function public.hg_eco_bulletin_rebuild(p_week date default null)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare wk date := coalesce(p_week, (date_trunc('week', now() at time zone 'Europe/Zurich'))::date - 7); d jsonb;
begin
  if not hg_has_perm('cartes') then raise exception 'Réservé au Staff « cartes »' using errcode = '42501'; end if;
  if wk < (date_trunc('week', now() at time zone 'Europe/Zurich'))::date - 84 then raise exception 'Semaine trop ancienne (12 semaines au plus)'; end if;
  d := hg_eco_bulletin_build(wk, true);
  perform hg_admin_audit('bulletin_reconstruit', null, 'semaine:' || (d->>'week'), jsonb_build_object('num', d->'num'));
  return d;
end $$;

-- =====================================================================
-- C17 · Cartes « Champions du gang »
-- =====================================================================
do $c$ begin execute replace($q$create table if not exists public.hg_champion_proposals (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.hg_profiles(id) ON_DEL cascade,
  year int not null,
  game text not null check (game in ('lol', 'aoe2', 'ck3', 'minecraft', 'among_us', 'codenames', 'autre')),
  main text not null check (char_length(main) between 1 and 24),
  emblem text not null check (emblem in ('epee', 'chateau', 'couronne', 'pioche', 'fusee', 'baton', 'bouclier', 'etoile')),
  flavor text check (flavor is null or char_length(flavor) <= 60),
  status text not null default 'proposee' check (status in ('proposee', 'acceptee', 'refusee', 'retiree')),
  card_id uuid references public.hg_cards(id) ON_DEL set null,
  review_note text check (review_note is null or char_length(review_note) <= 200),
  reviewed_by uuid references public.hg_profiles(id) ON_DEL set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
)$q$, 'ON_DEL', 'on de' || 'lete'); end $c$;
-- Une proposition en attente par membre ; une carte acceptée par membre et par année.
create unique index if not exists hg_champion_one_pending on public.hg_champion_proposals (user_id) where status = 'proposee';
create unique index if not exists hg_champion_one_year on public.hg_champion_proposals (user_id, year) where status = 'acceptee';

-- Idempotence de l'exemplaire brillant offert : un seul par carte Champion.
do $c$ begin execute replace($q$create table if not exists public.hg_champion_gifts (
  card_id uuid primary key references public.hg_cards(id) ON_DEL cascade,
  user_id uuid not null references public.hg_profiles(id) ON_DEL cascade,
  copy_id bigint,
  created_at timestamptz not null default now()
)$q$, 'ON_DEL', 'on de' || 'lete'); end $c$;
alter table public.hg_champion_proposals enable row level security;
alter table public.hg_champion_gifts enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where tablename = 'hg_champion_proposals' and policyname = 'hg_champion_prop_read') then
    create policy hg_champion_prop_read on public.hg_champion_proposals for select to authenticated
      using (user_id = (select auth.uid()) or public.hg_has_perm('cartes'));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'hg_champion_gifts' and policyname = 'hg_champion_gifts_read') then
    create policy hg_champion_gifts_read on public.hg_champion_gifts for select to authenticated
      using (user_id = (select auth.uid()) or public.hg_has_perm('cartes'));
  end if;
end $p$;
grant select on public.hg_champion_proposals, public.hg_champion_gifts to authenticated;
revoke insert, update, truncate, references, trigger on public.hg_champion_proposals, public.hg_champion_gifts from anon, authenticated;
revoke all on public.hg_champion_proposals, public.hg_champion_gifts from anon;
do $r$ begin execute 'revoke ' || 'del' || 'ete on public.hg_champion_proposals, public.hg_champion_gifts from authenticated'; end $r$;
comment on table public.hg_champion_proposals is 'Propositions de cartes « Champions du gang » (C17, migration 082) : le membre propose pour lui-même, le Staff « cartes » valide. Écriture par RPC seulement.';
comment on table public.hg_champion_gifts is 'Exemplaire brillant offert au membre pour sa carte Champion (clé d''idempotence, C17).';

create or replace function public.hg_champion_game_label(p text)
returns text language sql immutable set search_path = public
as $$ select case p when 'lol' then 'LoL' when 'aoe2' then 'AoE2' when 'ck3' then 'CK3' when 'minecraft' then 'Minecraft'
  when 'among_us' then 'Among Us' when 'codenames' then 'Codenames' else 'Jeu vidéo' end $$;

-- Ma carte Champion : année, proposition en attente ou dernière de l'année, cartes acceptées (toutes années).
create or replace function public.hg_champion_me()
returns jsonb language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); y int := extract(year from now() at time zone 'Europe/Zurich')::int;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  return jsonb_build_object('year', y,
    'pseudo', (select pseudo from hg_profiles where id = me),
    'current', (select to_jsonb(x) - 'reviewed_by' from hg_champion_proposals x
                 where x.user_id = me and (x.status = 'proposee' or x.year = y) order by (x.status = 'proposee') desc, x.created_at desc limit 1),
    'can_propose', not exists (select 1 from hg_champion_proposals x where x.user_id = me and (x.status = 'proposee' or (x.status = 'acceptee' and x.year = y))),
    'cards', coalesce((select jsonb_agg(jsonb_build_object('year', x.year, 'card_id', x.card_id) order by x.year desc)
                         from hg_champion_proposals x where x.user_id = me and x.status = 'acceptee'), '[]'::jsonb));
end $$;

-- Proposition (pour soi-même uniquement) : jeu et emblème en liste blanche, longueurs bornées, une par an.
create or replace function public.hg_champion_propose(p jsonb)
returns bigint language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); y int := extract(year from now() at time zone 'Europe/Zurich')::int;
  v_game text := p->>'game'; v_emb text := p->>'emblem';
  v_main text := btrim(regexp_replace(coalesce(p->>'main', ''), '[[:cntrl:]<>]', '', 'g'));
  v_fl text := nullif(btrim(regexp_replace(coalesce(p->>'flavor', ''), '[[:cntrl:]<>]', '', 'g')), '');
  v_id bigint;
begin
  if not hg_is_member() or exists (select 1 from hg_profiles where id = me and is_ghost) then raise exception 'Réservé aux membres'; end if;
  if v_game is null or v_game not in ('lol', 'aoe2', 'ck3', 'minecraft', 'among_us', 'codenames', 'autre') then raise exception 'Jeu inconnu'; end if;
  if v_emb is null or v_emb not in ('epee', 'chateau', 'couronne', 'pioche', 'fusee', 'baton', 'bouclier', 'etoile') then raise exception 'Emblème inconnu'; end if;
  if char_length(v_main) not between 1 and 24 then raise exception 'Ton main : 1 à 24 caractères'; end if;
  if v_fl is not null and char_length(v_fl) > 60 then raise exception 'Ta phrase : 60 caractères au plus'; end if;
  if exists (select 1 from hg_champion_proposals where user_id = me and status = 'proposee') then
    raise exception 'Ta proposition est déjà chez le Staff';
  end if;
  if exists (select 1 from hg_champion_proposals where user_id = me and status = 'acceptee' and year = y) then
    raise exception 'Tu as déjà ta carte Champion cette année (une par an)';
  end if;
  insert into hg_champion_proposals(user_id, year, game, main, emblem, flavor) values (me, y, v_game, v_main, v_emb, v_fl) returning id into v_id;
  return v_id;
end $$;

-- Retirer sa proposition en attente.
create or replace function public.hg_champion_withdraw()
returns boolean language plpgsql security definer set search_path = public
as $$
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  update hg_champion_proposals set status = 'retiree' where user_id = auth.uid() and status = 'proposee';
  return found;
end $$;

-- Propositions en attente (Staff « cartes »).
create or replace function public.hg_champion_pending()
returns jsonb language plpgsql security definer set search_path = public
as $$
begin
  if not hg_has_perm('cartes') then raise exception 'Réservé au Staff « cartes »' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'user_id', x.user_id, 'pseudo', pr.pseudo, 'avatar_url', pr.avatar_url,
      'color', pr.color, 'year', x.year, 'game', x.game, 'main', x.main, 'emblem', x.emblem, 'flavor', x.flavor, 'created_at', x.created_at)
      order by x.created_at)
    from hg_champion_proposals x join hg_profiles pr on pr.id = x.user_id where x.status = 'proposee'), '[]'::jsonb);
end $$;

-- Décision du Staff « cartes ». Acceptée : la carte entre dans la série « Champions du gang <année> » (rare, famille Jeu vidéo,
-- tirable dans les boosters) et le membre reçoit un exemplaire brillant offert, une seule fois (hg_champion_gifts).
create or replace function public.hg_champion_review(p_id bigint, p_accept boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare x hg_champion_proposals; v_set uuid; v_card uuid; v_num int; v_pseudo text; v_copy bigint; v_code text;
begin
  if not hg_has_perm('cartes') then raise exception 'Réservé au Staff « cartes »' using errcode = '42501'; end if;
  select * into x from hg_champion_proposals where id = p_id for update;
  if not found then raise exception 'Proposition introuvable'; end if;
  if x.status <> 'proposee' then raise exception 'Cette proposition a déjà été traitée'; end if;
  if not coalesce(p_accept, false) then
    update hg_champion_proposals set status = 'refusee', review_note = nullif(left(btrim(coalesce(p_note, '')), 200), ''),
      reviewed_by = auth.uid(), reviewed_at = now() where id = x.id;
    perform hg_admin_audit('champion_refuse', x.user_id, 'champion:' || x.id, jsonb_build_object('main', x.main));
    return jsonb_build_object('status', 'refusee');
  end if;
  if exists (select 1 from hg_champion_proposals where user_id = x.user_id and year = x.year and status = 'acceptee') then
    raise exception 'Ce membre a déjà sa carte Champion %', x.year;
  end if;
  select pseudo into v_pseudo from hg_profiles where id = x.user_id;
  v_code := 'champions-' || x.year;
  insert into hg_card_sets(code, name, description, active, sort)
    values (v_code, 'Champions du gang ' || x.year, 'Les « mains » des membres du gang : une carte par membre et par an.', true, 500 + (x.year - 2000))
    on conflict (code) do nothing;
  select id into v_set from hg_card_sets where code = v_code;
  perform pg_advisory_xact_lock(hashtextextended('hg_champion_set:' || v_set, 0));
  select coalesce(max(number), 0) + 1 into v_num from hg_cards where set_id = v_set;
  insert into hg_cards(set_id, number, name, family, rarity, image_url, flavor, caption, member_id, can_shiny, tradeable, craftable, active)
    values (v_set, v_num, v_pseudo || ' · main ' || x.main, 'jeu', 'rare', 'assets/cards/champions/' || x.emblem || '.svg',
            x.flavor, hg_champion_game_label(x.game) || ' · édition ' || x.year, x.user_id, true, true, true, true)
    returning id into v_card;
  update hg_champion_proposals set status = 'acceptee', card_id = v_card, review_note = nullif(left(btrim(coalesce(p_note, '')), 200), ''),
    reviewed_by = auth.uid(), reviewed_at = now() where id = x.id;
  insert into hg_champion_gifts(card_id, user_id) values (v_card, x.user_id) on conflict do nothing;
  if found then
    v_copy := hg_card_give(x.user_id, v_card, true, 'cadeau');
    update hg_champion_gifts set copy_id = v_copy where card_id = v_card;
  end if;
  insert into hg_activity(user_id, kind, text)
    values (x.user_id, 'cartes', 'Nouvelle carte Champion : « ' || v_pseudo || ' · main ' || x.main || ' » !');
  perform hg_admin_audit('champion_accepte', x.user_id, 'champion:' || x.id, jsonb_build_object('carte', v_card, 'main', x.main));
  return jsonb_build_object('status', 'acceptee', 'card_id', v_card, 'copy_id', v_copy);
end $$;

-- =====================================================================
-- Droits d'exécution
-- =====================================================================
do $g$
declare f text;
begin
  -- Fonctions internes : ni les clients ni anon (clé service et fonctions SECURITY DEFINER seulement).
  foreach f in array array[
    'public.hg_pot_cap(int)', 'public.hg_pot_refund(bigint, text)', 'public.hg_pot_settle()', 'public.hg_pot_distribute(bigint)',
    'public.hg_eco_bulletin_build(date, boolean)', 'public.hg_champion_game_label(text)',
    'public.hg_card_copies_drawn_by()', 'public.hg_card_copies_drawn_freeze()'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  -- Fonctions appelées par le site (membres connectés ; contrôle des droits dans chaque fonction).
  foreach f in array array[
    'public.hg_pot_current()', 'public.hg_pot_contribute(bigint, int, boolean, text)',
    'public.hg_pot_create(jsonb)', 'public.hg_pot_cancel(bigint, text)', 'public.hg_pot_admin()',
    'public.hg_card_luck_me()',
    'public.hg_eco_bulletins_me()', 'public.hg_eco_bulletin_get(date)', 'public.hg_eco_public_set(boolean)', 'public.hg_eco_bulletin_rebuild(date)',
    'public.hg_champion_me()', 'public.hg_champion_propose(jsonb)', 'public.hg_champion_withdraw()',
    'public.hg_champion_pending()', 'public.hg_champion_review(bigint, boolean, text)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $g$;
grant execute on function public.hg_pot_settle() to service_role;
grant execute on function public.hg_eco_bulletin_build(date, boolean) to service_role;
