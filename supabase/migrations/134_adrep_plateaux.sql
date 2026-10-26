-- ===== Humane Gang — migration 134 : réponses cachées des jeux de plateau (bouton « Réponses » des administrateurs) =====
-- Une fonction par jeu, appelée par hg_admin_reponses(p_jeu, p_ref) (migration 133) au clic sur le bouton.
-- p_ref = id de la partie (uuid en texte). Pas de contrôle admin ici : le point d'entrée le fait.
-- Jeux sans information cachée (destins) : pas de fonction, donc pas de bouton.
--   cluedo   : l'enveloppe (secret->'enveloppe') et la main de chaque joueur (prive->'cartes').
--   shadow   : le personnage (prive->>'perso') et le camp de chaque joueur, vivant ou mort.
--   monopoly : l'ordre des prochaines cartes Chance et Caisse (secret->'chance' / 'caisse', le premier tiré en premier)
--              et les cartes de sortie de prison en main (prive->'cartes_gardees').
--   risk     : la mission secrète de chaque joueur (prive->'mission') et ses cartes territoire (prive->'cartes').

/* ---------- Cluedo ---------- */
create or replace function public.hg_adrep_cluedo(p_ref text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  p hg_plat_parties;
  r record;
  v_env jsonb;
  v_sections jsonb := '[]'::jsonb;
begin
  if p_ref is null or p_ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('titre', 'Cluedo — réponses', 'note', 'Ouvre une partie de Cluedo pour voir ses réponses.', 'sections', '[]'::jsonb);
  end if;
  select * into p from hg_plat_parties where id = p_ref::uuid and jeu = 'cluedo';
  if not found then
    return jsonb_build_object('titre', 'Cluedo — réponses', 'note', 'Partie introuvable.', 'sections', '[]'::jsonb);
  end if;
  v_env := p.secret->'enveloppe';
  if v_env is null or jsonb_typeof(v_env) <> 'object' then
    return jsonb_build_object('titre', 'Cluedo — réponses', 'note', 'La partie n''a pas encore commencé : rien à montrer.', 'sections', '[]'::jsonb);
  end if;

  v_sections := v_sections || jsonb_build_array(jsonb_build_object('titre', 'L''enveloppe (la solution)', 'lignes', jsonb_build_array(
    jsonb_build_object('label', 'Suspect', 'valeur', hg_plat__n('cluedo', 'suspects', v_env->>'suspect')),
    jsonb_build_object('label', 'Arme', 'valeur', hg_plat__n('cluedo', 'armes', v_env->>'arme')),
    jsonb_build_object('label', 'Pièce', 'valeur', hg_plat__n('cluedo', 'pieces', v_env->>'piece')))));

  for r in select j.pseudo, j.elimine, j.prive from hg_plat_joueurs j where j.partie = p.id order by j.place loop
    v_sections := v_sections || jsonb_build_array(jsonb_build_object(
      'titre', 'Main de ' || r.pseudo || case when r.elimine then ' (éliminé)' else '' end,
      'liste', coalesce((select jsonb_agg(hg_plat__cl_nom(c) order by o)
                         from jsonb_array_elements_text(coalesce(r.prive->'cartes', '[]'::jsonb)) with ordinality t(c, o)), '[]'::jsonb)));
  end loop;

  return jsonb_build_object('titre', 'Cluedo — réponses', 'note', null, 'sections', v_sections);
end $$;
revoke all on function public.hg_adrep_cluedo(text) from public, anon, authenticated;

/* ---------- Shadow Hunters ---------- */
create or replace function public.hg_adrep_shadow(p_ref text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  p hg_plat_parties;
  v_lignes jsonb;
begin
  if p_ref is null or p_ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('titre', 'Shadow Hunters — réponses', 'note', 'Ouvre une partie de Shadow Hunters pour voir ses réponses.', 'sections', '[]'::jsonb);
  end if;
  select * into p from hg_plat_parties where id = p_ref::uuid and jeu = 'shadow';
  if not found then
    return jsonb_build_object('titre', 'Shadow Hunters — réponses', 'note', 'Partie introuvable.', 'sections', '[]'::jsonb);
  end if;
  if p.statut = 'attente' or not exists (select 1 from hg_plat_joueurs where partie = p.id and prive ? 'perso') then
    return jsonb_build_object('titre', 'Shadow Hunters — réponses', 'note', 'La partie n''a pas encore commencé : personnages non distribués.', 'sections', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'label', j.pseudo,
      'valeur', hg_plat__n('shadow', 'personnages', coalesce(j.prive->>'perso', '')) || ' — '
        || hg_plat__n('shadow', 'camps', coalesce(hg_plat__sh_camp(j.prive->>'perso'), 'neutre')) || ' — '
        || case when j.elimine then 'mort' else 'vivant' end,
      'ton', case hg_plat__sh_camp(j.prive->>'perso') when 'hunter' then 'bleu' when 'shadow' then 'rouge' else 'neutre' end)
    order by j.place), '[]'::jsonb) into v_lignes
  from hg_plat_joueurs j where j.partie = p.id;

  return jsonb_build_object('titre', 'Shadow Hunters — réponses', 'note', null, 'sections', jsonb_build_array(
    jsonb_build_object('titre', 'Personnages et camps', 'lignes', v_lignes)));
end $$;
revoke all on function public.hg_adrep_shadow(text) from public, anon, authenticated;

/* ---------- Monopoly ---------- */
create or replace function public.hg_adrep_monopoly(p_ref text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  p hg_plat_parties;
  r record;
  v_chance jsonb;
  v_caisse jsonb;
  v_sortie jsonb := '[]'::jsonb;
  v_sections jsonb := '[]'::jsonb;
begin
  if p_ref is null or p_ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('titre', 'Monopoly — réponses', 'note', 'Ouvre une partie de Monopoly pour voir ses réponses.', 'sections', '[]'::jsonb);
  end if;
  select * into p from hg_plat_parties where id = p_ref::uuid and jeu = 'monopoly';
  if not found then
    return jsonb_build_object('titre', 'Monopoly — réponses', 'note', 'Partie introuvable.', 'sections', '[]'::jsonb);
  end if;
  if p.statut = 'attente' or p.secret->'chance' is null then
    return jsonb_build_object('titre', 'Monopoly — réponses', 'note', 'La partie n''a pas encore commencé : pas de pioche tirée.', 'sections', '[]'::jsonb);
  end if;

  -- Ordre de tirage des piles (le premier de la liste est tiré en premier).
  select coalesce(jsonb_agg(format('%s. %s', t.o, coalesce(
      (select x->>'texte' from jsonb_array_elements(hg_plat__c('monopoly', 'chance')) x where x->>'id' = t.id), t.id)) order by t.o), '[]'::jsonb)
    into v_chance
    from jsonb_array_elements_text(coalesce(p.secret->'chance', '[]'::jsonb)) with ordinality t(id, o);
  select coalesce(jsonb_agg(format('%s. %s', t.o, coalesce(
      (select x->>'texte' from jsonb_array_elements(hg_plat__c('monopoly', 'caisse')) x where x->>'id' = t.id), t.id)) order by t.o), '[]'::jsonb)
    into v_caisse
    from jsonb_array_elements_text(coalesce(p.secret->'caisse', '[]'::jsonb)) with ordinality t(id, o);

  v_sections := v_sections || jsonb_build_array(
    jsonb_build_object('titre', 'Prochaines cartes Chance', 'liste',
      case when jsonb_array_length(v_chance) = 0 then '["Pioche vide : elle sera remélangée au prochain tirage."]'::jsonb else v_chance end),
    jsonb_build_object('titre', 'Prochaines cartes Caisse de communauté', 'liste',
      case when jsonb_array_length(v_caisse) = 0 then '["Pioche vide : elle sera remélangée au prochain tirage."]'::jsonb else v_caisse end));

  -- Cartes de sortie de prison gardées par chaque joueur.
  for r in select j.pseudo, j.prive from hg_plat_joueurs j where j.partie = p.id order by j.place loop
    v_sortie := v_sortie || jsonb_build_array(jsonb_build_object('label', r.pseudo, 'valeur', coalesce((
      select string_agg(coalesce(
          (select x->>'texte' from jsonb_array_elements(hg_plat__c('monopoly', 'chance')) x where x->>'id' = t.id),
          (select x->>'texte' from jsonb_array_elements(hg_plat__c('monopoly', 'caisse')) x where x->>'id' = t.id),
          t.id), ' ; ' order by t.o)
      from jsonb_array_elements_text(coalesce(r.prive->'cartes_gardees', '[]'::jsonb)) with ordinality t(id, o)), 'aucune')));
  end loop;
  v_sections := v_sections || jsonb_build_array(jsonb_build_object('titre', 'Cartes de sortie de prison en main', 'lignes', v_sortie));

  return jsonb_build_object('titre', 'Monopoly — réponses', 'note', null, 'sections', v_sections);
end $$;
revoke all on function public.hg_adrep_monopoly(text) from public, anon, authenticated;

/* ---------- Risk ---------- */
create or replace function public.hg_adrep_risk(p_ref text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  p hg_plat_parties;
  r record;
  v_missions jsonb;
  v_cartes jsonb := '[]'::jsonb;
  v_sections jsonb := '[]'::jsonb;
begin
  if p_ref is null or p_ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('titre', 'Risk — réponses', 'note', 'Ouvre une partie de Risk pour voir ses réponses.', 'sections', '[]'::jsonb);
  end if;
  select * into p from hg_plat_parties where id = p_ref::uuid and jeu = 'risk';
  if not found then
    return jsonb_build_object('titre', 'Risk — réponses', 'note', 'Partie introuvable.', 'sections', '[]'::jsonb);
  end if;
  if not exists (select 1 from hg_plat_joueurs where partie = p.id and prive ? 'mission') then
    return jsonb_build_object('titre', 'Risk — réponses', 'note', 'La partie n''a pas encore commencé : pas de mission distribuée.', 'sections', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'label', j.pseudo,
      'valeur', coalesce((select x->>'texte' from jsonb_array_elements(hg_plat__c('risk', 'missions')) x
                          where x->>'id' = j.prive->'mission'->>'id'), '—')
        || case when j.prive->'mission'->>'cible' is not null
             then ' (joueur visé : ' || hg_plat__nom(p.id, (j.prive->'mission'->>'cible')::uuid) || ')' else '' end)
    order by j.place), '[]'::jsonb) into v_missions
  from hg_plat_joueurs j where j.partie = p.id;

  -- Cartes territoire en main (les jokers sont marqués à part).
  for r in select j.pseudo, j.prive from hg_plat_joueurs j where j.partie = p.id order by j.place loop
    v_cartes := v_cartes || jsonb_build_array(jsonb_build_object('label', r.pseudo, 'valeur', coalesce((
      select string_agg(case when t.c like 'joker%' then 'Joker'
                             else hg_plat__rk_nom(t.c) || ' (' || hg_plat__rk_symbole(t.c) || ')' end, ' · ' order by t.o)
      from jsonb_array_elements_text(coalesce(r.prive->'cartes', '[]'::jsonb)) with ordinality t(c, o)), 'aucune')));
  end loop;

  v_sections := jsonb_build_array(
    jsonb_build_object('titre', 'Missions secrètes', 'lignes', v_missions),
    jsonb_build_object('titre', 'Cartes territoire en main', 'lignes', v_cartes));

  return jsonb_build_object('titre', 'Risk — réponses', 'note', null, 'sections', v_sections);
end $$;
revoke all on function public.hg_adrep_risk(text) from public, anon, authenticated;
