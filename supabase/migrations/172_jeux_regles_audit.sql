-- ===== Humane Gang — migration 172 : jeux, corrections de règles relevées par l'audit de jouabilité (oct. 2026) =====
-- 1. Blackjack : une main qui fait 21 juste après une séparation s'arrête (on ne pouvait plus que « Tirer » et sauter).
-- 2. Pictionary : un joueur parti n'est plus choisi comme dessinateur et ne compte plus pour « tout le monde a trouvé ».
-- 3. Monopoly : la fin de partie au temps est vérifiée avant le « rejoue » d'un double (la partie ne déborde plus d'un tour).
-- Rejouable. Les droits des fonctions internes (migrations 165 et 166) sont conservés par « create or replace ».

create or replace function public.hg_plat__blackjack_agir(p_id uuid, p_u uuid, p_action text, a jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; j hg_plat_joueurs; v int; nxt uuid; k int; m jsonb; c text; t record; nm jsonb; mains jsonb;
begin
  select * into p from hg_plat_parties where id = p_id for update;
  select * into j from hg_plat_joueurs where partie = p_id and user_id = p_u for update;
  if p.tour is distinct from p_u then raise exception 'Ce n''est pas ton tour.'; end if;
  if p.etat->>'phase' = 'mise' then
    if p_action <> 'miser' then raise exception 'C''est le moment de miser.'; end if;
    v := coalesce((a->>'montant')::int, 0);
    if v < 10 or v > least(500, (j.etat->>'jetons')::int) then raise exception 'Mise entre 10 et % jetons.', least(500, (j.etat->>'jetons')::int); end if;
    update hg_plat_joueurs set etat = etat || jsonb_build_object('mise', v) where partie = p_id and user_id = p_u;
    perform hg_plat__log(p_id, p_u, 'coup', hg_plat__nom(p_id, p_u) || ' mise ' || v || ' jetons.');
    nxt := hg_bj__prochain_miseur(p_id, j.place);
    if nxt is null then perform hg_bj__distribuer(p_id);
    else
      update hg_plat_parties set etat = jsonb_set(etat, '{actif}', to_jsonb(nxt)) where id = p_id;
      perform hg_plat__donner_tour(p_id, nxt);
    end if;
    return '{}'::jsonb;
  end if;
  if p.etat->>'phase' <> 'jeu' then raise exception 'Attends la prochaine manche.'; end if;
  k := coalesce((p.etat->>'main')::int, 0);
  mains := j.etat->'mains'; m := mains->k;
  if m is null or m->>'statut' <> 'joue' then raise exception 'Cette main est terminée.'; end if;
  if p_action = 'tirer' then
    c := hg_bj__tirer(p_id); m := jsonb_set(m, '{cartes}', (m->'cartes') || to_jsonb(c));
    t := hg_bj__total(m->'cartes');
    if t.total > 21 then m := jsonb_set(m, '{statut}', '"saute"'); elsif t.total = 21 then m := jsonb_set(m, '{statut}', '"reste"'); end if;
    perform hg_plat__log(p_id, p_u, 'coup', hg_plat__nom(p_id, p_u) || ' tire ' || hg_cartes__nom(c) || ' (' || t.total || case when t.total > 21 then ', saute' else '' end || ').');
  elsif p_action = 'rester' then
    m := jsonb_set(m, '{statut}', '"reste"');
    perform hg_plat__log(p_id, p_u, 'coup', hg_plat__nom(p_id, p_u) || ' reste à ' || (hg_bj__total(m->'cartes')).total || '.');
  elsif p_action = 'doubler' then
    if jsonb_array_length(m->'cartes') <> 2 then raise exception 'On ne double qu''avec deux cartes.'; end if;
    if (j.etat->>'jetons')::int < (select sum((x->>'mise')::int) from jsonb_array_elements(mains) x) + (m->>'mise')::int then raise exception 'Pas assez de jetons pour doubler.'; end if;
    c := hg_bj__tirer(p_id);
    m := m || jsonb_build_object('cartes', (m->'cartes') || to_jsonb(c), 'mise', (m->>'mise')::int * 2);
    t := hg_bj__total(m->'cartes');
    m := jsonb_set(m, '{statut}', case when t.total > 21 then '"saute"'::jsonb else '"double"'::jsonb end);
    perform hg_plat__log(p_id, p_u, 'coup', hg_plat__nom(p_id, p_u) || ' double et tire ' || hg_cartes__nom(c) || ' (' || t.total || ').');
  elsif p_action = 'separer' then
    if jsonb_array_length(mains) > 1 or jsonb_array_length(m->'cartes') <> 2
       or least(hg_cartes__rang(m->'cartes'->>0), 10) <> least(hg_cartes__rang(m->'cartes'->>1), 10) then raise exception 'On ne sépare qu''une paire, une seule fois.'; end if;
    if (j.etat->>'jetons')::int < (m->>'mise')::int * 2 then raise exception 'Pas assez de jetons pour séparer.'; end if;
    nm := jsonb_build_object('cartes', jsonb_build_array(m->'cartes'->1, hg_bj__tirer(p_id)), 'mise', (m->>'mise')::int, 'statut', 'joue');
    m := m || jsonb_build_object('cartes', jsonb_build_array(m->'cartes'->0, hg_bj__tirer(p_id)));
    -- Une main qui fait 21 après la séparation s'arrête d'elle-même (plus de « Tirer » possible).
    if (hg_bj__total(m->'cartes')).total = 21 then m := jsonb_set(m, '{statut}', '"reste"'); end if;
    if (hg_bj__total(nm->'cartes')).total = 21 then nm := jsonb_set(nm, '{statut}', '"reste"'); end if;
    mains := jsonb_build_array(m, nm);
    update hg_plat_joueurs set etat = jsonb_set(etat, '{mains}', mains) where partie = p_id and user_id = p_u;
    perform hg_plat__log(p_id, p_u, 'coup', hg_plat__nom(p_id, p_u) || ' sépare sa paire.');
    -- suite commune ci-dessous : main 0 encore à jouer, sinon main suivante ou banque
  else
    raise exception 'Action inconnue.';
  end if;
  update hg_plat_joueurs set etat = jsonb_set(etat, array['mains', k::text], m) where partie = p_id and user_id = p_u;
  if m->>'statut' = 'joue' then perform hg_plat__donner_tour(p_id, p_u); return '{}'::jsonb; end if;
  nm := hg_bj__prochaine_main(p_id);
  if nm is null then perform hg_bj__banque(p_id);
  else
    update hg_plat_parties set etat = etat || jsonb_build_object('actif', nm->'joueur', 'main', (nm->>'main')::int) where id = p_id;
    perform hg_plat__donner_tour(p_id, (nm->>'joueur')::uuid);
  end if;
  return '{}'::jsonb;
end $$;

create or replace function public.hg_pi__tour(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; e jsonb; idx int; n int; dess uuid; choix jsonb;
begin
  select * into p from hg_plat_parties where id = p_id for update;
  e := p.etat;
  n := (select count(*) from hg_plat_joueurs where partie = p_id and not elimine and not parti);
  idx := coalesce((e->>'tour_n')::int, 0) + 1;
  if idx > n * coalesce((p.options->>'manches')::int, 2) or n < 2 then perform hg_pi__fin(p_id); return; end if;
  select user_id into dess from hg_plat_joueurs where partie = p_id and not elimine and not parti order by place offset ((idx - 1) % n) limit 1;
  select jsonb_agg(m) into choix from (select c.data->>'mot' m from hg_nj_contenus c where c.jeu = 'pictionary' and c.actif
    and not coalesce(e->'deja', '[]'::jsonb) ? (c.data->>'mot') order by (c.data->>'niveau')::int = (1 + floor(random() * 3))::int desc, random() limit 3) z;
  if choix is null then choix := '["raclette", "montagne", "chat"]'::jsonb; end if;
  update hg_plat_parties set nb_tours = 1 + (idx - 1) / n, etat = jsonb_build_object('phase', 'choix', 'tour_n', idx, 'dessinateur', dess,
    'choix', choix, 'mot', null, 'trouves', '[]'::jsonb, 'traits', '[]'::jsonb, 'debut', null, 'deja', coalesce(e->'deja', '[]'::jsonb),
    'precedent', e->'revele') where id = p_id;
  update hg_plat_parties set tour = dess, tour_fin = now() + interval '20 seconds' where id = p_id;
  perform hg_plat__log(p_id, dess, 'info', 'Manche ' || (1 + (idx - 1) / n) || ' : ' || hg_plat__nom(p_id, dess) || ' choisit un mot à dessiner.');
end $$;

create or replace function public.hg_plat__pictionary_agir(p_id uuid, p_u uuid, p_action text, a jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; e jsonb; m text; t text; reste numeric; pts int; n_dev int; nom text := hg_plat__nom(p_id, p_u);
begin
  select * into p from hg_plat_parties where id = p_id for update;
  e := p.etat;
  if p_action = 'choisir' then
    if e->>'phase' <> 'choix' or e->>'dessinateur' <> p_u::text then raise exception 'Ce n''est pas à toi de choisir.'; end if;
    m := a->>'mot';
    if not coalesce(e->'choix', '[]'::jsonb) ? m then raise exception 'Choisis un des trois mots proposés.'; end if;
    update hg_plat_parties set etat = etat || jsonb_build_object('phase', 'dessin', 'mot', m, 'debut', now(), 'deja', coalesce(etat->'deja', '[]'::jsonb) || to_jsonb(m)),
      tour_fin = now() + make_interval(secs => coalesce((options->>'duree')::int, 80)) where id = p_id;
    perform hg_plat__log(p_id, p_u, 'info', nom || ' dessine (' || char_length(m) || ' lettres).');
    return '{}'::jsonb;
  end if;
  if p_action = 'dessin' then
    if e->>'phase' <> 'dessin' or e->>'dessinateur' <> p_u::text then raise exception 'Ce n''est pas toi qui dessines.'; end if;
    if octet_length((a->'traits')::text) > 200000 then raise exception 'Dessin trop lourd.'; end if;
    update hg_plat_parties set etat = jsonb_set(etat, '{traits}', coalesce(a->'traits', '[]'::jsonb)) where id = p_id;
    return '{}'::jsonb;
  end if;
  if p_action = 'deviner' then
    if e->>'phase' <> 'dessin' then raise exception 'Attends que le dessin commence.'; end if;
    if e->>'dessinateur' = p_u::text then raise exception 'Tu dessines : pas de proposition !'; end if;
    if coalesce(e->'trouves', '[]'::jsonb) ? p_u::text then raise exception 'Tu as déjà trouvé.'; end if;
    t := btrim(coalesce(a->>'texte', ''));
    if t = '' or char_length(t) > 60 then raise exception 'Proposition vide ou trop longue.'; end if;
    if hg_nj_norm(t) = hg_nj_norm(e->>'mot') then
      reste := greatest(0, extract(epoch from p.tour_fin - now()));
      pts := 10 + floor(reste / 10)::int;
      update hg_plat_joueurs set etat = jsonb_set(etat, '{points}', to_jsonb(coalesce((etat->>'points')::int, 0) + pts)) where partie = p_id and user_id = p_u;
      update hg_plat_joueurs set etat = jsonb_set(etat, '{points}', to_jsonb(coalesce((etat->>'points')::int, 0) + 4))
        where partie = p_id and user_id = (e->>'dessinateur')::uuid;
      update hg_plat_parties set etat = jsonb_set(etat, '{trouves}', coalesce(etat->'trouves', '[]'::jsonb) || to_jsonb(p_u::text)) where id = p_id;
      perform hg_plat__log(p_id, p_u, 'trouve', nom || ' a trouvé ! (+' || pts || ')');
      select count(*) into n_dev from hg_plat_joueurs where partie = p_id and not elimine and not parti and user_id <> (e->>'dessinateur')::uuid;
      if jsonb_array_length(coalesce(e->'trouves', '[]'::jsonb)) + 1 >= n_dev then perform hg_pi__fin_dessin(p_id); end if;
      return jsonb_build_object('ok', true, 'points', pts);
    end if;
    -- Presque : même mot à une lettre près (ou contenu dans le mot) : seulement pour l'auteur.
    if levenshtein_ok(hg_nj_norm(t), hg_nj_norm(e->>'mot')) then
      perform hg_plat__log(p_id, p_u, 'info', '« ' || t || ' » : presque !', p_u);
    else
      perform hg_plat__log(p_id, p_u, 'propose', nom || ' : ' || t);
    end if;
    return jsonb_build_object('ok', false);
  end if;
  raise exception 'Action inconnue.';
end $$;

create or replace function public.hg_plat__mo_suivant(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; v_actif uuid; v_suiv uuid; v_n int;
begin
  select * into p from hg_plat_parties where id = p_id;
  v_actif := (p.etat->>'actif')::uuid;
  select count(*) into v_n from hg_plat_joueurs where partie = p_id and not elimine;
  if v_n <= 1 then perform hg_plat__mo_finir_partie(p_id, 'ruine'); return; end if;
  if p.started_at + make_interval(mins => coalesce((p.options->>'duree')::int, 60)) <= now() then
    perform hg_plat__log(p_id, null, 'info', 'Le temps est écoulé : on compte les fortunes !');
    perform hg_plat__mo_finir_partie(p_id, 'temps');
    return;
  end if;
  if coalesce((p.etat->>'rejouer')::boolean, false) and hg_plat__mo_vivant(p_id, v_actif) then
    update hg_plat_parties set etat = etat || '{"phase": "lancer", "rejouer": false, "carte": null}' where id = p_id;
    perform hg_plat__donner_tour(p_id, v_actif);
    return;
  end if;
  v_suiv := hg_plat__suivant(p_id, v_actif);
  update hg_plat_parties set nb_tours = nb_tours + 1,
    etat = etat || jsonb_build_object('actif', v_suiv, 'phase', 'lancer', 'doubles', 0, 'rejouer', false, 'carte', null, 'offre', null) where id = p_id;
  perform hg_plat__donner_tour(p_id, v_suiv);
end $$;

-- Droits des fonctions internes des plateaux refermés à nouveau (voir migration 165).
select public.hg_plat__droits();
