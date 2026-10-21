-- ===== 024 : défis collectifs du gang (F10) et quêtes hebdomadaires du jeu de cartes (F11) =====
-- Idempotent : rejouable sans erreur (if not exists, create or replace, policies testées dans pg_policies,
-- on conflict do nothing). Aucune instruction « drop » ni « delete » dans ce fichier.
--
-- Économie : toutes les Paillettes passent par hg_wallet_add(user, delta, reason, ref), idempotente par ref
--   - défis : reason 'defi',  ref 'defi:<id du défi>'                      (une fois par membre et par défi)
--   - quêtes : reason 'quete', ref 'quete:<lundi de la semaine>:<code>'     (une fois par membre, par quête, par semaine)
-- Aucune mention d'argent réel.
--
-- Périmètre des récompenses de défi : Paillettes uniquement. Les boosters gratuits demandent une évolution de
-- hg_open_booster_req (compteur de boosters offerts) : non faite ici, à traiter à part.
--
-- Planification du défi (pg_cron, à lancer une fois après application ; le nom de la tâche est unique) :
--   select cron.schedule('hg-challenges-hourly', '17 * * * *', 'select public.hg_challenges_award()');
--   Pour l'arrêter : select cron.unschedule('hg-challenges-hourly');

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.hg_challenges (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  description text check (description is null or char_length(description) <= 500),
  -- métrique fermée, calculée par hg_challenge_value à partir des tables existantes
  metric text not null check (metric in ('sorties_tenues', 'participations', 'photos_ajoutees', 'souvenirs_publies',
    'boosters_ouverts', 'cartes_recyclees', 'echanges_conclus')),
  target int not null check (target > 0),
  reward int not null check (reward between 1 and 100000),          -- Paillettes par membre
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  active boolean not null default false,
  created_by uuid references public.hg_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists public.hg_card_quests_templates (
  code text primary key check (code ~ '^[a-z0-9_]{2,40}$'),
  label text not null check (char_length(label) between 1 and 120),
  metric text not null check (metric in ('boosters_ouverts', 'echanges_conclus', 'photos_ajoutees',
    'cartes_recyclees', 'passages_du_jour')),
  target int not null check (target > 0),
  reward int not null check (reward between 1 and 10000),           -- Paillettes
  active boolean not null default true,
  sort int not null default 0
);

alter table public.hg_challenges enable row level security;
alter table public.hg_card_quests_templates enable row level security;
revoke all on public.hg_challenges from anon;
revoke all on public.hg_card_quests_templates from anon;

-- Policies : admin = tout ; membres = lecture des éléments actifs. Créées seulement si absentes.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_challenges' and policyname = 'hg_challenges_admin') then
    create policy hg_challenges_admin on public.hg_challenges for all to authenticated
      using (hg_is_admin()) with check (hg_is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_challenges' and policyname = 'hg_challenges_read') then
    create policy hg_challenges_read on public.hg_challenges for select to authenticated
      using (hg_is_member() and active);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_card_quests_templates' and policyname = 'hg_card_quests_templates_admin') then
    create policy hg_card_quests_templates_admin on public.hg_card_quests_templates for all to authenticated
      using (hg_is_admin()) with check (hg_is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_card_quests_templates' and policyname = 'hg_card_quests_templates_read') then
    create policy hg_card_quests_templates_read on public.hg_card_quests_templates for select to authenticated
      using (hg_is_member() and active);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Calcul des métriques
--    p_user null : valeur collective (tout le gang) ; p_user renseigné : valeur personnelle.
--    Fenêtre : [p_start, p_end[ . Métrique inconnue : 0.
-- ---------------------------------------------------------------------------
create or replace function public.hg_challenge_value(p_metric text, p_user uuid, p_start timestamptz, p_end timestamptz)
returns numeric language sql stable security definer set search_path = public as $$
  select (case p_metric
    when 'sorties_tenues' then (select count(*) from hg_events e
      where e.starts_at >= p_start and e.starts_at < p_end
        and (p_user is null or exists (select 1 from hg_event_rsvps r where r.event_id = e.id and r.user_id = p_user and r.status = 'oui')))
    when 'participations' then (select count(*) from hg_event_rsvps r join hg_events e on e.id = r.event_id
      where r.status = 'oui' and e.starts_at >= p_start and e.starts_at < p_end and (p_user is null or r.user_id = p_user))
    when 'photos_ajoutees' then (select count(*) from hg_photos x
      where x.created_at >= p_start and x.created_at < p_end and (p_user is null or x.user_id = p_user))
    when 'souvenirs_publies' then (select count(*) from hg_moments x
      where x.created_at >= p_start and x.created_at < p_end and (p_user is null or x.created_by = p_user))
    when 'boosters_ouverts' then (select count(*) from hg_wallet_log x
      where x.reason = 'booster_requete' and x.created_at >= p_start and x.created_at < p_end and (p_user is null or x.user_id = p_user))
    when 'cartes_recyclees' then (select count(*) from hg_card_copies x
      where x.recycled_at >= p_start and x.recycled_at < p_end and (p_user is null or x.owner_id = p_user))
    when 'echanges_conclus' then (select count(*) from hg_card_trades x
      where x.status = 'acceptee' and x.resolved_at >= p_start and x.resolved_at < p_end
        and (p_user is null or p_user in (x.from_user, x.to_user)))
    when 'passages_du_jour' then (select count(*) from hg_wallet_log x
      where x.reason = 'quotidien' and x.created_at >= p_start and x.created_at < p_end and (p_user is null or x.user_id = p_user))
    else 0 end)::numeric
$$;

revoke execute on function public.hg_challenge_value(text, uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Défis collectifs
-- ---------------------------------------------------------------------------

-- Défis actifs (en cours, ou terminés depuis moins de 24 h) avec leur progression collective.
create or replace function public.hg_challenges_active()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', c.id, 'title', c.title, 'description', c.description, 'metric', c.metric,
        'target', c.target, 'reward', c.reward, 'starts_at', c.starts_at, 'ends_at', c.ends_at,
        'progress', v.value, 'done', v.value >= c.target, 'ended', c.ends_at <= now(),
        'credited', exists (select 1 from hg_wallet_log l
          where l.user_id = auth.uid() and l.reason = 'defi' and l.ref = 'defi:' || c.id::text))
      order by c.ends_at)
    from hg_challenges c
    cross join lateral (select hg_challenge_value(c.metric, null, c.starts_at, least(c.ends_at, now())) as value) v
    where c.active and c.ends_at > now() - interval '1 day'
  ), '[]'::jsonb);
end $$;

-- Crédit des défis atteints : une fois par membre (non fantôme) et par défi. Appelée par pg_cron.
create or replace function public.hg_challenges_award()
returns integer language plpgsql security definer set search_path = public as $$
declare c hg_challenges; r record; v numeric; n int := 0;
begin
  for c in select * from hg_challenges where active loop
    v := hg_challenge_value(c.metric, null, c.starts_at, least(c.ends_at, now()));
    continue when v < c.target;
    for r in select p.id from hg_profiles p
      where not p.is_ghost
        and not exists (select 1 from hg_wallet_log l where l.user_id = p.id and l.reason = 'defi' and l.ref = 'defi:' || c.id::text)
    loop
      if hg_wallet_add(r.id, c.reward, 'defi', 'defi:' || c.id::text) then n := n + 1; end if;
    end loop;
  end loop;
  return n;
end $$;

revoke execute on function public.hg_challenges_award() from public, anon, authenticated;
revoke execute on function public.hg_challenges_active() from public, anon;
grant execute on function public.hg_challenges_active() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Quêtes hebdomadaires
--    Semaine : du lundi 00:00 au lundi suivant 00:00, heure de Zurich.
--    Les 3 quêtes de la semaine : les 3 premiers modèles actifs selon un ordre déterministe (hash du lundi + code),
--    donc identiques pour tout le monde pendant la semaine.
-- ---------------------------------------------------------------------------
create or replace function public.hg_card_quests_pick(p_week date)
returns setof public.hg_card_quests_templates language sql stable set search_path = public as $$
  select t.* from hg_card_quests_templates t
  where t.active
  order by md5(p_week::text || t.code), t.code
  limit 3
$$;

revoke execute on function public.hg_card_quests_pick(date) from public, anon;

-- Progression des quêtes de la semaine pour le membre connecté.
create or replace function public.hg_card_quests_me()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare wk date := date_trunc('week', now() at time zone 'Europe/Zurich')::date;
  ws timestamptz := (wk::timestamp) at time zone 'Europe/Zurich';
  we timestamptz := ((wk + 7)::timestamp) at time zone 'Europe/Zurich';
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  return jsonb_build_object('week', wk, 'ends_at', we,
    'quests', coalesce((
      select jsonb_agg(jsonb_build_object(
          'code', t.code, 'label', t.label, 'metric', t.metric, 'target', t.target, 'reward', t.reward,
          'progress', v.value, 'done', v.value >= t.target,
          'claimed', exists (select 1 from hg_wallet_log l
            where l.user_id = auth.uid() and l.reason = 'quete' and l.ref = 'quete:' || wk::text || ':' || t.code))
        order by t.sort, t.code)
      from hg_card_quests_pick(wk) t
      cross join lateral (select hg_challenge_value(t.metric, auth.uid(), ws, least(we, now())) as value) v
    ), '[]'::jsonb));
end $$;

-- Réclamation : crédite la récompense une seule fois par semaine (ref unique).
create or replace function public.hg_card_quest_claim(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare wk date := date_trunc('week', now() at time zone 'Europe/Zurich')::date;
  ws timestamptz := (wk::timestamp) at time zone 'Europe/Zurich';
  we timestamptz := ((wk + 7)::timestamp) at time zone 'Europe/Zurich';
  q hg_card_quests_templates; v numeric;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  select t.* into q from hg_card_quests_pick(wk) t where t.code = p_code;
  if not found then raise exception 'Cette quête ne fait pas partie des quêtes de la semaine'; end if;
  v := hg_challenge_value(q.metric, auth.uid(), ws, least(we, now()));
  if v < q.target then raise exception 'Quête pas encore terminée (% sur %)', v, q.target; end if;
  if not hg_wallet_add(auth.uid(), q.reward, 'quete', 'quete:' || wk::text || ':' || q.code) then
    raise exception 'Cette quête a déjà été récompensée cette semaine';
  end if;
  return jsonb_build_object('code', q.code, 'reward', q.reward);
end $$;

revoke execute on function public.hg_card_quests_me() from public, anon;
revoke execute on function public.hg_card_quest_claim(text) from public, anon;
grant execute on function public.hg_card_quests_me() to authenticated;
grant execute on function public.hg_card_quest_claim(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Données de départ
-- ---------------------------------------------------------------------------
insert into public.hg_card_quests_templates (code, label, metric, target, reward, sort) values
  ('boosters_5',  'Ouvrir 5 boosters',                   'boosters_ouverts',  5,  80, 1),
  ('echange_1',   'Conclure un échange de cartes',       'echanges_conclus',  1,  50, 2),
  ('photo_1',     'Ajouter une photo',                   'photos_ajoutees',   1,  30, 3),
  ('recycle_5',   'Recycler 5 cartes',                   'cartes_recyclees',  5,  40, 4),
  ('jour_3',      'Passer 3 fois au passage du jour',    'passages_du_jour',  3,  30, 5),
  ('boosters_2',  'Ouvrir 2 boosters',                   'boosters_ouverts',  2,  30, 6)
on conflict (code) do nothing;

-- Exemple de défi, INACTIF : à activer depuis l'admin (section Défis).
insert into public.hg_challenges (id, title, description, metric, target, reward, starts_at, ends_at, active) values
  ('00000000-0000-4000-8000-000000000024', 'Vingt sorties ce trimestre',
   'Le gang fixe ensemble vingt sorties IRL. Chaque membre reçoit la récompense une seule fois.',
   'sorties_tenues', 20, 100, '2026-10-01 00:00:00+02', '2026-12-31 23:59:59+01', false)
on conflict (id) do nothing;
