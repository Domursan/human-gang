-- 052 : réglages Secret Santa et IRL / souvenirs (lot 3 « réglages admin »).
-- Rétrocompatible : sans clé dans hg_settings, chaque fonction se comporte exactement comme avant
-- (les défauts ci-dessous sont les valeurs codées en dur de la version 043 en production).
--
-- Clés lues (hg_settings) :
--   ss       : min_participants (3), min_participants_manuel (2), eviter_meme_cible_annee_precedente (true)
--   irl      : delai_passee_heures (6), sondage_min (2), sondage_max (6), duree_defaut_heures (2)
--   albums   : max_photos (400), max_mo (300)
--   photos   : cote_max (1600), qualite (0.85)
-- Seules ss, irl, albums et photos sont lues dans les fonctions SQL ci-dessous : irl, albums et photos
-- sont lues par le site (et hg-album) via la politique de lecture ajoutée plus bas.

-- 1. Lecture des réglages par les membres (les clés de configuration ne contiennent aucun secret).
drop policy if exists hg_settings_read_lot3 on public.hg_settings;
create policy hg_settings_read_lot3 on public.hg_settings for select
  using (key in ('ss', 'irl', 'albums', 'photos'));

-- 2. Fonctions de lecture avec repli (utilisées par les fonctions de tirage).
create or replace function public.hg_reglage_int(p_cle text, p_champ text, p_defaut int)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(
    (select floor((s.value ->> p_champ)::numeric)::int
       from hg_settings s
      where s.key = p_cle and jsonb_typeof(s.value -> p_champ) = 'number'),
    p_defaut)
$$;

create or replace function public.hg_reglage_bool(p_cle text, p_champ text, p_defaut boolean)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case when jsonb_typeof(s.value -> p_champ) = 'boolean' then (s.value ->> p_champ)::boolean end
       from hg_settings s
      where s.key = p_cle),
    p_defaut)
$$;

-- 3. Tirage automatique : minimum de participants et éviter la même cible que l'année précédente.
-- Seule différence avec 043 : les deux valeurs viennent de hg_settings.ss (repli 3 et true).
-- Le mode sans limite (hg_god_mode) garde son comportement : minimum 1 et pas de contrôle des exclusions.
create or replace function public.hg_ss_draw(p_edition uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[]; v_perm uuid[]; v_n int; v_try int := 0; v_ok boolean; i int;
  v_year int; v_prev uuid; v_god boolean := public.hg_god_mode();
  v_min int := greatest(2, public.hg_reglage_int('ss', 'min_participants', 3));
  v_eviter boolean := public.hg_reglage_bool('ss', 'eviter_meme_cible_annee_precedente', true);
begin
  if not public.hg_has_perm('secret_santa') then raise exception 'Réservé à l''admin'; end if;
  if exists(select 1 from hg_ss_assignments where edition_id = p_edition) then
    raise exception 'Le tirage a déjà été fait pour cette édition%', case when v_god then ' (mode sans limite : efface d''abord les attributions)' else '' end;
  end if;
  select year into v_year from hg_ss_editions where id = p_edition;
  select id into v_prev from hg_ss_editions where year = v_year - 1;
  select array_agg(user_id) into v_ids from hg_ss_participants where edition_id = p_edition;
  v_n := coalesce(array_length(v_ids,1),0);
  if v_n < (case when v_god then 1 else v_min end) then
    raise exception 'Il faut au moins % participant(s)', case when v_god then 1 else v_min end;
  end if;
  if v_god and v_n = 1 then
    v_perm := v_ids;  -- mode sans limite : un seul participant s'offre à lui-même (tests)
  else
    loop
      v_try := v_try + 1;
      if v_try > 2000 then raise exception 'Impossible de trouver un tirage avec ces exclusions'; end if;
      select array_agg(x order by random()) into v_perm from unnest(v_ids) x;
      v_ok := true;
      for i in 1..v_n loop
        if v_ids[i] = v_perm[i]
           or (not v_god and exists(select 1 from hg_ss_exclusions e where e.edition_id = p_edition
                     and ((e.user_a = v_ids[i] and e.user_b = v_perm[i]) or (e.user_b = v_ids[i] and e.user_a = v_perm[i]))))
           or (not v_god and v_eviter and v_prev is not null and exists(select 1 from hg_ss_assignments pa where pa.edition_id = v_prev
                     and pa.giver_id = v_ids[i] and pa.receiver_id = v_perm[i])) then
          v_ok := false; exit;
        end if;
      end loop;
      exit when v_ok;
    end loop;
  end if;
  for i in 1..v_n loop
    insert into hg_ss_assignments(edition_id, giver_id, receiver_id) values (p_edition, v_ids[i], v_perm[i]);
  end loop;
  update hg_ss_editions set status = 'envoi', drawn_at = now() where id = p_edition;
  insert into hg_activity(user_id, kind, text) values (null, 'ss_draw', 'Le tirage du Secret Santa ' || v_year || ' est fait !');
  return v_n;
end
$$;

-- 4. Tirage manuel : minimum de participants (repli 2, qui est aussi le plancher hors mode sans limite).
create or replace function public.hg_ss_manual_draw(p_edition uuid, p_pairs jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare v_parts uuid[]; v_g uuid[]; v_r uuid[]; v_n int; v_year int; v_god boolean := public.hg_god_mode();
  v_min int := greatest(2, public.hg_reglage_int('ss', 'min_participants_manuel', 2));
begin
  if not public.hg_has_perm('secret_santa') then raise exception 'Réservé à l''admin'; end if;
  if exists(select 1 from hg_ss_assignments where edition_id = p_edition) then raise exception 'Le tirage a déjà été fait pour cette édition'; end if;
  select array_agg(user_id order by user_id) into v_parts from hg_ss_participants where edition_id = p_edition;
  v_n := coalesce(array_length(v_parts, 1), 0);
  if v_n < (case when v_god then 1 else v_min end) then raise exception 'Il faut au moins % participant(s)', case when v_god then 1 else v_min end; end if;
  select array_agg((e->>'giver')::uuid order by (e->>'giver')::uuid), array_agg((e->>'receiver')::uuid order by (e->>'receiver')::uuid)
    into v_g, v_r from jsonb_array_elements(p_pairs) e;
  if v_g is distinct from v_parts then raise exception 'Chaque participant doit offrir exactement une fois'; end if;
  if v_r is distinct from v_parts then raise exception 'Chaque participant doit recevoir exactement une fois'; end if;
  if not v_god and exists(select 1 from jsonb_array_elements(p_pairs) e where e->>'giver' = e->>'receiver') then raise exception 'Personne ne peut s''offrir à soi-même'; end if;
  insert into hg_ss_assignments(edition_id, giver_id, receiver_id)
    select p_edition, (e->>'giver')::uuid, (e->>'receiver')::uuid from jsonb_array_elements(p_pairs) e;
  select year into v_year from hg_ss_editions where id = p_edition;
  update hg_ss_editions set status = 'envoi', drawn_at = now() where id = p_edition;
  insert into hg_activity(user_id, kind, text) values (null, 'ss_draw', 'Le tirage du Secret Santa ' || v_year || ' est fait !');
  return v_n;
end
$$;
