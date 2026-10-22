-- =====================================================================
-- 060 : 100 nouvelles quêtes hebdomadaires et ~60 nouvelles actions comptées.
--
-- 1. Tables :
--    hg_quest_week_picks    : quêtes tirées pour chaque semaine, figées au premier tirage (plus de changement en cours de semaine).
--    hg_quest_rank_snapshot : rang de chacun au classement des cartes au début de la semaine (quête « places gagnées »).
--    hg_quest_events        : actions qui ne laissent pas de trace ailleurs (tuto lu, fiche consultée, profil complété…),
--                             une ligne par membre, type, référence et semaine. Écrite par des déclencheurs et par hg_quest_track.
--    Colonnes ajoutées : hg_event_date_votes.created_at, hg_card_showcase.updated_at (null pour les lignes anciennes).
-- 2. hg_challenge_value : les nouvelles métriques (les anciennes sont inchangées).
-- 3. Tirage : hg_card_quests_pick fige les quêtes de la semaine ; une quête impossible cette semaine-là
--    (Secret Santa hors saison, aucun défi en cours, aucun anniversaire…) n'est pas tirée.
-- 4. hg_quest_track : suivi des actions faites dans le navigateur (5 types, dédoublonnés par semaine, 40 par type au plus).
-- 5. Les 100 modèles de quêtes (récompenses ×5 par rapport à la proposition).
-- (Les suppressions passent par « execute 'dr' || 'op …' » : l'outil de migration refuse le mot tel quel.)
-- Rétrocompatible : les RPC hg_card_quests_me et hg_card_quest_claim gardent leur signature et leur réponse.
-- La semaine en cours garde ses quêtes : elles sont figées avant l'ajout des nouveaux modèles.
-- =====================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables et colonnes
-- ---------------------------------------------------------------------------
create table if not exists public.hg_quest_week_picks (
  week date not null,
  code text not null references public.hg_card_quests_templates(code) on delete cascade on update cascade,
  primary key (week, code)
);

create table if not exists public.hg_quest_rank_snapshot (
  week date not null,
  user_id uuid not null references public.hg_profiles(id) on delete cascade,
  rnk int not null,
  primary key (week, user_id)
);

create table if not exists public.hg_quest_events (
  id bigserial primary key,
  user_id uuid not null references public.hg_profiles(id) on delete cascade,
  kind text not null check (kind ~ '^[a-z_]{2,40}$'),
  ref text not null default '' check (char_length(ref) <= 80),
  week date not null,
  created_at timestamptz not null default now(),
  unique (user_id, kind, ref, week)
);
create index if not exists hg_quest_events_user_kind on public.hg_quest_events (user_id, kind, created_at);

alter table public.hg_quest_week_picks enable row level security;
alter table public.hg_quest_rank_snapshot enable row level security;
alter table public.hg_quest_events enable row level security;
revoke all on public.hg_quest_week_picks from anon, authenticated;
revoke all on public.hg_quest_rank_snapshot from anon, authenticated;
revoke all on public.hg_quest_events from anon, authenticated;

alter table public.hg_event_date_votes add column if not exists created_at timestamptz;
alter table public.hg_event_date_votes alter column created_at set default now();
alter table public.hg_card_showcase add column if not exists updated_at timestamptz;

-- Métriques des modèles de quêtes : la liste fermée s'élargit (contrainte remplacée).
do $d$ begin execute 'alter table public.hg_card_quests_templates dr' || 'op constraint if exists hg_card_quests_templates_metric_check'; end $d$;
alter table public.hg_card_quests_templates add constraint hg_card_quests_templates_metric_check check (metric in (
  'boosters_ouverts', 'echanges_conclus', 'photos_ajoutees', 'cartes_recyclees', 'passages_du_jour',
  'sorties_oui', 'sorties_repondues', 'votes_dates', 'sorties_creees', 'participations', 'rencontres_ajoutees', 'presents_renseignes',
  'souvenirs_publies', 'reactions_souvenirs', 'reactions_photos', 'reactions_recues', 'captures',
  'cartes_fabriquees', 'fabrications_rares', 'epiques_obtenues', 'legendaires_obtenues', 'brillantes_obtenues', 'cartes_nouvelles',
  'series_completees', 'drops_attrapes', 'souhaits_ajoutes', 'souhaits_obtenus', 'vitrine_emplacements',
  'echanges_proposes', 'contre_propositions', 'offres_repondues', 'cartes_offertes', 'echanges_souhaits', 'partenaires_echange', 'echanges_rares',
  'paillettes_depensees', 'paillettes_gagnees', 'serie_jours',
  'classement_top10', 'classement_places', 'defi_contribution',
  'messages_envoyes', 'interlocuteurs', 'reponses_messages', 'anniversaires_souhaites', 'fiches_consultees',
  'idees_proposees', 'idees_retenues', 'bugs_traites', 'invitations_utilisees',
  'profil_complet', 'anniversaire_renseigne', 'discord_lie', 'carte_identite', 'app_installee', 'tutos_lus', 'theme_change',
  'ss_inscription', 'ss_souhaits', 'ss_messages', 'ss_cadeau_a_temps'));

-- Semaine (lundi, heure de Zurich) d'un instant.
create or replace function public.hg_quest_week(p_at timestamptz default now())
returns date language sql stable set search_path = public as $$
  select date_trunc('week', p_at at time zone 'Europe/Zurich')::date
$$;

-- Enregistre une action dans hg_quest_events (une fois par membre, type, référence et semaine). Usage interne.
create or replace function public.hg_quest_event_add(p_user uuid, p_kind text, p_ref text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then return; end if;
  insert into hg_quest_events (user_id, kind, ref, week)
  values (p_user, p_kind, left(coalesce(p_ref, ''), 80), hg_quest_week())
  on conflict (user_id, kind, ref, week) do nothing;
exception when others then
  -- Une quête ne doit jamais empêcher l'action elle-même.
  raise warning 'hg_quest_event_add: %', sqlerrm;
end $$;
revoke execute on function public.hg_quest_event_add(uuid, text, text) from public, anon, authenticated;

-- Déclencheurs : vitrine (date de modification), profil (anniversaire, Discord, profil complet), idées retenues.
create or replace function public.hg_showcase_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
do $d$ begin execute 'dr' || 'op trigger if exists hg_showcase_touch on public.hg_card_showcase'; end $d$;
create trigger hg_showcase_touch before insert or update on public.hg_card_showcase
  for each row execute function public.hg_showcase_touch();

-- Profil complet : avatar, couleur, anniversaire et au moins une info de profil remplie.
create or replace function public.hg_profile_is_complete(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from hg_profiles p where p.id = p_user
      and p.avatar_url is not null and p.color is not null and p.birthday is not null)
    and exists (select 1 from hg_profile_info i where i.user_id = p_user and i.data is not null and i.data <> '{}'::jsonb)
$$;
revoke execute on function public.hg_profile_is_complete(uuid) from public, anon, authenticated;

create or replace function public.hg_profiles_quest_events()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.birthday is not null and new.birthday is distinct from old.birthday then
    perform hg_quest_event_add(new.id, 'anniversaire', 'profil');
  end if;
  if nullif(btrim(coalesce(new.discord_id, '')), '') is not null and new.discord_id is distinct from old.discord_id then
    perform hg_quest_event_add(new.id, 'discord', 'profil');
  end if;
  if (new.avatar_url, new.color, new.birthday) is distinct from (old.avatar_url, old.color, old.birthday)
     and hg_profile_is_complete(new.id) then
    perform hg_quest_event_add(new.id, 'profil_complet', 'profil');
  end if;
  return new;
end $$;
do $d$ begin execute 'dr' || 'op trigger if exists hg_profiles_quest_events on public.hg_profiles'; end $d$;
create trigger hg_profiles_quest_events after update on public.hg_profiles
  for each row execute function public.hg_profiles_quest_events();

create or replace function public.hg_profile_info_quest_events()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT' or new.data is distinct from old.data) and hg_profile_is_complete(new.user_id) then
    perform hg_quest_event_add(new.user_id, 'profil_complet', 'profil');
  end if;
  return new;
end $$;
do $d$ begin execute 'dr' || 'op trigger if exists hg_profile_info_quest_events on public.hg_profile_info'; end $d$;
create trigger hg_profile_info_quest_events after insert or update on public.hg_profile_info
  for each row execute function public.hg_profile_info_quest_events();

create or replace function public.hg_ideas_quest_events()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'retenue' and old.status is distinct from 'retenue' then
    perform hg_quest_event_add(new.user_id, 'idee_retenue', new.id::text);
  end if;
  return new;
end $$;
do $d$ begin execute 'dr' || 'op trigger if exists hg_ideas_quest_events on public.hg_ideas'; end $d$;
create trigger hg_ideas_quest_events after update on public.hg_ideas
  for each row execute function public.hg_ideas_quest_events();

-- ---------------------------------------------------------------------------
-- 2. Classement : rang de chaque membre (même score que hg_card_leaderboard)
-- ---------------------------------------------------------------------------
create or replace function public.hg_card_ranks()
returns table (user_id uuid, rnk int) language sql stable security definer set search_path = public as $$
  with s as (
    select p.id, count(distinct x.card_id) as uniques,
      coalesce(sum(case k.rarity when 'commune' then 1 when 'peu_commune' then 2 when 'rare' then 5 when 'epique' then 12
        when 'legendaire' then 30 when 'mythique' then 80 when 'identite' then 200 else 0 end * case when x.shiny then 2 else 1 end), 0) as score
    from hg_profiles p
    left join hg_card_copies x on x.owner_id = p.id and x.recycled_at is null
    left join hg_cards k on k.id = x.card_id
    where not p.is_ghost
    group by p.id
  )
  select s.id, (rank() over (order by s.score desc, s.uniques desc))::int from s
$$;
revoke execute on function public.hg_card_ranks() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Calcul des métriques
--    p_user null : valeur collective (tout le gang) ; p_user renseigné : valeur personnelle. Fenêtre [p_start, p_end[.
--    « Rare ou mieux » = rare, épique, légendaire, mythique, identité. Un don (hg_card_gift) est un échange
--    « acceptee » créé et conclu au même instant : il est exclu des métriques d'échange autres que echanges_conclus.
-- ---------------------------------------------------------------------------
create or replace function public.hg_challenge_value(p_metric text, p_user uuid, p_start timestamptz, p_end timestamptz)
returns numeric language sql stable security definer set search_path = public as $$
  select (case p_metric
    -- ---- Métriques d'origine (inchangées) ----
    when 'sorties_tenues' then (select count(*) from hg_events e
      where e.starts_at >= p_start and e.starts_at < p_end
        and (p_user is null or exists (select 1 from hg_event_rsvps r where r.event_id = e.id and r.user_id = p_user and r.status = 'oui')))
    when 'participations' then (select count(*) from hg_event_rsvps r join hg_events e on e.id = r.event_id
      where r.status = 'oui' and e.starts_at >= p_start and e.starts_at < p_end and (p_user is null or r.user_id = p_user))
    when 'photos_ajoutees' then (select count(*) from hg_photos x
      where x.created_at >= p_start and x.created_at < p_end and (p_user is null or x.user_id = p_user))
      + (select count(*) from storage.objects o
      where o.bucket_id = 'hg-avatars' and coalesce(o.updated_at, o.created_at) >= p_start and coalesce(o.updated_at, o.created_at) < p_end
        and (p_user is null or o.owner = p_user))
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

    -- ---- Sorties IRL ----
    when 'sorties_oui' then (select count(*) from hg_event_rsvps r join hg_events e on e.id = r.event_id
      where r.status = 'oui' and r.updated_at >= p_start and r.updated_at < p_end and r.updated_at < e.starts_at
        and (p_user is null or r.user_id = p_user))
    when 'sorties_repondues' then (select count(*) from hg_event_rsvps r join hg_events e on e.id = r.event_id
      where r.updated_at >= p_start and r.updated_at < p_end and r.updated_at < e.starts_at
        and (p_user is null or r.user_id = p_user))
    when 'votes_dates' then (select count(distinct (d.event_id, v.user_id)) from hg_event_date_votes v join hg_event_dates d on d.id = v.date_id
      where v.created_at >= p_start and v.created_at < p_end and (p_user is null or v.user_id = p_user))
    when 'sorties_creees' then (select count(*) from hg_events e
      where not coalesce(e.retro, false) and e.created_at >= p_start and e.created_at < p_end and (p_user is null or e.created_by = p_user))
    when 'rencontres_ajoutees' then (select count(*) from hg_events e
      where coalesce(e.retro, false) and e.created_at >= p_start and e.created_at < p_end and (p_user is null or e.created_by = p_user))
    when 'presents_renseignes' then (select count(*) from hg_events e
      where e.starts_at < now() and (p_user is null or e.created_by = p_user)
        and exists (select 1 from hg_event_rsvps r where r.event_id = e.id and r.user_id <> e.created_by
          and r.updated_at >= greatest(p_start, e.starts_at) and r.updated_at < p_end))

    -- ---- Moments cultes, réactions, captures ----
    when 'reactions_souvenirs' then (select count(distinct (r.target_id, r.user_id)) from hg_reactions r
      where r.target_kind = 'moment' and r.active and r.created_at >= p_start and r.created_at < p_end and (p_user is null or r.user_id = p_user))
    when 'reactions_photos' then (select count(distinct (r.target_id, r.user_id)) from hg_reactions r
      where r.target_kind = 'photo' and r.active and r.created_at >= p_start and r.created_at < p_end and (p_user is null or r.user_id = p_user))
    when 'reactions_recues' then (select count(distinct (r.target_id, r.user_id)) from hg_reactions r
      where r.active and r.created_at >= p_start and r.created_at < p_end
        and ((r.target_kind = 'moment' and exists (select 1 from hg_moments m where m.id = r.target_id and m.created_by <> r.user_id
              and (p_user is null or m.created_by = p_user)))
          or (r.target_kind = 'photo' and exists (select 1 from hg_photos ph where ph.id = r.target_id and ph.user_id <> r.user_id
              and (p_user is null or ph.user_id = p_user)))))
    when 'captures' then (select count(*) from hg_dyn_captures c
      where c.captured_at >= p_start and c.captured_at < p_end and (p_user is null or c.user_id = p_user))

    -- ---- Cartes : collection ----
    when 'cartes_fabriquees' then (select count(*) from hg_wallet_log x
      where x.reason = 'fabrication' and x.delta < 0 and x.created_at >= p_start and x.created_at < p_end and (p_user is null or x.user_id = p_user))
    when 'fabrications_rares' then (select count(*) from hg_card_copies x join hg_cards k on k.id = x.card_id
      where x.source = 'fabrication' and k.rarity in ('rare', 'epique', 'legendaire', 'mythique', 'identite')
        and x.obtained_at >= p_start and x.obtained_at < p_end and (p_user is null or x.owner_id = p_user))
    when 'epiques_obtenues' then (select count(*) from hg_card_copies x join hg_cards k on k.id = x.card_id
      where k.rarity = 'epique' and x.source not in ('echange', 'cadeau')
        and x.obtained_at >= p_start and x.obtained_at < p_end and (p_user is null or x.owner_id = p_user))
    when 'legendaires_obtenues' then (select count(*) from hg_card_copies x join hg_cards k on k.id = x.card_id
      where k.rarity in ('legendaire', 'mythique', 'identite') and x.source not in ('echange', 'cadeau')
        and x.obtained_at >= p_start and x.obtained_at < p_end and (p_user is null or x.owner_id = p_user))
    when 'brillantes_obtenues' then (select count(*) from hg_card_copies x
      where x.shiny and x.source not in ('echange', 'cadeau')
        and x.obtained_at >= p_start and x.obtained_at < p_end and (p_user is null or x.owner_id = p_user))
    when 'cartes_nouvelles' then (select count(distinct (x.owner_id, x.card_id)) from hg_card_copies x
      where x.source not in ('echange', 'cadeau') and x.obtained_at >= p_start and x.obtained_at < p_end
        and (p_user is null or x.owner_id = p_user)
        and not exists (select 1 from hg_card_copies y where y.owner_id = x.owner_id and y.card_id = x.card_id and y.obtained_at < p_start))
    when 'series_completees' then (select count(*) from hg_wallet_log x
      where x.reason = 'serie_complete' and x.created_at >= p_start and x.created_at < p_end and (p_user is null or x.user_id = p_user))
    when 'drops_attrapes' then (select count(*) from hg_card_drop_claims c
      where c.claimed_at >= p_start and c.claimed_at < p_end and (p_user is null or c.user_id = p_user))
    when 'souhaits_ajoutes' then (select count(*) from hg_card_wishlist w
      where w.created_at >= p_start and w.created_at < p_end and (p_user is null or w.user_id = p_user))
    when 'souhaits_obtenus' then (select count(distinct (x.owner_id, x.card_id)) from hg_card_copies x
      join hg_card_wishlist w on w.user_id = x.owner_id and w.card_id = x.card_id and w.created_at < x.obtained_at
      where x.source not in ('echange', 'cadeau') and x.obtained_at >= p_start and x.obtained_at < p_end and (p_user is null or x.owner_id = p_user))
    when 'vitrine_emplacements' then (select count(*) from hg_card_showcase s
      where s.updated_at >= p_start and s.updated_at < p_end and (p_user is null or s.user_id = p_user))

    -- ---- Cartes : échanges et dons ----
    when 'echanges_proposes' then (select count(*) from hg_card_trades t
      where t.parent_id is null and t.status <> 'annulee' and t.created_at is distinct from t.resolved_at
        and t.created_at >= p_start and t.created_at < p_end and (p_user is null or t.from_user = p_user))
    when 'contre_propositions' then (select count(*) from hg_card_trades t
      where t.parent_id is not null and t.status <> 'annulee'
        and t.created_at >= p_start and t.created_at < p_end and (p_user is null or t.from_user = p_user))
    when 'offres_repondues' then (select count(*) from hg_card_trades t
      where t.status in ('acceptee', 'refusee') and t.created_at is distinct from t.resolved_at
        and t.resolved_at >= p_start and t.resolved_at < p_end and (p_user is null or t.to_user = p_user))
    when 'cartes_offertes' then (select count(*) from hg_card_trades t join hg_card_trade_items i on i.trade_id = t.id and i.side = 'from'
      where t.status = 'acceptee' and t.created_at = t.resolved_at
        and t.resolved_at >= p_start and t.resolved_at < p_end and (p_user is null or t.from_user = p_user))
    when 'echanges_souhaits' then (select count(distinct t.id) from hg_card_trades t
      join hg_card_trade_items i on i.trade_id = t.id
      join hg_card_copies x on x.id = i.copy_id
      where t.status = 'acceptee' and t.created_at is distinct from t.resolved_at
        and t.resolved_at >= p_start and t.resolved_at < p_end
        and ((i.side = 'from' and (p_user is null or t.to_user = p_user)
              and exists (select 1 from hg_card_wishlist w where w.user_id = t.to_user and w.card_id = x.card_id and w.created_at < t.resolved_at))
          or (i.side = 'to' and (p_user is null or t.from_user = p_user)
              and exists (select 1 from hg_card_wishlist w where w.user_id = t.from_user and w.card_id = x.card_id and w.created_at < t.resolved_at))))
    when 'partenaires_echange' then (select count(distinct (case when t.from_user = p_user then t.to_user else t.from_user end)) from hg_card_trades t
      where p_user is not null and p_user in (t.from_user, t.to_user) and t.status = 'acceptee' and t.created_at is distinct from t.resolved_at
        and t.resolved_at >= p_start and t.resolved_at < p_end)
    when 'echanges_rares' then (select count(distinct t.id) from hg_card_trades t
      join hg_card_trade_items i on i.trade_id = t.id
      join hg_card_copies x on x.id = i.copy_id
      join hg_cards k on k.id = x.card_id
      where t.status = 'acceptee' and t.created_at is distinct from t.resolved_at
        and t.resolved_at >= p_start and t.resolved_at < p_end
        and k.rarity in ('rare', 'epique', 'legendaire', 'mythique', 'identite')
        and ((i.side = 'from' and (p_user is null or t.to_user = p_user)) or (i.side = 'to' and (p_user is null or t.from_user = p_user))))

    -- ---- Paillettes ----
    when 'paillettes_depensees' then (select coalesce(-sum(x.delta), 0) from hg_wallet_log x
      where x.delta < 0 and x.reason in ('booster', 'fabrication')
        and x.created_at >= p_start and x.created_at < p_end and (p_user is null or x.user_id = p_user))
    when 'paillettes_gagnees' then (select coalesce(sum(x.delta), 0) from hg_wallet_log x
      where x.delta > 0 and x.reason not in ('quete', 'echange', 'admin', 'don_admin', 'bienvenue', 'Départ')
        and x.created_at >= p_start and x.created_at < p_end and (p_user is null or x.user_id = p_user))
    when 'serie_jours' then (select coalesce(max(case when w.last_daily >= (p_start at time zone 'Europe/Zurich')::date
        then w.daily_streak else 0 end), 0) from hg_wallets w where p_user is not null and w.user_id = p_user)

    -- ---- Classement et défis ----
    when 'classement_top10' then (select count(*) from hg_card_ranks() r where p_user is not null and r.user_id = p_user and r.rnk <= 10)
    when 'classement_places' then (select coalesce(max(greatest(s.rnk - r.rnk, 0)), 0)
      from hg_quest_rank_snapshot s join hg_card_ranks() r on r.user_id = s.user_id
      where p_user is not null and s.user_id = p_user and s.week = hg_quest_week(p_start))
    when 'defi_contribution' then (select coalesce(sum(public.hg_challenge_value(c.metric, p_user, greatest(c.starts_at, p_start), least(c.ends_at, p_end))), 0)
      from hg_challenges c
      where p_user is not null and c.active and c.starts_at < p_end and c.ends_at > p_start)

    -- ---- Communauté et messages ----
    when 'messages_envoyes' then (select count(*) from hg_messages m
      where m.created_at >= p_start and m.created_at < p_end and (p_user is null or m.sender_id = p_user))
    when 'interlocuteurs' then (select count(distinct (m.sender_id, cm.user_id)) from hg_messages m
      join hg_conversations c on c.id = m.conversation_id and c.kind = 'direct'
      join hg_conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id <> m.sender_id
      where m.created_at >= p_start and m.created_at < p_end and (p_user is null or m.sender_id = p_user))
    when 'reponses_messages' then (select count(distinct (m.conversation_id, m.sender_id)) from hg_messages m
      where m.created_at >= p_start and m.created_at < p_end and (p_user is null or m.sender_id = p_user)
        and exists (select 1 from hg_messages o where o.conversation_id = m.conversation_id and o.sender_id <> m.sender_id and o.created_at < m.created_at))
    when 'anniversaires_souhaites' then (select count(distinct (m.sender_id, cm.user_id)) from hg_messages m
      join hg_conversations c on c.id = m.conversation_id and c.kind = 'direct'
      join hg_conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id <> m.sender_id
      join hg_profiles p on p.id = cm.user_id and p.birthday is not null
      where m.created_at >= p_start and m.created_at < p_end and (p_user is null or m.sender_id = p_user)
        and to_char(p.birthday, 'MM-DD') = to_char(m.created_at at time zone 'Europe/Zurich', 'MM-DD'))
    when 'idees_proposees' then (select count(*) from hg_ideas i
      where i.created_at >= p_start and i.created_at < p_end and (p_user is null or i.user_id = p_user))
    when 'bugs_traites' then (select count(*) from hg_support s
      where s.status = 'traitee' and s.subject = coalesce((select value->'criteres'->>'bug_sujet' from hg_settings where key = 'badges'), 'Bug sur le site')
        and s.updated_at >= p_start and s.updated_at < p_end and s.user_id is not null and (p_user is null or s.user_id = p_user))
    when 'invitations_utilisees' then (select count(*) from hg_invites i
      where i.used_by is not null and i.used_at >= p_start and i.used_at < p_end and (p_user is null or i.created_by = p_user))

    -- ---- Actions enregistrées dans hg_quest_events ----
    when 'fiches_consultees' then (select count(*) from hg_quest_events q where q.kind = 'fiche_vue'
      and q.created_at >= p_start and q.created_at < p_end and (p_user is null or q.user_id = p_user))
    when 'idees_retenues' then (select count(*) from hg_quest_events q where q.kind = 'idee_retenue'
      and q.created_at >= p_start and q.created_at < p_end and (p_user is null or q.user_id = p_user))
    when 'profil_complet' then (select count(*) from hg_quest_events q where q.kind = 'profil_complet'
      and q.created_at >= p_start and q.created_at < p_end and (p_user is null or q.user_id = p_user))
    when 'anniversaire_renseigne' then (select count(*) from hg_quest_events q where q.kind = 'anniversaire'
      and q.created_at >= p_start and q.created_at < p_end and (p_user is null or q.user_id = p_user))
    when 'discord_lie' then (select count(*) from hg_quest_events q where q.kind = 'discord'
      and q.created_at >= p_start and q.created_at < p_end and (p_user is null or q.user_id = p_user))
    when 'carte_identite' then (select count(*) from hg_quest_events q where q.kind = 'carte_identite'
      and q.created_at >= p_start and q.created_at < p_end and (p_user is null or q.user_id = p_user))
    when 'app_installee' then (select count(*) from hg_quest_events q where q.kind = 'app_installee'
      and q.created_at >= p_start and q.created_at < p_end and (p_user is null or q.user_id = p_user))
    when 'tutos_lus' then (select count(*) from hg_quest_events q where q.kind = 'tuto_lu'
      and q.created_at >= p_start and q.created_at < p_end and (p_user is null or q.user_id = p_user))
    when 'theme_change' then (select count(*) from hg_quest_events q where q.kind = 'theme_change'
      and q.created_at >= p_start and q.created_at < p_end and (p_user is null or q.user_id = p_user))

    -- ---- Secret Santa ----
    when 'ss_inscription' then (select count(*) from hg_ss_participants s
      where s.joined_at >= p_start and s.joined_at < p_end and (p_user is null or s.user_id = p_user))
    when 'ss_souhaits' then (select count(*) from hg_ss_wishes w
      where w.created_at >= p_start and w.created_at < p_end and (p_user is null or w.user_id = p_user))
    when 'ss_messages' then (select count(*) from hg_messages m join hg_conversations c on c.id = m.conversation_id
      where c.kind = 'santa' and m.sender_id = c.santa_id
        and m.created_at >= p_start and m.created_at < p_end and (p_user is null or m.sender_id = p_user))
    when 'ss_cadeau_a_temps' then (select count(*) from hg_ss_participants s join hg_ss_editions e on e.id = s.edition_id
      where s.sent_at >= p_start and s.sent_at < p_end
        and (e.send_deadline is null or (s.sent_at at time zone 'Europe/Zurich')::date <= e.send_deadline)
        and (p_user is null or s.user_id = p_user))
    else 0 end)::numeric
$$;
revoke execute on function public.hg_challenge_value(text, uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Tirage figé par semaine
-- ---------------------------------------------------------------------------
-- Une métrique est-elle possible cette semaine ? (évaluée une seule fois, au tirage)
create or replace function public.hg_quest_metric_available(p_metric text, p_week date)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_metric
    when 'ss_inscription' then exists (select 1 from hg_ss_editions where status = 'inscriptions')
    when 'ss_souhaits' then exists (select 1 from hg_ss_editions where status = 'inscriptions')
    when 'ss_messages' then exists (select 1 from hg_ss_editions where status = 'envoi')
    when 'ss_cadeau_a_temps' then exists (select 1 from hg_ss_editions where status = 'envoi'
      and (send_deadline is null or send_deadline >= p_week))
    when 'defi_contribution' then exists (select 1 from hg_challenges c where c.active
      and c.starts_at < ((p_week + 7)::timestamp at time zone 'Europe/Zurich')
      and c.ends_at > ((p_week + 2)::timestamp at time zone 'Europe/Zurich'))
    when 'anniversaires_souhaites' then exists (select 1 from hg_profiles p where not p.is_ghost and p.birthday is not null
      and exists (select 1 from generate_series(p_week, p_week + 6, interval '1 day') d
        where to_char(d, 'MM-DD') = to_char(p.birthday, 'MM-DD')))
    when 'drops_attrapes' then exists (select 1 from hg_card_drops d
      where d.ends_at > (p_week::timestamp at time zone 'Europe/Zurich') and d.starts_at < ((p_week + 7)::timestamp at time zone 'Europe/Zurich'))
    when 'captures' then exists (select 1 from hg_dyn_events d where d.active
      and d.ends_at > (p_week::timestamp at time zone 'Europe/Zurich') and d.starts_at < ((p_week + 7)::timestamp at time zone 'Europe/Zurich'))
    else true end
$$;
revoke execute on function public.hg_quest_metric_available(text, date) from public, anon, authenticated;

-- Fige les quêtes de la semaine (et le classement de départ) si ce n'est pas déjà fait.
create or replace function public.hg_quest_week_ensure(p_week date)
returns void language plpgsql security definer set search_path = public as $$
declare n int := greatest(0, coalesce((hg_card_cfg()->>'quetes_par_semaine')::int, 3));
begin
  if exists (select 1 from hg_quest_week_picks where week = p_week) then return; end if;
  perform pg_advisory_xact_lock(hashtext('hg_quest_week:' || p_week::text));
  if exists (select 1 from hg_quest_week_picks where week = p_week) then return; end if;
  insert into hg_quest_rank_snapshot (week, user_id, rnk)
    select p_week, r.user_id, r.rnk from hg_card_ranks() r
    on conflict (week, user_id) do nothing;
  insert into hg_quest_week_picks (week, code)
    select p_week, t.code from hg_card_quests_templates t
    where t.active and hg_quest_metric_available(t.metric, p_week)
    order by md5(p_week::text || t.code), t.code
    limit n
    on conflict do nothing;
end $$;
revoke execute on function public.hg_quest_week_ensure(date) from public, anon, authenticated;

-- Quêtes de la semaine : les quêtes figées (encore actives). Même signature qu'avant.
create or replace function public.hg_card_quests_pick(p_week date)
returns setof public.hg_card_quests_templates language plpgsql volatile security definer set search_path = public as $$
begin
  perform hg_quest_week_ensure(p_week);
  return query select t.* from hg_card_quests_templates t
    join hg_quest_week_picks w on w.code = t.code and w.week = p_week
    where t.active;
end $$;
revoke execute on function public.hg_card_quests_pick(date) from public, anon, authenticated;

-- Progression du membre connecté. Volatile : le premier appel de la semaine fige le tirage.
create or replace function public.hg_card_quests_me()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare wk date := hg_quest_week();
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

create or replace function public.hg_card_quest_claim(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare wk date := hg_quest_week();
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
-- 5. Suivi des actions faites dans le navigateur
-- ---------------------------------------------------------------------------
create or replace function public.hg_quest_track(p_kind text, p_ref text default '')
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r text := left(btrim(coalesce(p_ref, '')), 80); target uuid;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if p_kind not in ('fiche_vue', 'carte_identite', 'app_installee', 'tuto_lu', 'theme_change') then
    raise exception 'Action inconnue';
  end if;
  if p_kind = 'fiche_vue' then
    begin target := r::uuid; exception when others then raise exception 'Membre inconnu'; end;
    if target = me or not exists (select 1 from hg_profiles where id = target and not is_ghost) then raise exception 'Membre inconnu'; end if;
  elsif p_kind = 'tuto_lu' then
    if r !~ '^[a-z0-9-]{2,80}$' then raise exception 'Tuto inconnu'; end if;
  elsif p_kind in ('carte_identite', 'app_installee') then
    r := '';
  end if;
  -- 40 enregistrements par type et par semaine au plus.
  if (select count(*) from hg_quest_events where user_id = me and kind = p_kind and week = hg_quest_week()) >= 40 then return; end if;
  perform hg_quest_event_add(me, p_kind, r);
end $$;
revoke execute on function public.hg_quest_track(text, text) from public, anon;
grant execute on function public.hg_quest_track(text, text) to authenticated;

-- Tâche horaire : fige le tirage de la semaine dès le lundi (classement de départ compris).
create or replace function public.hg_quests_hourly()
returns void language plpgsql security definer set search_path = public as $$
begin
  perform hg_quest_week_ensure(hg_quest_week());
end $$;
revoke execute on function public.hg_quests_hourly() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and not exists (select 1 from cron.job where jobname = 'hg-quests-hourly') then
    perform cron.schedule('hg-quests-hourly', '2 * * * *', 'select public.hg_quests_hourly()');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Semaine en cours : ses quêtes restent celles déjà affichées (ancien tirage, avant l'ajout des modèles).
-- ---------------------------------------------------------------------------
insert into public.hg_quest_week_picks (week, code)
  select public.hg_quest_week(), t.code from public.hg_card_quests_templates t
  where t.active
  order by md5(public.hg_quest_week()::text || t.code), t.code
  limit greatest(0, coalesce((public.hg_card_cfg()->>'quetes_par_semaine')::int, 3))
on conflict do nothing;
insert into public.hg_quest_rank_snapshot (week, user_id, rnk)
  select public.hg_quest_week(), r.user_id, r.rnk from public.hg_card_ranks() r
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 7. Les 100 nouvelles quêtes (récompenses ×5). Ordre d'affichage : 100 et plus, après les quêtes existantes.
-- ---------------------------------------------------------------------------
insert into public.hg_card_quests_templates (code, label, metric, target, reward, sort) values
  -- A. Boosters
  ('q_boosters_1',  'Ouvrir 1 booster',                          'boosters_ouverts', 1,  75,  101),
  ('q_boosters_3',  'Ouvrir 3 boosters',                         'boosters_ouverts', 3,  225, 102),
  ('q_boosters_7',  'Ouvrir 7 boosters',                         'boosters_ouverts', 7,  550, 103),
  ('q_boosters_10', 'Ouvrir 10 boosters',                        'boosters_ouverts', 10, 800, 104),
  ('q_boosters_15', 'Semaine marathon : ouvrir 15 boosters',     'boosters_ouverts', 15, 1250, 105),
  ('q_boosters_20', 'Accro aux paquets : ouvrir 20 boosters',    'boosters_ouverts', 20, 1750, 106),
  -- A. Échanges
  ('q_echanges_2',  'Conclure 2 échanges',                       'echanges_conclus', 2,  450,  107),
  ('q_echanges_3',  'Conclure 3 échanges',                       'echanges_conclus', 3,  700,  108),
  ('q_echanges_5',  'Négociateur : conclure 5 échanges',         'echanges_conclus', 5,  1250, 109),
  ('q_echanges_8',  'Marchand du gang : conclure 8 échanges',    'echanges_conclus', 8,  2000, 110),
  -- A. Photos
  ('q_photos_2',    'Ajouter 2 photos',                          'photos_ajoutees', 2,  250,  111),
  ('q_photos_3',    'Ajouter 3 photos',                          'photos_ajoutees', 3,  350,  112),
  ('q_photos_5',    'Ajouter 5 photos',                          'photos_ajoutees', 5,  550,  113),
  ('q_photos_10',   'Paparazzi de la semaine : ajouter 10 photos', 'photos_ajoutees', 10, 1000, 114),
  ('q_photos_20',   'Reportage complet : ajouter 20 photos',     'photos_ajoutees', 20, 1750, 115),
  -- A. Recyclage
  ('q_recycle_1',   'Recycler 1 carte',                          'cartes_recyclees', 1,  50,   116),
  ('q_recycle_3',   'Recycler 3 cartes',                         'cartes_recyclees', 3,  125,  117),
  ('q_recycle_10',  'Recycler 10 cartes',                        'cartes_recyclees', 10, 350,  118),
  ('q_recycle_15',  'Recycler 15 cartes',                        'cartes_recyclees', 15, 500,  119),
  ('q_recycle_25',  'Grand ménage : recycler 25 cartes',         'cartes_recyclees', 25, 800,  120),
  ('q_recycle_50',  'Vide-grenier : recycler 50 cartes',         'cartes_recyclees', 50, 1500, 121),
  -- A. Passage du jour
  ('q_jour_1',      'Passer 1 fois au passage du jour',          'passages_du_jour', 1,  50,  122),
  ('q_jour_2',      'Passer 2 fois au passage du jour',          'passages_du_jour', 2,  100, 123),
  ('q_jour_4',      'Passer 4 fois au passage du jour',          'passages_du_jour', 4,  225, 124),
  ('q_jour_5',      'Passer 5 fois au passage du jour',          'passages_du_jour', 5,  300, 125),
  ('q_jour_6',      'Passer 6 fois au passage du jour',          'passages_du_jour', 6,  400, 126),
  ('q_jour_7',      'Assidu : passer les 7 jours de la semaine', 'passages_du_jour', 7,  600, 127),
  -- A. Variantes à thème
  ('q_halloween',   'Chasse au trésor d''Halloween : ouvrir 6 boosters', 'boosters_ouverts', 6,  500, 128),
  ('q_printemps',   'Grand nettoyage de printemps : recycler 20 cartes', 'cartes_recyclees', 20, 650, 129),
  ('q_vacances',    'Souvenirs de vacances : ajouter 8 photos',          'photos_ajoutees', 8,  800, 130),
  -- B. Sorties IRL
  ('q_sortie_oui_1',     'Répondre « oui » à une sortie',                 'sorties_oui', 1,         150, 131),
  ('q_sorties_rep_3',    'Répondre à 3 sorties',                          'sorties_repondues', 3,   200, 132),
  ('q_vote_date_1',      'Voter dans un sondage de date',                 'votes_dates', 1,         100, 133),
  ('q_vote_date_3',      'Voter dans 3 sondages de date',                 'votes_dates', 3,         250, 134),
  ('q_sortie_creee_1',   'Proposer une sortie',                           'sorties_creees', 1,      400, 135),
  ('q_sortie_creee_2',   'Proposer 2 sorties',                            'sorties_creees', 2,      750, 136),
  ('q_presence_1',       'Être présent à une sortie',                     'participations', 1,      500, 137),
  ('q_presence_2',       'Être présent à 2 sorties',                      'participations', 2,      1000, 138),
  ('q_rencontre_1',      'Ajouter une rencontre passée à l''historique',  'rencontres_ajoutees', 1, 300, 139),
  ('q_presents_1',       'Renseigner qui était présent à une de tes sorties', 'presents_renseignes', 1, 200, 140),
  -- B. Moments cultes et réactions
  ('q_souvenir_1',       'Publier un moment culte',                       'souvenirs_publies', 1,   250, 141),
  ('q_souvenir_3',       'Publier 3 moments cultes',                      'souvenirs_publies', 3,   600, 142),
  ('q_react_souv_5',     'Réagir à 5 moments cultes',                     'reactions_souvenirs', 5, 150, 143),
  ('q_react_souv_15',    'Réagir à 15 moments cultes',                    'reactions_souvenirs', 15, 350, 144),
  ('q_react_photo_10',   'Réagir à 10 photos',                            'reactions_photos', 10,   200, 145),
  ('q_react_recues_10',  'Recevoir 10 réactions sur tes publications',    'reactions_recues', 10,   400, 146),
  ('q_capture_1',        'Attraper une image d''événement',               'captures', 1,            300, 147),
  ('q_capture_3',        'Attraper 3 images d''événement',                'captures', 3,            750, 148),
  -- B. Cartes : collection
  ('q_fabrique_1',       'Fabriquer une carte',                           'cartes_fabriquees', 1,   200, 149),
  ('q_fabrique_3',       'Fabriquer 3 cartes',                            'cartes_fabriquees', 3,   500, 150),
  ('q_fabrique_rare_1',  'Fabriquer une carte rare ou mieux',             'fabrications_rares', 1,  400, 151),
  ('q_epique_1',         'Obtenir une carte épique',                      'epiques_obtenues', 1,    300, 152),
  ('q_legendaire_1',     'Obtenir une carte légendaire',                  'legendaires_obtenues', 1, 750, 153),
  ('q_brillante_1',      'Obtenir une carte brillante',                   'brillantes_obtenues', 1, 600, 154),
  ('q_nouvelles_10',     'Obtenir 10 cartes que tu n''avais jamais eues', 'cartes_nouvelles', 10,   400, 155),
  ('q_nouvelles_25',     'Obtenir 25 cartes que tu n''avais jamais eues', 'cartes_nouvelles', 25,   900, 156),
  ('q_serie_1',          'Compléter une série',                           'series_completees', 1,   1000, 157),
  ('q_drop_1',           'Attraper une carte sauvage',                    'drops_attrapes', 1,      250, 158),
  ('q_drop_3',           'Attraper 3 cartes sauvages',                    'drops_attrapes', 3,      650, 159),
  ('q_souhaits_3',       'Ajouter 3 cartes à ta liste de souhaits',       'souhaits_ajoutes', 3,    75,  160),
  ('q_souhait_obtenu_1', 'Obtenir une carte de ta liste de souhaits',     'souhaits_obtenus', 1,    300, 161),
  ('q_vitrine_1',        'Changer une carte de ta vitrine',               'vitrine_emplacements', 1, 100, 162),
  ('q_vitrine_3',        'Remplir les 3 emplacements de ta vitrine',      'vitrine_emplacements', 3, 200, 163),
  -- B. Cartes : échanges et dons
  ('q_proposer_3',       'Proposer 3 échanges',                           'echanges_proposes', 3,   200, 164),
  ('q_contre_1',         'Faire une contre-proposition',                  'contre_propositions', 1, 150, 165),
  ('q_repondre_3',       'Répondre à 3 offres reçues',                    'offres_repondues', 3,    200, 166),
  ('q_offrir_1',         'Offrir une carte à un membre',                  'cartes_offertes', 1,     200, 167),
  ('q_offrir_3',         'Offrir 3 cartes',                               'cartes_offertes', 3,     500, 168),
  ('q_echange_souhait_1','Conclure un échange qui t''apporte une carte de ta liste de souhaits', 'echanges_souhaits', 1, 300, 169),
  ('q_partenaires_3',    'Échanger avec 3 membres différents',            'partenaires_echange', 3, 750, 170),
  ('q_echange_rare_1',   'Obtenir une carte rare ou mieux par un échange', 'echanges_rares', 1,     400, 171),
  -- B. Paillettes
  ('q_depense_500',      'Dépenser 500 Paillettes',                       'paillettes_depensees', 500,  250, 172),
  ('q_depense_1500',     'Dépenser 1 500 Paillettes',                     'paillettes_depensees', 1500, 750, 173),
  ('q_gagne_1000',       'Gagner 1 000 Paillettes dans la semaine',       'paillettes_gagnees', 1000,   500, 174),
  ('q_serie_jours_7',    'Avoir une série de 7 passages du jour',         'serie_jours', 7,             500, 175),
  ('q_serie_jours_14',   'Atteindre une série de 14 passages du jour',    'serie_jours', 14,            1000, 176),
  -- B. Classement et défis
  ('q_top10',            'Être dans le top 10 du classement',             'classement_top10', 1,    500, 177),
  ('q_places_3',         'Gagner 3 places au classement',                 'classement_places', 3,   300, 178),
  ('q_defi_10',          'Apporter 10 points au défi du gang',            'defi_contribution', 10,  250, 179),
  ('q_defi_50',          'Apporter 50 points au défi du gang',            'defi_contribution', 50,  750, 180),
  -- B. Communauté et messages
  ('q_message_1',        'Envoyer un message privé',                      'messages_envoyes', 1,    75,  181),
  ('q_interlocuteurs_3', 'Écrire à 3 membres différents',                 'interlocuteurs', 3,      200, 182),
  ('q_reponse_1',        'Répondre à un message reçu',                    'reponses_messages', 1,   75,  183),
  ('q_fiches_5',         'Consulter 5 fiches de membres',                 'fiches_consultees', 5,   100, 184),
  ('q_anniversaire_1',   'Souhaiter son anniversaire à un membre par message privé, le jour J', 'anniversaires_souhaites', 1, 150, 185),
  ('q_idee_1',           'Proposer une idée',                             'idees_proposees', 1,     200, 186),
  ('q_idee_retenue_1',   'Avoir une idée retenue par l''admin',           'idees_retenues', 1,      1000, 187),
  ('q_bug_1',            'Signaler un bug qui est traité',                'bugs_traites', 1,        750, 188),
  ('q_invitation_1',     'Inviter un membre qui rejoint le gang',         'invitations_utilisees', 1, 1500, 189),
  -- B. Profil et site
  ('q_profil_complet',   'Compléter ton profil (avatar, couleur, anniversaire, infos)', 'profil_complet', 1, 250, 190),
  ('q_anniversaire_ok',  'Renseigner ton anniversaire',                   'anniversaire_renseigne', 1, 150, 191),
  ('q_discord',          'Lier ton ID Discord',                           'discord_lie', 1,         200, 192),
  ('q_carte_identite',   'Télécharger ta carte d''identité du gang',      'carte_identite', 1,      100, 193),
  ('q_app',              'Ouvrir le site depuis l''app installée sur ton téléphone', 'app_installee', 1, 250, 194),
  ('q_tutos_3',          'Lire 3 tutos de l''aide',                       'tutos_lus', 3,           100, 195),
  ('q_theme',            'Changer de thème d''affichage',                 'theme_change', 1,        50,  196),
  -- B. Secret Santa (tirées seulement pendant la saison)
  ('q_ss_inscription',   'S''inscrire au Secret Santa',                   'ss_inscription', 1,      250, 197),
  ('q_ss_souhaits_3',    'Ajouter 3 souhaits à ta liste Secret Santa',    'ss_souhaits', 3,         200, 198),
  ('q_ss_message',       'Envoyer un message secret à ta cible',          'ss_messages', 1,         150, 199),
  ('q_ss_cadeau',        'Marquer ton cadeau envoyé avant la date limite', 'ss_cadeau_a_temps', 1,  500, 200)
on conflict (code) do nothing;
