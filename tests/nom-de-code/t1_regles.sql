-- Règles du Nom de code : salle, lancement, secret des couleurs, indices, majorité, essais, assassin, départs, chat, récompenses.
do $$
declare v_code text; v_id uuid; e jsonb; r text; i int; n int; v_esp int; v_pos int; v_eq text; c record; v_ag int[];
begin
  delete from hg_wallet_log where reason = 'nom_de_code';
  -- Accès
  update hg_pages set mode = 'liste' where slug = 'nom-de-code';
  insert into hg_page_access(page_slug, user_id, allowed) select 'nom-de-code', t_uid(k), true from generate_series(1, 20) k on conflict do nothing;
  perform t_ok(t_err(22, 'hg_ndc_creer(''{}''::jsonb)') like 'Accès%', 'un membre sans accès ne peut pas créer');

  -- Salle
  v_code := t_call(1, 'hg_ndc_creer(''{"nb_places":6}''::jsonb)') #>> '{}';
  perform t_ok(v_code ~ '^HGNDC-[0-9]{4}$', 'code au format HGNDC-####');
  for i in 2 .. 3 loop perform t_call(i, format('hg_ndc_rejoindre(%L)', v_code)); end loop;
  perform t_ok(t_err(1, format('hg_ndc_lancer(%L)', v_code)) like '%au moins 4%', 'au moins 4 joueurs');
  perform t_call(4, format('hg_ndc_rejoindre(%L)', v_code));
  perform t_ok(t_err(1, format('hg_ndc_lancer(%L)', v_code)) like '%prêts%', 'tout le monde doit être prêt');
  for i in 2 .. 4 loop perform t_call(i, format('hg_ndc_pret(%L, true)', v_code)); end loop;
  perform t_ok(t_err(2, format('hg_ndc_espion(%L)', v_code)) like '%équipe%', 'espion : choisir une équipe d''abord');
  perform t_call(2, format('hg_ndc_equipe(%L, %L)', v_code, 'rose'));
  perform t_call(2, format('hg_ndc_espion(%L)', v_code));
  perform t_ok(t_err(3, format('hg_ndc_equipe(%L, %L, %L)', v_code, 'rose', t_uid(4))) like '%hôte%', 'seul l''hôte place les autres');
  perform t_call(3, format('hg_ndc_equipe(%L, %L)', v_code, 'rose'));
  perform t_call(4, format('hg_ndc_equipe(%L, %L)', v_code, 'rose'));
  perform t_call(1, format('hg_ndc_equipe(%L, %L)', v_code, 'rose'));
  perform t_ok(t_err(1, format('hg_ndc_lancer(%L)', v_code)) like '%au moins 2 joueurs%', 'deux joueurs minimum par équipe');
  perform t_call(1, format('hg_ndc_equilibrer(%L)', v_code));
  perform t_ok((select count(*) from hg_ndc_joueurs where partie = t_pid(v_code) and equipe = 'jaune') = 2, 'équilibrer : 2 contre 2');
  perform t_call(1, format('hg_ndc_lancer(%L)', v_code));
  v_id := t_pid(v_code);
  perform t_ok((select count(*) from hg_ndc_cartes where partie = v_id) = 25
    and (select count(*) from hg_ndc_cartes where partie = v_id and couleur = (select equipe_debut from hg_ndc_parties where id = v_id)) = 9
    and (select count(*) from hg_ndc_cartes where partie = v_id and couleur = 'assassin') = 1
    and (select count(*) from hg_ndc_cartes where partie = v_id and couleur = 'neutre') = 7, 'grille 9 / 8 / 7 / 1');
  perform t_ok((select count(*) from hg_ndc_joueurs where partie = v_id and espion) = 2, 'un espion par équipe');

  -- Secret des couleurs
  v_esp := t_num((select user_id from hg_ndc_joueurs where partie = v_id and espion and equipe = (select tour_equipe from hg_ndc_parties where id = v_id)));
  v_ag := array(select t_num(user_id) from hg_ndc_joueurs where partie = v_id and not espion and equipe = (select tour_equipe from hg_ndc_parties where id = v_id));
  e := t_call(v_ag[1], format('hg_ndc_etat(%L)', v_code));
  perform t_ok(not exists (select 1 from jsonb_array_elements(e->'cartes') x where x->>'couleur' is not null), 'un agent ne voit aucune couleur');
  e := t_call(v_esp, format('hg_ndc_etat(%L)', v_code));
  perform t_ok((select count(*) from jsonb_array_elements(e->'cartes') x where x->>'couleur' is not null) = 25, 'l''espion voit toute la carte');
  perform t_ok(not has_table_privilege('authenticated', 'hg_ndc_cartes', 'select'), 'table des cartes illisible en direct');

  -- Indices
  perform t_ok(t_err(v_ag[1], format('hg_ndc_indice(%L, %L, 2)', v_code, 'Plage')) like 'Seul l''espion%', 'seul l''espion donne l''indice');
  perform t_ok(t_err(v_ag[1], format('hg_ndc_proposer(%L, 0)', v_code)) like '%indice%', 'pas de proposition avant l''indice');
  select mot into r from hg_ndc_cartes where partie = v_id and char_length(mot) >= 4 limit 1;
  perform t_ok(t_err(v_esp, format('hg_ndc_indice(%L, %L, 2)', v_code, lower(r))) like 'Indice refusé%', 'indice égal à un mot de la grille refusé');
  perform t_ok(t_err(v_esp, format('hg_ndc_indice(%L, %L, 2)', v_code, r || 's')) like 'Indice refusé%', 'indice qui contient un mot de la grille refusé');
  perform t_ok(t_err(v_esp, format('hg_ndc_indice(%L, %L, 2)', v_code, 'deux mots')) like '%un seul mot%', 'indice en deux mots refusé');
  perform t_ok(t_err(v_esp, format('hg_ndc_indice(%L, %L, 12)', v_code, 'Galaxie')) like '%entre 0 et 9%', 'nombre limité à 9');
  perform t_call(v_esp, format('hg_ndc_indice(%L, %L, 1)', v_code, 'Galaxiq'));
  e := t_call(v_ag[1], format('hg_ndc_etat(%L)', v_code));
  perform t_ok(e->'partie'->>'phase' = 'devine' and (e->'partie'->>'essais')::int = 2 and e->'indice'->>'mot' = 'Galaxiq', 'indice donné : 2 essais');
  perform t_ok(t_err(v_ag[1], format('hg_ndc_valider(%L, 0)', v_code)) like '%majorité%', 'mode majorité : pas de validation directe');
  perform t_ok(t_err(v_ag[1], format('hg_ndc_arreter(%L)', v_code)) like '%au moins un mot%', 'on ne s''arrête pas sans avoir révélé un mot');
  v_eq := (select tour_equipe from hg_ndc_parties where id = v_id);
  -- 1 agent : sa proposition suffit (majorité de 1) ; un bon mot
  select pos into v_pos from hg_ndc_cartes where partie = v_id and couleur = v_eq limit 1;
  perform t_call(v_ag[1], format('hg_ndc_proposer(%L, %s)', v_code, v_pos));
  perform t_ok((select revelee from hg_ndc_cartes where partie = v_id and pos = v_pos) and (select essais from hg_ndc_parties where id = v_id) = 1
    and (select tour_equipe from hg_ndc_parties where id = v_id) = v_eq, 'bon mot révélé, l''équipe continue');
  e := t_call(v_ag[1], format('hg_ndc_etat(%L)', v_code));
  perform t_ok((select x->>'couleur' from jsonb_array_elements(e->'cartes') x where (x->>'pos')::int = v_pos) = v_eq, 'une carte révélée montre sa couleur à tous');
  select pos into v_pos from hg_ndc_cartes where partie = v_id and couleur = v_eq and not revelee limit 1;
  perform t_call(v_ag[1], format('hg_ndc_proposer(%L, %s)', v_code, v_pos));
  perform t_ok((select tour_equipe from hg_ndc_parties where id = v_id) <> v_eq and (select phase from hg_ndc_parties where id = v_id) = 'indice',
    'essais épuisés (nombre + 1) : le tour passe');
  -- L'autre équipe : un passant arrête le tour
  v_esp := t_num((select user_id from hg_ndc_joueurs where partie = v_id and espion and equipe <> v_eq));
  v_ag := array(select t_num(user_id) from hg_ndc_joueurs where partie = v_id and not espion and equipe <> v_eq);
  perform t_call(v_esp, format('hg_ndc_indice(%L, %L, 3)', v_code, 'Brume'));
  select pos into v_pos from hg_ndc_cartes where partie = v_id and couleur = 'neutre' limit 1;
  perform t_call(v_ag[1], format('hg_ndc_proposer(%L, %s)', v_code, v_pos));
  perform t_ok((select tour_equipe from hg_ndc_parties where id = v_id) = v_eq, 'un passant arrête le tour');
  -- Chat : canal d'équipe
  perform t_call(v_ag[1], format('hg_ndc_message(%L, %L, %L)', v_code, 'On tente ?', 'equipe'));
  perform t_ok(t_err(v_esp, format('hg_ndc_message(%L, %L, %L)', v_code, 'Indice caché', 'equipe')) like '%espion ne peut pas%', 'l''espion n''écrit pas dans le chat d''équipe');
  perform t_ok(jsonb_array_length(t_call(v_esp, format('hg_ndc_messages(%L)', v_id))) = 1, 'l''équipe lit son canal');
  perform t_ok(jsonb_array_length(t_call(t_num((select user_id from hg_ndc_joueurs where partie = v_id and equipe = v_eq and not espion)),
    format('hg_ndc_messages(%L)', v_id))) = 0, 'l''autre équipe ne lit pas ce canal');
  -- Échéance : l'espion n'a pas donné d'indice
  update hg_ndc_parties set tour_fin = now() - interval '1 second' where id = v_id;
  perform t_call(1, format('hg_ndc_avancer(%L)', v_code));
  perform t_ok((select tour_equipe from hg_ndc_parties where id = v_id) <> v_eq, 'pas d''indice à temps : le tour passe');
  -- L'assassin
  v_eq := (select tour_equipe from hg_ndc_parties where id = v_id);
  v_esp := t_num((select user_id from hg_ndc_joueurs where partie = v_id and espion and equipe = v_eq));
  v_ag := array(select t_num(user_id) from hg_ndc_joueurs where partie = v_id and not espion and equipe = v_eq);
  perform t_call(v_esp, format('hg_ndc_indice(%L, %L, 2)', v_code, 'Brouille'));
  select pos into v_pos from hg_ndc_cartes where partie = v_id and couleur = 'assassin';
  perform t_call(v_ag[1], format('hg_ndc_proposer(%L, %s)', v_code, v_pos));
  perform t_ok((select statut from hg_ndc_parties where id = v_id) = 'terminee' and (select vainqueur from hg_ndc_parties where id = v_id) <> v_eq,
    'l''assassin : l''équipe perd aussitôt');
  perform t_ok(exists (select 1 from hg_user_badges where user_id = t_uid(v_ag[1]) and badge_code = 'ndc_kamikaze'), 'badge Kamikaze');
  perform t_ok((select paillettes from hg_ndc_joueurs where partie = v_id and gagne and espion) = 130
    and (select paillettes from hg_ndc_joueurs where partie = v_id and gagne and not espion limit 1) = 110
    and (select paillettes from hg_ndc_joueurs where partie = v_id and not gagne limit 1) = 30, 'Paillettes : 30, +80 aux gagnants, +20 à l''espion gagnant');
  e := t_call(v_ag[1], format('hg_ndc_etat(%L)', v_code));
  perform t_ok((select count(*) from jsonb_array_elements(e->'cartes') x where x->>'couleur' is not null) = 25 and e->'partie'->>'raison' = 'assassin',
    'à la fin, toute la carte est dévoilée');

  -- Majorité à 3 agents, mode libre, départs
  v_code := t_partie(8);
  v_id := t_pid(v_code);
  v_eq := (select tour_equipe from hg_ndc_parties where id = v_id);
  v_esp := t_num((select user_id from hg_ndc_joueurs where partie = v_id and espion and equipe = v_eq));
  v_ag := array(select t_num(user_id) from hg_ndc_joueurs where partie = v_id and not espion and equipe = v_eq order by place);
  perform t_call(v_esp, format('hg_ndc_indice(%L, %L, 2)', v_code, 'Galaxiq'));
  select pos into v_pos from hg_ndc_cartes where partie = v_id and couleur = v_eq limit 1;
  perform t_call(v_ag[1], format('hg_ndc_proposer(%L, %s)', v_code, v_pos));
  perform t_ok(not (select revelee from hg_ndc_cartes where partie = v_id and pos = v_pos), '1 agent sur 3 : pas encore révélé');
  e := t_call(v_ag[2], format('hg_ndc_etat(%L)', v_code));
  perform t_ok((select jsonb_array_length(x->'propositions') from jsonb_array_elements(e->'cartes') x where (x->>'pos')::int = v_pos) = 1, 'les jetons sont visibles');
  perform t_call(v_ag[2], format('hg_ndc_proposer(%L, %s)', v_code, v_pos));
  perform t_ok((select revelee from hg_ndc_cartes where partie = v_id and pos = v_pos), '2 agents sur 3 : révélé');
  -- Départ d'un agent : la majorité se recalcule (1 sur 2 ne suffit pas, 2 sur 2 oui)
  perform t_call(v_ag[3], format('hg_ndc_quitter(%L)', v_code));
  select pos into v_pos from hg_ndc_cartes where partie = v_id and couleur = v_eq and not revelee limit 1;
  perform t_call(v_ag[1], format('hg_ndc_proposer(%L, %s)', v_code, v_pos));
  perform t_ok(not (select revelee from hg_ndc_cartes where partie = v_id and pos = v_pos), 'après un départ : 1 agent sur 2 ne suffit pas');
  perform t_call(v_ag[1], format('hg_ndc_arreter(%L)', v_code));
  perform t_ok((select tour_equipe from hg_ndc_parties where id = v_id) <> v_eq, '« On s''arrête » passe le tour');
  -- Départ de l'espion : un autre membre de l'équipe le remplace
  perform t_call(v_esp, format('hg_ndc_quitter(%L)', v_code));
  perform t_ok((select count(*) from hg_ndc_joueurs where partie = v_id and equipe = v_eq and espion and not parti) = 1, 'un espion parti est remplacé');
  -- Équipe réduite à un joueur : forfait
  perform t_call(v_ag[1], format('hg_ndc_quitter(%L)', v_code));
  perform t_ok((select statut from hg_ndc_parties where id = v_id) = 'terminee' and (select vainqueur from hg_ndc_parties where id = v_id) <> v_eq,
    'une équipe réduite à un joueur perd');

  v_code := t_partie(4, '{"validation":"libre"}');
  v_id := t_pid(v_code);
  v_eq := (select tour_equipe from hg_ndc_parties where id = v_id);
  v_esp := t_num((select user_id from hg_ndc_joueurs where partie = v_id and espion and equipe = v_eq));
  v_ag := array(select t_num(user_id) from hg_ndc_joueurs where partie = v_id and not espion and equipe = v_eq);
  perform t_call(v_esp, format('hg_ndc_indice(%L, %L, 0)', v_code, 'Galaxiq'));
  perform t_ok((select essais from hg_ndc_parties where id = v_id) = 25, 'indice 0 : essais illimités');
  -- L'équipe trouve tous ses mots : victoire
  for c in select pos from hg_ndc_cartes where partie = v_id and couleur = v_eq order by pos loop
    r := t_call(v_ag[1], format('hg_ndc_valider(%L, %s)', v_code, c.pos)) #>> '{}';
  end loop;
  perform t_ok((select vainqueur from hg_ndc_parties where id = v_id) = v_eq and (select etat->>'raison' from hg_ndc_parties where id = v_id) = 'mots',
    'tous les mots trouvés : victoire');
  perform t_ok(exists (select 1 from hg_user_badges where user_id = t_uid(v_esp) and badge_code = 'ndc_telepathe'), 'badge Télépathe (9 mots sur un indice)');
  perform t_ok(exists (select 1 from hg_user_badges where user_id = t_uid(v_ag[1]) and badge_code = 'ndc_sans_faute'), 'badge Sans faute');
  -- Revanche
  r := t_call(v_ag[1], format('hg_ndc_rejouer(%L)', v_code)) #>> '{}';
  perform t_ok(r ~ '^HGNDC-' and (select statut from hg_ndc_parties where code = r and statut = 'attente') = 'attente'
    and (select etat->>'suite' from hg_ndc_parties where id = v_id) = r, 'revanche : nouvelle salle');

  -- Invités
  v_code := t_call(1, 'hg_ndc_creer(''{"invites":true}''::jsonb)') #>> '{}';
  e := hg_ndc_invite('rejoindre', v_code, null, '{"pseudo":"Visiteur"}');
  perform t_ok(e->>'jeton' is not null, 'un invité rejoint avec un pseudo');
  perform hg_ndc_invite('equipe', v_code, e->>'jeton', '{"equipe":"rose"}');
  perform t_ok((select equipe from hg_ndc_joueurs where partie = t_pid(v_code) and invite) = 'rose', 'l''invité choisit son équipe');
  perform t_ok((hg_ndc_invite('etat', v_code, e->>'jeton'))->'moi'->>'equipe' = 'rose', 'l''invité lit l''état');
  perform t_ok(hg_ndc_invite('apercu', 'HGNDC-0000') is null, 'aperçu d''un code inconnu : null');

  -- Admin des mots
  perform t_ok((t_call(1, format('hg_ndc_admin_enregistrer_mots(%L, %L::text[])', 'gang', '{raclette,Paleto," ",Discord}')) #>> '{}')::int = 3, 'admin : ajout d''un paquet');
  perform t_ok(t_err(3, format('hg_ndc_admin_mots(%L)', 'gang')) like 'Réservé%', 'paquets réservés à l''admin');
end $$;
