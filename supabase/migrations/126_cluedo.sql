-- ===== Humane Gang — migration 126 : Cluedo (moteur du jeu, sur le socle 125) =====
-- Règles officielles, avec une simplification : pas de dés ni de cases. À son tour, on va dans une pièce voisine
-- (ou par un passage secret) ; on peut rester sur place seulement si une hypothèse d'un autre joueur nous y a amené.
-- Dans la pièce, on formule une hypothèse (suspect + arme + cette pièce) : le pion du suspect y est amené,
-- puis le premier joueur suivant (dans l'ordre) qui possède une des trois cartes en montre une, en secret.
-- Une seule accusation par joueur, à tout moment de son tour : juste, il gagne ; fausse, il est éliminé
-- (il reste à table pour montrer ses cartes). S'il ne reste qu'un joueur non éliminé, il gagne.
-- Cartes : 's:<suspect>', 'a:<arme>', 'p:<pièce>' (identifiants fixes ; noms dans hg_plat_contenus).
-- Phases (etat.phase) : deplacer → hypothese → montrer (tour = celui qui doit montrer) → apres → joueur suivant.

/* ---------- Contenus paramétrables ---------- */
insert into public.hg_plat_contenus(jeu, cle, libelle, valeur, defaut, sort)
select 'cluedo', c.cle, c.libelle, c.v, c.v, c.sort from (values
  ('nom', 'Nom du jeu', to_jsonb('Cluedo'::text), 1),
  ('victime', 'Victime', to_jsonb('Docteur Lenoir'::text), 2),
  ('manoir', 'Lieu du crime', to_jsonb('Le manoir Tudor'::text), 3),
  ('suspects', 'Suspects', '[
    {"id":"moutarde","nom":"Colonel Moutarde","couleur":"#E2B33C"},
    {"id":"rose","nom":"Mademoiselle Rose","couleur":"#E0708E"},
    {"id":"leblanc","nom":"Madame Leblanc","couleur":"#EDEAE4"},
    {"id":"pervenche","nom":"Madame Pervenche","couleur":"#4F7FC4"},
    {"id":"olive","nom":"Docteur Olive","couleur":"#5E9C5A"},
    {"id":"violet","nom":"Professeur Violet","couleur":"#8C5BB8"}]'::jsonb, 4),
  ('armes', 'Armes', '[
    {"id":"chandelier","nom":"Chandelier"},{"id":"poignard","nom":"Poignard"},{"id":"revolver","nom":"Revolver"},
    {"id":"corde","nom":"Corde"},{"id":"matraque","nom":"Matraque"},{"id":"cle","nom":"Clé anglaise"}]'::jsonb, 5),
  ('pieces', 'Pièces', '[
    {"id":"cuisine","nom":"Cuisine"},{"id":"bal","nom":"Salle de bal"},{"id":"veranda","nom":"Véranda"},
    {"id":"manger","nom":"Salle à manger"},{"id":"billard","nom":"Salle de billard"},{"id":"bibliotheque","nom":"Bibliothèque"},
    {"id":"salon","nom":"Salon"},{"id":"hall","nom":"Hall"},{"id":"bureau","nom":"Bureau"}]'::jsonb, 6)
) c(cle, libelle, v, sort)
on conflict (jeu, cle) do nothing;

insert into public.hg_badges(code, name, description, sort) values
  ('plat_cluedo_detective', 'Fin limier', 'Résoudre une enquête au Cluedo.', 1000),
  ('plat_cluedo_flair', 'Quel flair !', 'Résoudre une enquête du Cluedo en 3 hypothèses ou moins.', 1001),
  ('plat_cluedo_bevue', 'Fausse piste', 'Faire une fausse accusation au Cluedo.', 1002),
  ('plat_cluedo_commissaire', 'Commissaire', 'Résoudre 10 enquêtes au Cluedo.', 1003)
on conflict (code) do nothing;

/* ---------- Outils ---------- */

-- Pièces accessibles depuis une pièce (voisines et passage secret).
create or replace function public.hg_plat__cl_voisines(p_piece text)
returns text[] language sql immutable as $$
  select case p_piece
    when 'cuisine' then array['bal', 'manger', 'bureau']
    when 'bal' then array['cuisine', 'veranda', 'manger', 'billard']
    when 'veranda' then array['bal', 'billard', 'salon']
    when 'manger' then array['cuisine', 'bal', 'salon', 'hall']
    when 'billard' then array['veranda', 'bal', 'bibliotheque']
    when 'bibliotheque' then array['billard', 'hall', 'bureau']
    when 'salon' then array['manger', 'hall', 'veranda']
    when 'hall' then array['salon', 'manger', 'bibliotheque', 'bureau']
    when 'bureau' then array['hall', 'bibliotheque', 'cuisine']
    else array[]::text[] end
$$;

create or replace function public.hg_plat__cl_ids(p_cle text)
returns text[] language sql stable security definer set search_path = public as $$
  select array_agg(x->>'id' order by o) from jsonb_array_elements(hg_plat__c('cluedo', p_cle)) with ordinality t(x, o)
$$;

-- Nom d'une carte 's:…', 'a:…', 'p:…'.
create or replace function public.hg_plat__cl_nom(p_carte text)
returns text language sql stable security definer set search_path = public as $$
  select hg_plat__n('cluedo', case left(p_carte, 1) when 's' then 'suspects' when 'a' then 'armes' else 'pieces' end, substr(p_carte, 3))
$$;

create or replace function public.hg_plat__cl_cartes(p_id uuid, p_user uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array(select jsonb_array_elements_text(prive->'cartes') from hg_plat_joueurs where partie = p_id and user_id = p_user), '{}')
$$;

create or replace function public.hg_plat__cl_hasard(p text[])
returns text language sql volatile as $$ select p[1 + floor(random() * cardinality(p))::int] $$;

-- Passe au joueur suivant non éliminé (ou termine si personne).
create or replace function public.hg_plat__cl_suivant(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare e jsonb; v_actif uuid; v_suiv uuid;
begin
  select etat into e from hg_plat_parties where id = p_id;
  v_actif := (e->>'actif')::uuid;
  v_suiv := hg_plat__suivant(p_id, v_actif);
  update hg_plat_joueurs set etat = etat || '{"deplace": false}' where partie = p_id and user_id = v_actif;
  update hg_plat_parties set nb_tours = nb_tours + 1,
    etat = etat || jsonb_build_object('actif', v_suiv, 'phase', 'deplacer', 'hypothese', null) where id = p_id;
  perform hg_plat__donner_tour(p_id, v_suiv);
end $$;

-- Fin si un seul joueur (ou aucun) n'est pas éliminé.
create or replace function public.hg_plat__cl_verifier(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_n int; v_u uuid;
begin
  select count(*), min(user_id::text)::uuid into v_n, v_u from hg_plat_joueurs where partie = p_id and not elimine;
  if v_n = 1 then
    perform hg_plat__log(p_id, v_u, 'info', hg_plat__nom(p_id, v_u) || ' est le dernier enquêteur en lice.');
    perform hg_plat__terminer(p_id, array[v_u], 'dernier');
    return true;
  elsif v_n = 0 then
    perform hg_plat__terminer(p_id, '{}', 'aucun');
    return true;
  end if;
  return false;
end $$;

/* ---------- Interface du socle ---------- */

create or replace function public.hg_plat__cluedo_options(p jsonb)
returns jsonb language sql immutable as $$ select '{}'::jsonb $$;

create or replace function public.hg_plat__cluedo_lancer(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_s text[] := hg_plat__cl_ids('suspects'); v_a text[] := hg_plat__cl_ids('armes'); v_p text[] := hg_plat__cl_ids('pieces');
  v_env jsonb; v_paquet text[]; v_joueurs uuid[]; v_n int; i int; v_pions jsonb := '{}'; v_premier uuid; s text;
begin
  v_env := jsonb_build_object('suspect', hg_plat__cl_hasard(v_s), 'arme', hg_plat__cl_hasard(v_a), 'piece', hg_plat__cl_hasard(v_p));
  select array_agg(c order by random()) into v_paquet from (
    select 's:' || x c from unnest(v_s) x where x <> v_env->>'suspect'
    union all select 'a:' || x from unnest(v_a) x where x <> v_env->>'arme'
    union all select 'p:' || x from unnest(v_p) x where x <> v_env->>'piece') t;
  select array_agg(user_id order by place) into v_joueurs from hg_plat_joueurs where partie = p_id;
  v_n := cardinality(v_joueurs);
  foreach s in array v_s loop v_pions := v_pions || jsonb_build_object(s, hg_plat__cl_hasard(v_p)); end loop;
  for i in 1 .. v_n loop
    update hg_plat_joueurs set
      prive = jsonb_build_object('cartes', (select coalesce(jsonb_agg(v_paquet[k] order by k), '[]') from generate_series(i, cardinality(v_paquet), v_n) k), 'vu', '[]'::jsonb),
      etat = jsonb_build_object('suspect', v_s[i], 'deplace', false, 'hypotheses', 0)
    where partie = p_id and user_id = v_joueurs[i];
  end loop;
  v_premier := v_joueurs[1];
  update hg_plat_parties set secret = jsonb_build_object('enveloppe', v_env), nb_tours = 1,
    etat = jsonb_build_object('pions', v_pions, 'armes', (select jsonb_object_agg(x, hg_plat__cl_hasard(v_p)) from unnest(v_a) x),
      'actif', v_premier, 'phase', 'deplacer', 'hypothese', null, 'historique', '[]'::jsonb)
  where id = p_id;
  perform hg_plat__log(p_id, null, 'info', 'L''enquête commence : qui a tué ' || (hg_plat__c('cluedo', 'victime') #>> '{}') || ' ?');
  perform hg_plat__donner_tour(p_id, v_premier);
end $$;

-- Montre une carte (choisie parmi celles qui correspondent à l'hypothèse).
create or replace function public.hg_plat__cl_montrer(p_id uuid, p_user uuid, p_carte text)
returns void language plpgsql security definer set search_path = public as $$
declare e jsonb; h jsonb; v_actif uuid;
begin
  select etat into e from hg_plat_parties where id = p_id;
  h := e->'hypothese'; v_actif := (e->>'actif')::uuid;
  if not (h->'possibles' ? p_carte) or not (p_carte = any(hg_plat__cl_cartes(p_id, p_user))) then
    raise exception 'Choisis une des cartes de l''hypothèse que tu as en main.';
  end if;
  update hg_plat_joueurs set prive = jsonb_set(prive, '{vu}', coalesce(prive->'vu', '[]') || jsonb_build_object('carte', p_carte, 'par', p_user))
    where partie = p_id and user_id = v_actif;
  perform hg_plat__log(p_id, p_user, 'montre', hg_plat__nom(p_id, p_user) || ' montre une carte à ' || hg_plat__nom(p_id, v_actif) || '.');
  perform hg_plat__log(p_id, p_user, 'secret', hg_plat__nom(p_id, p_user) || ' te montre : ' || hg_plat__cl_nom(p_carte) || '.', v_actif);
  perform hg_plat__log(p_id, p_user, 'secret', 'Tu as montré ' || hg_plat__cl_nom(p_carte) || ' à ' || hg_plat__nom(p_id, v_actif) || '.', p_user);
  update hg_plat_parties set etat = jsonb_set(jsonb_set(etat, '{phase}', '"apres"'), '{hypothese}',
      (h - 'possibles' - 'attente') || jsonb_build_object('montre_par', p_user, 'carte_montree', p_carte)),
    tour = null where id = p_id;
  -- L'historique public garde qui a montré (pas la carte).
  update hg_plat_parties set etat = jsonb_set(etat, '{historique}', (etat->'historique') || jsonb_build_array(
      jsonb_build_object('par', v_actif, 'suspect', h->>'suspect', 'arme', h->>'arme', 'piece', h->>'piece', 'montre_par', p_user)))
    where id = p_id;
  perform hg_plat__donner_tour(p_id, v_actif);
end $$;

-- Cherche qui doit montrer une carte après une hypothèse.
create or replace function public.hg_plat__cl_chercher(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare e jsonb; h jsonb; v_actif uuid; v_place int; r record; v_poss text[];
begin
  select etat into e from hg_plat_parties where id = p_id;
  h := e->'hypothese'; v_actif := (e->>'actif')::uuid;
  select place into v_place from hg_plat_joueurs where partie = p_id and user_id = v_actif;
  for r in select user_id from hg_plat_joueurs where partie = p_id and user_id <> v_actif
           order by (place < v_place), place loop
    v_poss := array(select c from unnest(hg_plat__cl_cartes(p_id, r.user_id)) c
                    where c in ('s:' || (h->>'suspect'), 'a:' || (h->>'arme'), 'p:' || (h->>'piece')));
    if cardinality(v_poss) > 0 then
      update hg_plat_parties set etat = jsonb_set(jsonb_set(etat, '{phase}', '"montrer"'), '{hypothese}',
        h || jsonb_build_object('attente', r.user_id, 'possibles', to_jsonb(v_poss))) where id = p_id;
      if cardinality(v_poss) = 1 then
        perform hg_plat__cl_montrer(p_id, r.user_id, v_poss[1]);
      else
        perform hg_plat__log(p_id, r.user_id, 'info', hg_plat__nom(p_id, r.user_id) || ' choisit une carte à montrer.');
        perform hg_plat__donner_tour(p_id, r.user_id);
      end if;
      return;
    end if;
  end loop;
  perform hg_plat__log(p_id, null, 'montre', 'Personne ne peut contredire cette hypothèse !');
  update hg_plat_parties set etat = jsonb_set(jsonb_set(jsonb_set(etat, '{phase}', '"apres"'), '{hypothese,montre_par}', 'null'),
      '{historique}', (etat->'historique') || jsonb_build_array(jsonb_build_object('par', v_actif, 'suspect', h->>'suspect', 'arme', h->>'arme', 'piece', h->>'piece', 'montre_par', null)))
    where id = p_id;
end $$;

create or replace function public.hg_plat__cluedo_agir(p_id uuid, p_user uuid, p_action text, a jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; e jsonb; v_actif uuid; ph text; j hg_plat_joueurs; v_ici text; v_dest text; v_s text; v_a text; v_pc text;
  v_proprio uuid; env jsonb;
begin
  select * into p from hg_plat_parties where id = p_id;
  e := p.etat; v_actif := (e->>'actif')::uuid; ph := e->>'phase';
  if p_action = 'montrer' then
    if ph <> 'montrer' or p.tour is distinct from p_user then raise exception 'Ce n''est pas à toi de montrer une carte.'; end if;
    perform hg_plat__cl_montrer(p_id, p_user, a->>'carte');
    return null;
  end if;
  if v_actif is distinct from p_user then raise exception 'Ce n''est pas ton tour.'; end if;
  select * into j from hg_plat_joueurs where partie = p_id and user_id = p_user;
  v_ici := e->'pions'->>(j.etat->>'suspect');

  if p_action = 'deplacer' or p_action = 'rester' then
    if ph <> 'deplacer' then raise exception 'Tu t''es déjà déplacé ce tour-ci.'; end if;
    if p_action = 'rester' then
      if not coalesce((j.etat->>'deplace')::boolean, false) then raise exception 'Tu dois changer de pièce (tu ne peux rester que si une hypothèse t''y a amené).'; end if;
      v_dest := v_ici;
      perform hg_plat__log(p_id, p_user, 'deplacer', j.pseudo || ' reste dans : ' || hg_plat__n('cluedo', 'pieces', v_dest) || '.');
    else
      v_dest := a->>'piece';
      if v_dest is null or not (v_dest = any(hg_plat__cl_voisines(v_ici))) then raise exception 'Choisis une pièce voisine (ou reliée par un passage secret).'; end if;
      perform hg_plat__log(p_id, p_user, 'deplacer', j.pseudo || ' va dans : ' || hg_plat__n('cluedo', 'pieces', v_dest) || '.');
    end if;
    update hg_plat_parties set etat = jsonb_set(jsonb_set(etat, array['pions', j.etat->>'suspect'], to_jsonb(v_dest)), '{phase}', '"hypothese"') where id = p_id;
    return null;

  elsif p_action = 'hypothese' then
    if ph <> 'hypothese' then raise exception 'Déplace-toi d''abord dans une pièce.'; end if;
    v_s := a->>'suspect'; v_a := a->>'arme';
    if v_s is null or v_a is null or not (v_s = any(hg_plat__cl_ids('suspects'))) or not (v_a = any(hg_plat__cl_ids('armes'))) then raise exception 'Choisis un suspect et une arme.'; end if;
    -- Le suspect et l'arme sont amenés dans la pièce.
    update hg_plat_parties set etat = jsonb_set(jsonb_set(etat, array['pions', v_s], to_jsonb(v_ici)), array['armes', v_a], to_jsonb(v_ici)),
      tour_fin = now() + make_interval(secs => t_tour) where id = p_id;
    select user_id into v_proprio from hg_plat_joueurs where partie = p_id and etat->>'suspect' = v_s and user_id <> p_user;
    if v_proprio is not null then
      update hg_plat_joueurs set etat = etat || '{"deplace": true}' where partie = p_id and user_id = v_proprio;
    end if;
    update hg_plat_joueurs set etat = jsonb_set(etat, '{hypotheses}', to_jsonb(coalesce((etat->>'hypotheses')::int, 0) + 1)) where partie = p_id and user_id = p_user;
    perform hg_plat__log(p_id, p_user, 'hypothese', j.pseudo || ' soupçonne ' || hg_plat__n('cluedo', 'suspects', v_s) || ', avec : '
      || hg_plat__n('cluedo', 'armes', v_a) || ', dans : ' || hg_plat__n('cluedo', 'pieces', v_ici) || '.');
    update hg_plat_parties set etat = jsonb_set(etat, '{hypothese}', jsonb_build_object('par', p_user, 'suspect', v_s, 'arme', v_a, 'piece', v_ici)) where id = p_id;
    perform hg_plat__cl_chercher(p_id);
    return null;

  elsif p_action = 'accuser' then
    if ph not in ('deplacer', 'hypothese', 'apres') then raise exception 'Attends la fin de l''hypothèse en cours.'; end if;
    v_s := a->>'suspect'; v_a := a->>'arme'; v_pc := a->>'piece';
    if v_s is null or v_a is null or v_pc is null or not (v_s = any(hg_plat__cl_ids('suspects'))) or not (v_a = any(hg_plat__cl_ids('armes'))) or not (v_pc = any(hg_plat__cl_ids('pieces'))) then
      raise exception 'Choisis un suspect, une arme et une pièce.';
    end if;
    env := p.secret->'enveloppe';
    perform hg_plat__log(p_id, p_user, 'accusation', j.pseudo || ' accuse ' || hg_plat__n('cluedo', 'suspects', v_s) || ', avec : '
      || hg_plat__n('cluedo', 'armes', v_a) || ', dans : ' || hg_plat__n('cluedo', 'pieces', v_pc) || '.');
    update hg_plat_parties set etat = etat || jsonb_build_object('accusations', coalesce(etat->'accusations', '[]') ||
      jsonb_build_array(jsonb_build_object('par', p_user, 'suspect', v_s, 'arme', v_a, 'piece', v_pc,
        'juste', env->>'suspect' = v_s and env->>'arme' = v_a and env->>'piece' = v_pc))) where id = p_id;
    if env->>'suspect' = v_s and env->>'arme' = v_a and env->>'piece' = v_pc then
      perform hg_plat__log(p_id, p_user, 'info', 'C''est juste ! ' || j.pseudo || ' a résolu l''enquête.');
      perform hg_plat__terminer(p_id, array[p_user], 'enquete');
    else
      update hg_plat_joueurs set elimine = true where partie = p_id and user_id = p_user;
      perform hg_plat__log(p_id, p_user, 'info', 'Fausse accusation : ' || j.pseudo || ' est éliminé (il montrera encore ses cartes).');
      perform hg_plat__log(p_id, null, 'secret', 'La bonne réponse était : ' || hg_plat__n('cluedo', 'suspects', env->>'suspect') || ', '
        || hg_plat__n('cluedo', 'armes', env->>'arme') || ', ' || hg_plat__n('cluedo', 'pieces', env->>'piece') || '.', p_user);
      if not hg_plat__cl_verifier(p_id) then perform hg_plat__cl_suivant(p_id); end if;
    end if;
    return null;

  elsif p_action = 'finir' then
    if ph not in ('hypothese', 'apres') then raise exception 'Déplace-toi d''abord.'; end if;
    perform hg_plat__cl_suivant(p_id);
    return null;
  end if;
  raise exception 'Action inconnue.';
end $$;

-- Chrono écoulé : joue un coup simple pour le joueur attendu (jamais d'accusation).
create or replace function public.hg_plat__cluedo_auto(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; e jsonb; ph text; v_u uuid; j hg_plat_joueurs; v_mes text[]; v_s text; v_a text;
begin
  select * into p from hg_plat_parties where id = p_id;
  e := p.etat; ph := e->>'phase';
  if ph = 'montrer' then
    v_u := p.tour;
    perform hg_plat__cl_montrer(p_id, v_u, hg_plat__cl_hasard(array(select jsonb_array_elements_text(e->'hypothese'->'possibles'))));
    return true;
  end if;
  v_u := (e->>'actif')::uuid;
  select * into j from hg_plat_joueurs where partie = p_id and user_id = v_u;
  v_mes := hg_plat__cl_cartes(p_id, v_u) || array(select x->>'carte' from jsonb_array_elements(coalesce(j.prive->'vu', '[]')) x);
  if ph = 'deplacer' then
    perform hg_plat__cluedo_agir(p_id, v_u, 'deplacer', jsonb_build_object('piece',
      hg_plat__cl_hasard(hg_plat__cl_voisines(e->'pions'->>(j.etat->>'suspect')))));
    return true;
  elsif ph = 'hypothese' then
    v_s := coalesce(hg_plat__cl_hasard(array(select x from unnest(hg_plat__cl_ids('suspects')) x where not ('s:' || x = any(v_mes)))), hg_plat__cl_hasard(hg_plat__cl_ids('suspects')));
    v_a := coalesce(hg_plat__cl_hasard(array(select x from unnest(hg_plat__cl_ids('armes')) x where not ('a:' || x = any(v_mes)))), hg_plat__cl_hasard(hg_plat__cl_ids('armes')));
    perform hg_plat__cluedo_agir(p_id, v_u, 'hypothese', jsonb_build_object('suspect', v_s, 'arme', v_a));
    return true;
  elsif ph = 'apres' then
    perform hg_plat__cl_suivant(p_id);
    return true;
  end if;
  return false;
end $$;

create or replace function public.hg_plat__cluedo_vue(p_id uuid, p_moi uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p hg_plat_parties; e jsonb; j hg_plat_joueurs; h jsonb; v_fini boolean; v_ici text;
begin
  select * into p from hg_plat_parties where id = p_id;
  select * into j from hg_plat_joueurs where partie = p_id and user_id = p_moi;
  e := p.etat; h := e->'hypothese';
  v_fini := p.statut in ('terminee', 'annulee');
  v_ici := e->'pions'->>(j.etat->>'suspect');
  return jsonb_build_object(
    'phase', e->>'phase', 'actif', e->'actif', 'pions', e->'pions', 'armes', e->'armes',
    'historique', e->'historique', 'accusations', coalesce(e->'accusations', '[]'),
    'hypothese', case when h is null or jsonb_typeof(h) = 'null' then null else
      jsonb_build_object('par', h->'par', 'suspect', h->'suspect', 'arme', h->'arme', 'piece', h->'piece', 'attente', h->'attente', 'montre_par', h->'montre_par')
      || case when (h->>'par')::uuid = p_moi and h ? 'carte_montree' then jsonb_build_object('carte_montree', h->'carte_montree') else '{}' end
      || case when (h->>'attente')::uuid = p_moi and e->>'phase' = 'montrer' then jsonb_build_object('a_montrer', h->'possibles') else '{}' end end,
    'mes_cartes', case when j.user_id is null then '[]'::jsonb else coalesce(j.prive->'cartes', '[]') end,
    'vu', case when j.user_id is null then '[]'::jsonb else coalesce(j.prive->'vu', '[]') end,
    'ma_piece', v_ici,
    'voisines', case when j.user_id is null then '[]'::jsonb else to_jsonb(hg_plat__cl_voisines(v_ici)) end,
    'peut_rester', coalesce((j.etat->>'deplace')::boolean, false),
    'enveloppe', case when v_fini then p.secret->'enveloppe' else null end,
    'mains', case when v_fini then (select jsonb_object_agg(user_id, prive->'cartes') from hg_plat_joueurs where partie = p_id) else null end
  );
end $$;

create or replace function public.hg_plat__cluedo_badges(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_n int;
begin
  for r in select user_id, gagne, elimine, etat from hg_plat_joueurs where partie = p_id and not invite loop
    if r.gagne and (select raison from hg_plat_parties where id = p_id) = 'enquete' then
      perform hg_plat__badge(r.user_id, 'plat_cluedo_detective');
      if coalesce((r.etat->>'hypotheses')::int, 0) <= 3 then perform hg_plat__badge(r.user_id, 'plat_cluedo_flair'); end if;
      select count(*) into v_n from hg_plat_joueurs j join hg_plat_parties p on p.id = j.partie
        where j.user_id = r.user_id and p.jeu = 'cluedo' and p.statut = 'terminee' and j.gagne and p.raison = 'enquete';
      if v_n >= 10 then perform hg_plat__badge(r.user_id, 'plat_cluedo_commissaire'); end if;
    end if;
    if r.elimine then perform hg_plat__badge(r.user_id, 'plat_cluedo_bevue'); end if;
  end loop;
end $$;

select public.hg_plat__droits();
