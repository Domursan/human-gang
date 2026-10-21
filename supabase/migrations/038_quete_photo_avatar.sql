-- Quête « Ajouter une photo » (métrique photos_ajoutees) : la photo de profil envoyée compte aussi.
-- Les avatars sont dans le bucket hg-avatars, rangés sous <id du membre>/… ; un remplacement réécrit le fichier
-- (upsert), d'où la date de mise à jour.
create or replace function public.hg_challenge_value(p_metric text, p_user uuid, p_start timestamptz, p_end timestamptz)
 returns numeric
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select (case p_metric
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
    else 0 end)::numeric
$function$;
