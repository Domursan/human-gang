-- Parties simulées à 4, 10 et 20 joueurs : indices, propositions à la majorité, arrêts, échéances, jusqu'à la fin.
create or replace function t_simuler(n int, p_opts jsonb default '{}'::jsonb) returns text language plpgsql as $$
declare v_code text; v_id uuid; p hg_ndc_parties; v_esp int; v_ag int; a record; v_pos int; v_pas int := 0; v_eq text;
begin
  v_code := t_partie(n, p_opts);
  v_id := t_pid(v_code);
  loop
    select * into p from hg_ndc_parties where id = v_id;
    exit when p.statut <> 'en_cours' or v_pas > 400;
    v_pas := v_pas + 1;
    -- Invariants : couleurs, un espion par équipe, essais cohérents
    if (select count(*) from hg_ndc_cartes where partie = v_id) <> 25 then raise exception 'grille abîmée'; end if;
    if (select count(*) from hg_ndc_joueurs where partie = v_id and espion and not parti) <> 2 then raise exception 'espions : %', v_pas; end if;
    if p.phase = 'indice' then
      if random() < 0.08 then
        update hg_ndc_parties set tour_fin = now() - interval '1 second' where id = v_id;
        perform t_call(1, format('hg_ndc_avancer(%L)', v_code));
        continue;
      end if;
      v_esp := t_num((select user_id from hg_ndc_joueurs where partie = v_id and espion and equipe = p.tour_equipe and not parti));
      perform t_call(v_esp, format('hg_ndc_indice(%L, %L, %s)', v_code, 'Xylo' || chr(97 + (v_pas % 26)), 1 + floor(random() * 3)::int));
    else
      -- Une carte : souvent une des siennes (l'équipe devine bien), parfois au hasard.
      if random() < 0.65 then
        select pos into v_pos from hg_ndc_cartes where partie = v_id and not revelee and couleur = p.tour_equipe order by random() limit 1;
      else
        select pos into v_pos from hg_ndc_cartes where partie = v_id and not revelee and (couleur <> 'assassin' or random() < 0.3) order by random() limit 1;
      end if;
      if random() < 0.1 and coalesce((select cardinality(mots) from hg_ndc_indices where id = p.indice), 0) > 0 then
        v_ag := t_num((select user_id from hg_ndc_joueurs where partie = v_id and not espion and equipe = p.tour_equipe and not parti limit 1));
        perform t_call(v_ag, format('hg_ndc_arreter(%L)', v_code));
        continue;
      end if;
      if p.validation = 'libre' then
        v_ag := t_num((select user_id from hg_ndc_joueurs where partie = v_id and not espion and equipe = p.tour_equipe and not parti limit 1));
        perform t_call(v_ag, format('hg_ndc_valider(%L, %s)', v_code, v_pos));
        continue;
      end if;
      for a in select user_id from hg_ndc_joueurs where partie = v_id and not espion and equipe = p.tour_equipe and not parti order by random() loop
        exit when (select revelee from hg_ndc_cartes where partie = v_id and pos = v_pos)
          or (select statut from hg_ndc_parties where id = v_id) <> 'en_cours'
          or (select tour_equipe from hg_ndc_parties where id = v_id) <> p.tour_equipe;
        perform t_callu(a.user_id, format('hg_ndc_proposer(%L, %s)', v_code, v_pos));
      end loop;
    end if;
  end loop;
  select * into p from hg_ndc_parties where id = v_id;
  if p.statut <> 'terminee' then raise exception 'Partie non finie à % joueurs après % pas', n, v_pas; end if;
  if (select count(*) from hg_ndc_joueurs where partie = v_id and gagne) = 0 then raise exception 'pas de gagnant'; end if;
  return n || ' joueurs : équipe ' || p.vainqueur || ' (' || (p.etat->>'raison') || ') en ' || v_pas || ' pas, '
    || (select count(*) from hg_ndc_indices where partie = v_id) || ' indices';
end $$;

do $$
declare i int; r text;
begin
  for i in 1 .. 4 loop raise notice '%', t_simuler(4); end loop;
  for i in 1 .. 4 loop raise notice '%', t_simuler(10); end loop;
  for i in 1 .. 3 loop raise notice '%', t_simuler(20); end loop;
  for i in 1 .. 3 loop raise notice '%', t_simuler(6, '{"validation":"libre"}'); end loop;
  raise notice 'ok : 14 parties simulées sans erreur';
end $$;
