-- Outils de test des duels (superutilisateur) : identités, assertions, pilote automatique.
update hg_pages set mode = 'membres' where slug = 'duels';
create or replace function t_ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is not true then raise exception 'ÉCHEC : %', msg; end if; raise notice 'ok : %', msg; end $$;
create or replace function t_uid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create or replace function t_asu(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false); end $$;
create or replace function t_pid(p_code text) returns uuid language sql as $$
  select id from hg_duel_parties where code = p_code order by (statut in ('attente', 'en_cours')) desc, created_at desc limit 1 $$;
create or replace function t_callu(u uuid, p_sql text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform t_asu(u); execute 'set local role authenticated';
  execute 'select to_jsonb((' || p_sql || '))' into r;
  execute 'reset role'; return r;
exception when others then execute 'reset role'; raise;
end $$;
create or replace function t_call(n int, p_sql text) returns jsonb language plpgsql as $$ begin return t_callu(t_uid(n), p_sql); end $$;
create or replace function t_err(n int, p_sql text) returns text language plpgsql as $$
begin perform t_call(n, p_sql); return null; exception when others then return sqlerrm; end $$;
create or replace function t_erru(u uuid, p_sql text) returns text language plpgsql as $$
begin perform t_callu(u, p_sql); return null; exception when others then return sqlerrm; end $$;

-- Invariants d'un duel : grille de la bonne taille, pions cohérents, tour valide.
create or replace function t_invariants(p_id uuid) returns text language plpgsql as $$
declare p hg_duel_parties; dm record; n1 int; n2 int;
begin
  select * into p from hg_duel_parties where id = p_id;
  if p.statut <> 'en_cours' then return null; end if;
  if p.jeu = 'bataille' then
    if p.phase = 'jeu' and exists (select 1 from hg_duel_joueurs j where j.partie = p_id
        and (select count(*) from hg_duel_navires nv where nv.partie = p_id and nv.manche = p.manche and nv.user_id = j.user_id) <> 5) then return 'flotte incomplète'; end if;
    if exists (select 1 from hg_duel_tirs where partie = p_id and resultat <> 'radar' group by manche, tireur, case_n having count(*) > 1) then return 'tir en double'; end if;
    if p.phase = 'jeu' and (p.tour is null or p.restant is null or p.restant < 1) then return 'tour ou salve invalide'; end if;
    return null;
  end if;
  if p.jeu = 'quiestce' then
    if (select count(*) from hg_duel_qec_secrets where partie = p_id and manche = p.manche) <> 2 then return 'personnages secrets manquants'; end if;
    if p.tour is null then return 'tour invalide'; end if;
    return null;
  end if;
  if p.jeu = 'mastermind' then
    if p.phase = 'jeu' and (select count(*) from hg_duel_codes where partie = p_id and manche = p.manche) <> 2 then return 'codes manquants'; end if;
    if exists (select 1 from hg_duel_joueurs j where j.partie = p_id and j.essais <> (select count(*) from hg_duel_essais e
        where e.partie = p_id and e.manche = p.manche and e.user_id = j.user_id)) then return 'compteur d''essais faux'; end if;
    if exists (select 1 from hg_duel_joueurs where partie = p_id and essais > 10) then return 'plus de 10 essais'; end if;
    return null;
  end if;
  select * into dm from hg_duel__dims(p.jeu, p.variante);
  if length(p.grille) <> dm.w * dm.h then return 'taille de grille ' || length(p.grille); end if;
  if p.grille !~ '^[.12]+$' then return 'caractère inconnu'; end if;
  n1 := length(p.grille) - length(replace(p.grille, '1', '')); n2 := length(p.grille) - length(replace(p.grille, '2', ''));
  if p.variante <> 'popout' and abs(n1 - n2) > 1 then return 'écart de pions ' || n1 || '/' || n2; end if;
  if p.jeu = 'p4' then
    -- Gravité : aucun pion au-dessus d'une case vide.
    for i in 0 .. dm.w * (dm.h - 1) - 1 loop
      if substr(p.grille, i + 1, 1) <> '.' and substr(p.grille, i + dm.w + 1, 1) = '.' then return 'pion en l''air case ' || i; end if;
    end loop;
  end if;
  if p.tour is null or not exists (select 1 from hg_duel_joueurs where partie = p_id and user_id = p.tour) then return 'tour invalide'; end if;
  return null;
end $$;

-- Pilote : joue un duel complet entre les membres a et b (b null : contre le robot de niveau lvl). Coups au hasard ou du robot.
create or replace function t_simuler(p_jeu text, p_var text, p_format int, a int, b int, lvl int default 2, p_absents boolean default false)
returns text language plpgsql as $$
declare v_code text; v_id uuid; p hg_duel_parties; u uuid; v_pas int := 0; v_inv text; dm record; c int; j record; v_e text; v_err text;
begin
  v_code := t_call(a, format('hg_duel_creer(%L::jsonb)', jsonb_build_object('jeu', p_jeu, 'variante', p_var, 'format', p_format,
    'adversaire', case when b is null then 'robot' else 'code' end, 'robot', lvl, 'codes', case when random() < 0.5 then 'hasard' else 'choisis' end)::text)) #>> '{}';
  v_id := t_pid(v_code);
  if b is not null then perform t_call(b, format('hg_duel_rejoindre(%L)', v_code)); end if;
  loop
    v_pas := v_pas + 1;
    select * into p from hg_duel_parties where id = v_id;
    exit when p.statut <> 'en_cours' or v_pas > 3000;
    v_inv := t_invariants(v_id);
    if v_inv is not null then raise exception 'ÉCHEC invariant (% %, pas %) : %', p_jeu, p_var, v_pas, v_inv; end if;
    if p_absents and random() < 0.04 then
      update hg_duel_parties set tour_fin = now() - interval '1 second' where id = v_id and tour_fin is not null;
      update hg_duel_joueurs set fin = now() - interval '1 second' where partie = v_id and fin is not null;
      perform t_call(a, format('hg_duel_avancer(%L)', v_code));
      continue;
    end if;
    if p.jeu = 'bataille' then
      if p.phase = 'placement' then
        for j in select * from hg_duel_joueurs where partie = v_id and not robot and not pret loop
          perform t_callu(j.user_id, format('hg_duel_placer(%L, %L::jsonb)', v_code, t_callu(j.user_id, format('hg_duel_flotte_hasard(%L)', v_code))::text));
        end loop;
      else
        u := p.tour;
        if random() < 0.04 and not (select radar from hg_duel_joueurs where partie = v_id and user_id = u) then
          perform t_callu(u, format('hg_duel_radar(%L, %s)', v_code, floor(random() * 100)::int));
        else
          c := case when random() < 0.6 then hg_duel__bn_robot(v_id, u, 2) else floor(random() * 100)::int end;
          v_err := t_erru(u, format('hg_duel_tirer(%L, %s)', v_code, c));
          if v_err is not null and v_err <> 'Tu as déjà tiré sur cette case.' then raise exception 'Erreur inattendue (bataille) : %', v_err; end if;
        end if;
      end if;
    elsif p.jeu = 'quiestce' then
      u := p.tour;
      if p.etat ? 'question_libre' then
        perform t_callu(u, format('hg_duel_repondre(%L, %L)', v_code, random() < 0.5));
      elsif random() < 0.1 and p.robot = 0 then
        perform t_callu(u, format('hg_duel_question_libre(%L, %L)', v_code, 'Est-ce qu''il sourit ?'));
      elsif random() < 0.15 then
        perform t_callu(u, format('hg_duel_baisser(%L, %L::int[])', v_code, '{1,2,3}'));
        perform t_callu(u, format('hg_duel_deviner(%L, %s)', v_code, (select x from hg_duel__qec_possibles(v_id, u) x order by random() limit 1)));
      else
        v_e := (select cle || '|' || valeur from hg_duel__qec_questions() order by random() limit 1);
        perform t_callu(u, format('hg_duel_question(%L, %L, %L)', v_code, split_part(v_e, '|', 1), split_part(v_e, '|', 2)));
      end if;
    elsif p.jeu = 'mastermind' then
      for j in select * from hg_duel_joueurs where partie = v_id and not robot order by random() limit 1 loop
        if p.phase = 'codes' then
          if not exists (select 1 from hg_duel_codes where partie = v_id and manche = p.manche and pour = hg_duel__autre(v_id, j.user_id)) then
            perform t_callu(j.user_id, format('hg_duel_code_secret(%L, %L)', v_code, hg_duel__mm_hasard()));
          end if;
        elsif j.trouve_en is null and j.essais < 10 then
          v_e := hg_duel__mm_robot(v_id, j.user_id, case when random() < 0.3 then 1 else 2 end);
          perform t_callu(j.user_id, format('hg_duel_essayer(%L, %L)', v_code, v_e));
        end if;
      end loop;
    else
      u := p.tour;
      select * into dm from hg_duel__dims(p.jeu, p.variante);
      if random() < 0.5 then c := hg_duel__coup_robot(p, u, 2);
      else
        -- Coup au hasard parmi les coups légaux (avec quelques coups illégaux pour vérifier les refus).
        c := floor(random() * case when p.jeu = 'p4' then dm.w else dm.w * dm.h end)::int;
      end if;
      if p.variante = 'popout' and random() < 0.15 then
        v_err := t_erru(u, format('hg_duel_jouer(%L, %s, ''retire'')', v_code, c));
      else
        v_err := t_erru(u, format('hg_duel_jouer(%L, %s)', v_code, c));
      end if;
      if v_err is not null and v_err not in ('Cette colonne est pleine.', 'Cette case est prise.', 'Tu dois jouer dans la petite grille indiquée.',
          'Cette petite grille est terminée.', 'Tu ne peux retirer qu''un de tes pions, en bas d''une colonne.') then
        raise exception 'Erreur inattendue (% %) : %', p_jeu, p_var, v_err;
      end if;
    end if;
  end loop;
  select * into p from hg_duel_parties where id = v_id;
  if p.statut <> 'terminee' then raise exception 'Duel non terminé (% %) : statut %, pas %', p_jeu, p_var, p.statut, v_pas; end if;
  return p_jeu || '/' || p_var || ' : ' || coalesce(hg_duel__nom(v_id, p.vainqueur), 'nul') || ' en ' || p.manche || ' manche(s)';
end $$;
insert into hg_profiles(id, pseudo, color, is_admin) select t_uid(i), 'Joueur' || i, '#ABCDEF', i = 1 from generate_series(1, 12) i on conflict do nothing;
