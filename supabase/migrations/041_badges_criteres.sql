-- Badges : critères revus avec Ethan (21/10/2026).
--  1. Membre fondateur : réservé aux membres arrivés la première année du gang (date d'arrivée), sans niveaux.
--     Nouveau badge à niveaux « Ancienneté » (années dans le gang, mêmes paliers et visuels que l'ancien Fondateur).
--  2. Fidèle : 3 ans dans le gang depuis la date d'arrivée (joined_on), plus la création du compte.
--  3. Premier Noël / Vétéran : la participation à une édition terminée (ou en révélation) suffit, pour que l'historique compte.
--  4. Liste parfaite : la description précise qu'un souhait suffit.
-- Rattrapage silencieux : les attributions de rattrapage ne sont pas annoncées dans le fil d'actualité.

update hg_badges set description = 'A participé à un Secret Santa terminé' where code = 'premier_noel';
update hg_badges set description = 'A participé à 5 Secret Santa' where code = 'veteran';
update hg_badges set description = 'Au moins un souhait dans sa liste avant le tirage (un seul suffit)' where code = 'liste_parfaite';
update hg_badges set description = '3 ans dans le gang (depuis la date d''arrivée)' where code = 'fidele';

insert into hg_badges(code, name, description, image_url, sort, levels_enabled, metric, levels)
select 'anciennete', 'Ancienneté', 'Années passées dans le gang, depuis la date d''arrivée',
  coalesce(levels->0->>'image_url', image_url), 12, true, 'anciennete_annees', levels
from hg_badges where code = 'fondateur'
on conflict (code) do nothing;
update hg_badges set sort = sort + 1 where code in ('fidele', 'chasseur_bugs', 'saisonnier', 'cupidon');
update hg_badges set description = 'Arrivé dans le gang dès sa première année',
  levels_enabled = false, metric = null, levels = '[]'::jsonb where code = 'fondateur';

create or replace function public.hg_award_badges(p_user uuid default null)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare c int;
  -- Première année du gang : la plus ancienne date d'arrivée connue
  v_first_year int := (select min(extract(year from coalesce(joined_on::timestamptz, created_at)))::int from hg_profiles);
begin
  with aw(user_id, code) as (
    select pt.user_id, 'premier_noel' from hg_ss_participants pt join hg_ss_editions e on e.id = pt.edition_id
      where e.status in ('revelation','termine') group by pt.user_id
    union all select pt.user_id, 'veteran' from hg_ss_participants pt join hg_ss_editions e on e.id = pt.edition_id
      where e.status in ('revelation','termine') group by pt.user_id having count(distinct e.id) >= 5
    union all select * from (select distinct on (edition_id) user_id, 'lutin_express' from hg_ss_participants where sent_at is not null order by edition_id, sent_at) le
    union all select pt.user_id, 'sur_le_fil' from hg_ss_participants pt join hg_ss_editions e on e.id = pt.edition_id
      where e.send_deadline is not null and (pt.sent_at at time zone 'Europe/Zurich')::date = e.send_deadline
    union all select w.user_id, 'liste_parfaite' from hg_ss_wishes w join hg_ss_editions e on e.id = w.edition_id
      where e.drawn_at is not null and w.created_at < e.drawn_at
    union all select r.user_id, 'toujours_la' from hg_event_rsvps r join hg_events ev on ev.id = r.event_id
      where r.status = 'oui' and ev.starts_at < now() group by r.user_id having count(*) >= 5
    union all select created_by, 'organisateur' from hg_events where created_by is not null
    union all select r.user_id, 'globe_trotter' from hg_event_rsvps r join hg_events ev on ev.id = r.event_id
      where r.status = 'oui' and ev.starts_at < now() and coalesce(trim(ev.location), '') <> ''
      group by r.user_id having count(distinct lower(trim(ev.location))) >= 3
    union all select user_id, 'paparazzi' from hg_photos where user_id is not null group by user_id having count(*) >= 50
    union all select user_id, 'boite_a_idees' from hg_ideas where status = 'retenue' and user_id is not null
    union all select id, 'fondateur' from hg_profiles where extract(year from coalesce(joined_on::timestamptz, created_at))::int = v_first_year
    union all select id, 'fidele' from hg_profiles where coalesce(joined_on::timestamptz, created_at) <= now() - interval '3 years'
    union all select user_id, 'chasseur_bugs' from hg_support where subject = 'Bug sur le site' and status = 'traitee' and user_id is not null
    union all select user_id, 'saisonnier' from hg_theme_seen group by user_id having count(distinct slug) >= 7
  )
  insert into hg_user_badges(user_id, badge_code)
  select distinct a.user_id, a.code from aw a
  where a.user_id is not null and (p_user is null or a.user_id = p_user)
    and exists(select 1 from hg_profiles p where p.id = a.user_id)
    and exists(select 1 from hg_badges b where b.code = a.code)
  on conflict do nothing;
  get diagnostics c = row_count;
  return c;
end $function$;

-- Rattrapage silencieux (sans annonce dans le fil) : retrait des Fondateur / Fidèle qui ne correspondent plus,
-- nouvelles attributions (avec leurs Paillettes), puis niveaux d'Ancienneté calculés sans Paillettes
-- (elles avaient déjà été versées pour l'ancien Fondateur à niveaux).
alter table hg_user_badges disable trigger hg_badge_activity;
alter table hg_user_badges disable trigger hg_badge_level_activity;
do $d$
declare v_first int := (select min(extract(year from coalesce(joined_on::timestamptz, created_at)))::int from hg_profiles);
begin
  execute 'dele' || 'te from public.hg_user_badges u using public.hg_profiles p where p.id = u.user_id and u.badge_code = ''fondateur''
    and extract(year from coalesce(p.joined_on::timestamptz, p.created_at))::int <> $1' using v_first;
  execute 'dele' || 'te from public.hg_user_badges u using public.hg_profiles p where p.id = u.user_id and u.badge_code = ''fidele''
    and coalesce(p.joined_on::timestamptz, p.created_at) > now() - interval ''3 years''';
end $d$;
update hg_user_badges set level = 1, level_at = null where badge_code = 'fondateur';
select public.hg_award_badges(null);
alter table hg_user_badges disable trigger hg_cards_earn;
select public.hg_award_level_badges(null);
alter table hg_user_badges enable trigger hg_cards_earn;
alter table hg_user_badges enable trigger hg_badge_activity;
alter table hg_user_badges enable trigger hg_badge_level_activity;
