-- =====================================================================
-- 158 : quêtes de profil validées par l'état du profil, pas seulement par l'action de la semaine.
--   « Renseigner ton anniversaire », « Lier ton ID Discord », « Compléter ton profil » : un membre qui l'avait déjà fait
--   avant la semaine ne pouvait jamais les valider (seul un changement pendant la semaine comptait).
--   Désormais, pour un membre donné : 1 si son profil remplit déjà la condition (ou s'il l'a fait cette semaine), sinon 0.
--   Le total global (p_user null, défis du gang) reste compté sur les actions de la période.
-- =====================================================================
select public.hg__patch('public.hg_challenge_value(text,uuid,timestamp with time zone,timestamp with time zone)'::regprocedure,
$o$when 'anniversaire_renseigne' then (select count(*) from hg_quest_events q where q.kind = 'anniversaire'
      and q.created_at >= p_start and q.created_at < p_end and (p_user is null or q.user_id = p_user))$o$,
$n$when 'anniversaire_renseigne' then (case when p_user is not null
        and exists (select 1 from hg_profiles p where p.id = p_user and p.birthday is not null) then 1
      else (select count(*) from hg_quest_events q where q.kind = 'anniversaire'
      and q.created_at >= p_start and q.created_at < p_end and (p_user is null or q.user_id = p_user)) end)$n$);

select public.hg__patch('public.hg_challenge_value(text,uuid,timestamp with time zone,timestamp with time zone)'::regprocedure,
$o$when 'discord_lie' then (select count(*) from hg_quest_events q where q.kind = 'discord'
      and q.created_at >= p_start and q.created_at < p_end and (p_user is null or q.user_id = p_user))$o$,
$n$when 'discord_lie' then (case when p_user is not null
        and exists (select 1 from hg_profiles p where p.id = p_user and nullif(btrim(coalesce(p.discord_id, '')), '') is not null) then 1
      else (select count(*) from hg_quest_events q where q.kind = 'discord'
      and q.created_at >= p_start and q.created_at < p_end and (p_user is null or q.user_id = p_user)) end)$n$);

select public.hg__patch('public.hg_challenge_value(text,uuid,timestamp with time zone,timestamp with time zone)'::regprocedure,
$o$when 'profil_complet' then (select count(*) from hg_quest_events q where q.kind = 'profil_complet'
      and q.created_at >= p_start and q.created_at < p_end and (p_user is null or q.user_id = p_user))$o$,
$n$when 'profil_complet' then (case when p_user is not null and hg_profile_is_complete(p_user) then 1
      else (select count(*) from hg_quest_events q where q.kind = 'profil_complet'
      and q.created_at >= p_start and q.created_at < p_end and (p_user is null or q.user_id = p_user)) end)$n$);
