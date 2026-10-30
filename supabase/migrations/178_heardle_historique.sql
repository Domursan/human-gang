-- ===== Humane Gang — migration 178 : historique du Heardle =====
-- hg_heardle_historique() : toutes les manches passées du Heardle (avant aujourd'hui, hors manches annulées), de la plus
-- récente à la plus ancienne, chacune avec son morceau et les parties terminées du gang (pour chaque membre : essais
-- « o » trouvé, « x » mauvaise réponse, « s » passé ; Paillettes gagnées quand hg_jeux_resultats les a notées).
-- Plus les chiffres du membre : manches jouées, trouvées, moyenne des essais gagnants, série de manches trouvées
-- d'affilée jusqu'à hier. La manche du jour n'y est jamais (sa réponse reste secrète).
-- Lecture seule : aucune table ni donnée modifiée. Réservé aux membres ; les comptes fantômes n'apparaissent pas.
-- Rejouable.

create or replace function public.hg_heardle_historique()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d date := hg_jeux_today(); me uuid := auth.uid(); serie int := 0; x record;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  -- Série : manches trouvées d'affilée, de la veille vers le passé (une manche non jouée ou ratée l'arrête)
  for x in select coalesce(g.solved, false) as ok from hg_heardle_rounds r
      left join hg_daily_games g on g.game = 'heardle' and g.day = r.day and g.user_id = me and g.finished
      where r.day < d and not r.cancelled order by r.day desc loop
    exit when not x.ok;
    serie := serie + 1;
  end loop;
  return jsonb_build_object(
    'moi', (select jsonb_build_object('joues', count(*), 'trouves', count(*) filter (where g.solved),
        'moyenne', round(avg(cardinality(g.guesses)) filter (where g.solved), 1), 'serie', serie)
      from hg_daily_games g join hg_heardle_rounds r on r.day = g.day and not r.cancelled
      where g.game = 'heardle' and g.user_id = me and g.finished and g.day < d),
    'manches', coalesce((select jsonb_agg(m order by m.day desc) from (
      select r.day,
        (select count(*) from hg_heardle_rounds r2 where r2.day <= r.day and not r2.cancelled) as round,
        t.title, t.artist, t.youtube_id, t.start_s, t.shared_on,
        (select p.pseudo from hg_profiles p where p.id = t.proposed_by and not p.is_ghost) as proposed_by,
        coalesce((select jsonb_agg(jsonb_build_object(
            'user_id', p.id, 'pseudo', p.pseudo, 'color', p.color, 'avatar_url', p.avatar_url,
            'solved', g.solved,
            'essais', (select string_agg(case when gs.gid = '' then 's' when gs.gid = r.track_id::text then 'o' else 'x' end, '' order by gs.i)
              from unnest(g.guesses) with ordinality gs(gid, i)),
            'points', (select jr.points from hg_jeux_resultats jr where jr.jeu = 'heardle' and jr.day = r.day and jr.user_id = p.id))
            order by g.solved desc, cardinality(g.guesses), p.pseudo)
          from hg_daily_games g join hg_profiles p on p.id = g.user_id and not p.is_ghost
          where g.game = 'heardle' and g.day = r.day and g.finished), '[]'::jsonb) as joueurs
      from hg_heardle_rounds r join hg_heardle_tracks t on t.id = r.track_id
      where r.day < d and not r.cancelled) m), '[]'::jsonb));
end $$;

revoke all on function public.hg_heardle_historique() from public, anon;
grant execute on function public.hg_heardle_historique() to authenticated;
