-- Tests du Cluedo (moteur 126) : règles, secrets, chrono, fin.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
do $$
declare c text; pid uuid; e jsonb; v_actif uuid; v_autre uuid; env jsonb; i int; n int; v_err text; v jsonb; mes jsonb;
begin
  -- Création et limites
  perform t_ok(t_err(1, $q$hg_plat_creer('{"jeu":"cluedo","nb_places":2}'::jsonb)$q$) like '%entre 3 et 6%', 'cluedo : 3 joueurs minimum');
  c := t_partie('cluedo', 4);
  pid := t_pid(c);
  perform t_ok(c ~ '^HGCLU-\d{4}$', 'code HGCLU');
  select etat into e from hg_plat_parties where id = pid;
  perform t_ok((select count(*) from jsonb_object_keys(e->'pions')) = 6, '6 pions placés');
  perform t_ok((select sum(jsonb_array_length(prive->'cartes')) from hg_plat_joueurs where partie = pid) = 18, '18 cartes distribuées');
  perform t_ok((select count(distinct c2) from hg_plat_joueurs j, jsonb_array_elements_text(j.prive->'cartes') c2 where partie = pid) = 18, 'cartes toutes différentes');
  select secret->'enveloppe' into env from hg_plat_parties where id = pid;
  perform t_ok(not exists (select 1 from hg_plat_joueurs j, jsonb_array_elements_text(j.prive->'cartes') c2 where partie = pid
     and c2 in ('s:' || (env->>'suspect'), 'a:' || (env->>'arme'), 'p:' || (env->>'piece'))), 'enveloppe hors des mains');

  -- Secrets : la vue ne contient ni l'enveloppe ni les mains des autres
  v_actif := (e->>'actif')::uuid;
  v := t_etat(v_actif, c);
  perform t_ok(v->'jeu'->'enveloppe' = 'null'::jsonb and v->'jeu'->'mains' = 'null'::jsonb, 'vue : enveloppe cachée');
  perform t_ok(jsonb_array_length(v->'jeu'->'mes_cartes') between 4 and 5, 'vue : mes cartes');
  perform t_ok(not (v::text like '%"secret"%'), 'vue : pas de champ secret');
  perform t_ok(t_err(1, format('(select secret from hg_plat_parties where code = %L)', c)) is not null, 'secret illisible en direct');

  -- Tour : seul l'actif joue
  select user_id into v_autre from hg_plat_joueurs where partie = pid and user_id <> v_actif limit 1;
  perform t_ok(t_agir_err(v_autre, c, 'deplacer', '{"piece":"hall"}') like '%pas ton tour%', 'un autre ne joue pas');
  perform t_ok(t_agir_err(v_actif, c, 'hypothese', '{"suspect":"rose","arme":"corde"}') like '%Déplace-toi%', 'hypothèse avant déplacement refusée');
  perform t_ok(t_agir_err(v_actif, c, 'rester') like '%changer de pièce%', 'rester interdit sans y avoir été amené');
  v := t_etat(v_actif, c);
  perform t_ok(t_agir_err(v_actif, c, 'deplacer', '{"piece":"nulle_part"}') like '%voisine%', 'pièce non voisine refusée');
  perform t_agir(v_actif, c, 'deplacer', jsonb_build_object('piece', v->'jeu'->'voisines'->>0));
  select etat into e from hg_plat_parties where id = pid;
  perform t_ok(e->>'phase' = 'hypothese', 'phase hypothèse après déplacement');
  perform t_ok(t_agir_err(v_actif, c, 'deplacer', '{"piece":"hall"}') like '%déjà déplacé%', 'un seul déplacement');

  -- Hypothèse : le suspect est amené, quelqu'un montre
  perform t_agir(v_actif, c, 'hypothese', '{"suspect":"violet","arme":"corde"}');
  select etat into e from hg_plat_parties where id = pid;
  perform t_ok(e->'pions'->>'violet' = v->'jeu'->>'voisines' and true or e->'pions'->>'violet' = (v->'jeu'->'voisines'->>0), 'suspect amené dans la pièce');
  perform t_ok(e->'armes'->>'corde' = (v->'jeu'->'voisines'->>0), 'arme amenée dans la pièce');
  if e->>'phase' = 'montrer' then
    -- Celui qui doit montrer choisit
    v := t_etat((e->'hypothese'->>'attente')::uuid, c);
    perform t_ok(jsonb_array_length(v->'jeu'->'hypothese'->'a_montrer') >= 2, 'choix proposé au joueur qui montre');
    perform t_ok(t_agir_err((e->'hypothese'->>'attente')::uuid, c, 'montrer', '{"carte":"s:inexistant"}') like '%Choisis%', 'carte hors hypothèse refusée');
    perform t_agir((e->'hypothese'->>'attente')::uuid, c, 'montrer', jsonb_build_object('carte', v->'jeu'->'hypothese'->'a_montrer'->>0));
    select etat into e from hg_plat_parties where id = pid;
  end if;
  perform t_ok(e->>'phase' = 'apres', 'phase après l''hypothèse');
  perform t_ok(jsonb_array_length(e->'historique') = 1, 'hypothèse dans l''historique');
  v := t_etat(v_actif, c);
  if e->'hypothese'->>'montre_par' is not null then
    perform t_ok(v->'jeu'->'hypothese'->>'carte_montree' is not null and jsonb_array_length(v->'jeu'->'vu') = 1, 'l''enquêteur voit la carte montrée');
    perform t_ok(t_etat(v_autre, c)->'jeu'->'hypothese'->>'carte_montree' is null or v_autre = (e->'hypothese'->>'montre_par')::uuid, 'les autres ne la voient pas');
  end if;
  perform t_agir(v_actif, c, 'finir');
  select etat into e from hg_plat_parties where id = pid;
  perform t_ok((e->>'actif')::uuid <> v_actif and e->>'phase' = 'deplacer', 'tour suivant');

  -- Chrono : 40 coups automatiques sans blocage
  for i in 1 .. 40 loop perform t_expirer(c); end loop;
  perform t_ok((select statut from hg_plat_parties where id = pid) = 'en_cours', 'auto : la partie continue (jamais d''accusation automatique)');
  perform t_ok((select jsonb_array_length(etat->'historique') from hg_plat_parties where id = pid) >= 5, 'auto : des hypothèses ont été jouées');
  perform t_ok((select bool_or(absent) from hg_plat_joueurs where partie = pid), 'auto : joueur absent après 3 tours manqués');

  -- Fausse accusation : élimination
  select etat into e from hg_plat_parties where id = pid;
  if e->>'phase' = 'montrer' then perform t_expirer(c); select etat into e from hg_plat_parties where id = pid; end if;
  v_actif := (e->>'actif')::uuid;
  perform t_agir(v_actif, c, 'accuser', jsonb_build_object('suspect', env->>'suspect', 'arme', env->>'arme',
    'piece', case when env->>'piece' = 'hall' then 'bureau' else 'hall' end));
  perform t_ok((select elimine from hg_plat_joueurs where partie = pid and user_id = v_actif), 'fausse accusation : éliminé');
  perform t_ok(t_agir_err(v_actif, c, 'finir') like '%éliminé%', 'éliminé : ne joue plus');
  perform t_ok((select (etat->>'actif')::uuid from hg_plat_parties where id = pid) <> v_actif, 'éliminé : tour passé');
  perform t_ok(exists (select 1 from hg_plat_coups where partie = pid and pour = v_actif and texte like 'La bonne réponse%'), 'éliminé : il apprend la solution en privé');

  -- Bonne accusation : victoire, Paillettes (partie de plus de 3 min)
  update hg_plat_parties set started_at = now() - interval '20 minutes' where id = pid;
  select etat into e from hg_plat_parties where id = pid;
  if e->>'phase' = 'montrer' then perform t_expirer(c); select etat into e from hg_plat_parties where id = pid; end if;
  v_actif := (e->>'actif')::uuid;
  perform t_agir(v_actif, c, 'accuser', jsonb_build_object('suspect', env->>'suspect', 'arme', env->>'arme', 'piece', env->>'piece'));
  perform t_ok((select statut from hg_plat_parties where id = pid) = 'terminee', 'bonne accusation : partie gagnée');
  perform t_ok((select gagne from hg_plat_joueurs where partie = pid and user_id = v_actif), 'gagnant marqué');
  perform t_ok((select paillettes from hg_plat_joueurs where partie = pid and user_id = v_actif) = 130, 'Paillettes 30 + 100');
  perform t_ok(exists (select 1 from hg_user_badges where user_id = v_actif and badge_code = 'plat_cluedo_detective'), 'badge Fin limier');
  v := t_etat(v_actif, c);
  perform t_ok(v->'jeu'->'enveloppe'->>'suspect' = env->>'suspect', 'fin : enveloppe révélée');
  perform t_ok(jsonb_array_length(v->'badges') >= 1, 'fin : badges dans l''état');

  -- Dernier en lice
  c := t_partie('cluedo', 3); pid := t_pid(c);
  select secret->'enveloppe' into env from hg_plat_parties where id = pid;
  for i in 1 .. 2 loop
    select etat into e from hg_plat_parties where id = pid;
    perform t_agir((e->>'actif')::uuid, c, 'accuser', jsonb_build_object('suspect', env->>'suspect', 'arme', env->>'arme',
      'piece', case when env->>'piece' = 'hall' then 'bureau' else 'hall' end));
  end loop;
  perform t_ok((select statut from hg_plat_parties where id = pid) = 'terminee' and (select count(*) from hg_plat_joueurs where partie = pid and gagne) = 1, 'dernier en lice gagne');
  -- Revanche
  perform t_ok(t_call(1, format('hg_plat_rejouer(%L)', c)) #>> '{}' ~ '^HGCLU-', 'revanche créée');
end $$;
