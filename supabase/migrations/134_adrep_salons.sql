-- Réponses admin (bouton « Réponses ») pour trois jeux : Loup-Garou, Codenames, Uno.
-- Point d'entrée commun : hg_admin_reponses(p_jeu, p_ref) (migration 133), qui vérifie l'administrateur
-- et appelle public.hg_adrep_<jeu>(p_ref text). Ici : une fonction par jeu, droits retirés (non appelables directement).
-- p_ref = id de la partie en cours. Sans référence valide ou sans partie : une note explicative, jamais d'erreur.

/* =====================================================================
   Loup-Garou : rôle de chaque joueur (vivant / mort), amoureux, cartes du centre
   ===================================================================== */
create or replace function public.hg_adrep_loupgarou(p_ref text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_id uuid;
  v_p hg_lg_parties;
  v_titre text := 'Loup-Garou — rôles';
  v_sections jsonb := '[]'::jsonb;
  v_lignes jsonb;
  r record;
begin
  if p_ref is null or p_ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('titre', v_titre, 'note', 'Aucune partie sélectionnée : ouvre une partie pour voir ses rôles.', 'sections', '[]'::jsonb);
  end if;
  v_id := p_ref::uuid;
  select * into v_p from hg_lg_parties where id = v_id;
  if not found then
    return jsonb_build_object('titre', v_titre, 'note', 'Partie introuvable.', 'sections', '[]'::jsonb);
  end if;
  v_titre := 'Loup-Garou — ' || v_p.nom;
  if not exists (select 1 from hg_lg_cartes where partie = v_id) then
    return jsonb_build_object('titre', v_titre, 'note', 'Les rôles ne sont pas encore distribués (partie : ' || v_p.statut || ').', 'sections', '[]'::jsonb);
  end if;

  for r in
    select coalesce(pr.pseudo, j.pseudo) as pseudo, j.vivant, j.mort_manche, j.mort_cause,
           c.role, c.role_initial, c.camp, c.etat->>'amoureux' as amoureux,
           rr.nom as role_nom, ri.nom as role_initial_nom
      from hg_lg_joueurs j
      join hg_lg_cartes c on c.partie = j.partie and c.user_id = j.user_id
      left join hg_lg_roles rr on rr.id = c.role
      left join hg_lg_roles ri on ri.id = c.role_initial
      left join hg_profiles pr on pr.id = j.user_id
     where j.partie = v_id
     order by j.place, coalesce(pr.pseudo, j.pseudo)
  loop
    v_lignes := jsonb_build_array(
      jsonb_build_object('label', 'Rôle',
        'valeur', coalesce(r.role_nom, r.role)
          || case when r.role_initial is distinct from r.role then ' (au départ : ' || coalesce(r.role_initial_nom, r.role_initial) || ')' else '' end,
        'ton', case r.camp when 'loups' then 'rouge' when 'village' then 'bleu' else 'noir' end),
      jsonb_build_object('label', 'Camp',
        'valeur', case r.camp when 'loups' then 'Loups' when 'village' then 'Village' else 'Solo' end),
      jsonb_build_object('label', 'État',
        'valeur', case when r.vivant then 'Vivant' else ('Mort' || coalesce(' (manche ' || r.mort_manche || ')', '') || coalesce(' — ' || r.mort_cause, '')) end,
        'ton', case when r.vivant then 'ok' else 'ko' end));
    if r.amoureux is not null then
      v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('label', 'Amoureux de',
        'valeur', (select coalesce(pr2.pseudo, j2.pseudo) from hg_lg_joueurs j2
                     left join hg_profiles pr2 on pr2.id = j2.user_id
                    where j2.partie = v_id and j2.user_id = r.amoureux::uuid),
        'ton', 'rouge'));
    end if;
    v_sections := v_sections || jsonb_build_array(jsonb_build_object('titre', r.pseudo, 'lignes', v_lignes));
  end loop;

  select jsonb_agg(jsonb_build_object('label', 'Carte ' || (ce.idx + 1), 'valeur', rr.nom,
      'ton', case rr.camp when 'loups' then 'rouge' when 'village' then 'bleu' else 'noir' end) order by ce.idx)
    into v_lignes
    from hg_lg_centre ce join hg_lg_roles rr on rr.id = ce.role
   where ce.partie = v_id;
  if v_lignes is not null then
    v_sections := v_sections || jsonb_build_array(jsonb_build_object('titre', 'Cartes du centre', 'lignes', v_lignes));
  end if;

  return jsonb_build_object('titre', v_titre, 'note', null, 'sections', v_sections);
end $$;
revoke all on function public.hg_adrep_loupgarou(text) from public, anon, authenticated;

/* =====================================================================
   Codenames : grille-clé (5 × 5) et couleur de chaque mot, espions, équipe qui commence
   Équipes : pastilles rose et jaune.
   ===================================================================== */
create or replace function public.hg_adrep_codenames(p_ref text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_id uuid;
  v_p hg_ndc_parties;
  v_titre text := 'Codenames — grille-clé';
  v_sections jsonb := '[]'::jsonb;
  v_lignes jsonb;
  v_grille jsonb;
  r record;
begin
  if p_ref is null or p_ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('titre', v_titre, 'note', 'Aucune partie sélectionnée : ouvre une partie pour voir la grille-clé.', 'sections', '[]'::jsonb);
  end if;
  v_id := p_ref::uuid;
  select * into v_p from hg_ndc_parties where id = v_id;
  if not found then
    return jsonb_build_object('titre', v_titre, 'note', 'Partie introuvable.', 'sections', '[]'::jsonb);
  end if;
  v_titre := 'Codenames — ' || v_p.nom;
  if not exists (select 1 from hg_ndc_cartes where partie = v_id) then
    return jsonb_build_object('titre', v_titre, 'note', 'La grille n''est pas encore tirée (partie : ' || v_p.statut || ').', 'sections', '[]'::jsonb);
  end if;

  -- Espions et équipe qui commence
  v_lignes := jsonb_build_array(jsonb_build_object('label', 'Équipe qui commence',
    'valeur', coalesce(initcap(v_p.equipe_debut), '—')));
  for r in
    select coalesce(pr.pseudo, j.pseudo) as pseudo, j.equipe
      from hg_ndc_joueurs j left join hg_profiles pr on pr.id = j.user_id
     where j.partie = v_id and j.espion
     order by j.equipe, coalesce(pr.pseudo, j.pseudo)
  loop
    v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('label', 'Espion ' || initcap(r.equipe),
      'valeur', r.pseudo, 'ton', case r.equipe when 'rose' then 'rose' else 'jaune' end));
  end loop;
  v_sections := v_sections || jsonb_build_array(jsonb_build_object('titre', 'Espions', 'lignes', v_lignes));

  -- Grille 5 × 5 (mots seulement, dans l'ordre de la grille)
  select jsonb_agg(x.ligne order by x.rn) into v_grille from (
    select g.pos / 5 as rn, jsonb_agg(g.mot order by g.pos) as ligne
      from hg_ndc_cartes g where g.partie = v_id group by g.pos / 5
  ) x;
  v_sections := v_sections || jsonb_build_array(jsonb_build_object('titre', 'Grille', 'grille', v_grille));

  -- Couleur de chaque mot
  select jsonb_agg(jsonb_build_object('label', g.mot,
      'valeur', (case g.couleur when 'rose' then 'Équipe rose' when 'jaune' then 'Équipe jaune' when 'neutre' then 'Neutre' else 'Assassin' end)
                || case when g.revelee then ' (révélé)' else '' end,
      'ton', case g.couleur when 'rose' then 'rose' when 'jaune' then 'jaune' when 'neutre' then 'neutre' else 'noir' end)
    order by array_position(array['rose', 'jaune', 'neutre', 'assassin'], g.couleur), g.pos)
    into v_lignes
    from hg_ndc_cartes g where g.partie = v_id;
  v_sections := v_sections || jsonb_build_array(jsonb_build_object('titre', 'Couleur des mots', 'lignes', v_lignes));

  return jsonb_build_object('titre', v_titre, 'note', null, 'sections', v_sections);
end $$;
revoke all on function public.hg_adrep_codenames(text) from public, anon, authenticated;

/* =====================================================================
   Uno : main de chaque joueur, puis les 5 prochaines cartes de la pioche
   Pioche : la carte suivante est celle d'ordre le plus élevé (même règle que le moteur, migration 121).
   Pastilles : rouge, bleu, vert, jaune, joker -> noir.
   ===================================================================== */
create or replace function public.hg_adrep_uno(p_ref text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_id uuid;
  v_p hg_uno_parties;
  v_titre text := 'Uno — mains et pioche';
  v_sections jsonb := '[]'::jsonb;
  v_lignes jsonb;
  r record;
begin
  if p_ref is null or p_ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('titre', v_titre, 'note', 'Aucune partie sélectionnée : ouvre une partie pour voir les mains.', 'sections', '[]'::jsonb);
  end if;
  v_id := p_ref::uuid;
  select * into v_p from hg_uno_parties where id = v_id;
  if not found then
    return jsonb_build_object('titre', v_titre, 'note', 'Partie introuvable.', 'sections', '[]'::jsonb);
  end if;
  v_titre := 'Uno — ' || v_p.nom;
  if not exists (select 1 from hg_uno_cartes where partie = v_id) then
    return jsonb_build_object('titre', v_titre, 'note', 'Les cartes ne sont pas encore distribuées (partie : ' || v_p.statut || ').', 'sections', '[]'::jsonb);
  end if;

  -- Main de chaque joueur (cartes en main, dans l'ordre de pioche)
  for r in
    select j.user_id, coalesce(pr.pseudo, j.pseudo) as pseudo
      from hg_uno_joueurs j left join hg_profiles pr on pr.id = j.user_id
     where j.partie = v_id
     order by j.place, coalesce(pr.pseudo, j.pseudo)
  loop
    select jsonb_agg(jsonb_build_object('label', 'Carte ' || x.rn, 'valeur', x.lbl, 'ton', x.ton) order by x.rn)
      into v_lignes
      from (
        select row_number() over (order by c.ordre desc, c.id) as rn,
          case when c.couleur = 'k' then (case when c.valeur = 'joker' then 'Joker' else 'Joker +4' end)
               else (case c.couleur when 'r' then 'Rouge' when 'y' then 'Jaune' when 'g' then 'Vert' else 'Bleu' end)
                    || ' ' || (case c.valeur when 'inv' then 'Inversion' when 'passe' then 'Passe' else c.valeur end)
          end as lbl,
          case c.couleur when 'r' then 'rouge' when 'b' then 'bleu' when 'g' then 'vert' when 'y' then 'jaune' else 'noir' end as ton
          from hg_uno_cartes c
         where c.partie = v_id and c.lieu = 'main' and c.user_id = r.user_id
      ) x;
    v_sections := v_sections || jsonb_build_array(jsonb_build_object('titre', r.pseudo,
      'lignes', coalesce(v_lignes, jsonb_build_array(jsonb_build_object('label', 'Main', 'valeur', 'vide')))));
  end loop;

  -- Pioche : nombre de cartes et les 5 prochaines
  select jsonb_agg(jsonb_build_object('label', 'Suivante ' || x.rn, 'valeur', x.lbl, 'ton', x.ton) order by x.rn)
    into v_lignes
    from (
      select row_number() over (order by c.ordre desc, c.id) as rn,
        case when c.couleur = 'k' then (case when c.valeur = 'joker' then 'Joker' else 'Joker +4' end)
             else (case c.couleur when 'r' then 'Rouge' when 'y' then 'Jaune' when 'g' then 'Vert' else 'Bleu' end)
                  || ' ' || (case c.valeur when 'inv' then 'Inversion' when 'passe' then 'Passe' else c.valeur end)
        end as lbl,
        case c.couleur when 'r' then 'rouge' when 'b' then 'bleu' when 'g' then 'vert' when 'y' then 'jaune' else 'noir' end as ton
        from hg_uno_cartes c
       where c.partie = v_id and c.lieu = 'pioche'
       order by c.ordre desc, c.id
       limit 5
    ) x;
  v_lignes := jsonb_build_array(jsonb_build_object('label', 'Cartes restantes', 'valeur',
      (select count(*)::text from hg_uno_cartes where partie = v_id and lieu = 'pioche')))
    || coalesce(v_lignes, '[]'::jsonb);
  v_sections := v_sections || jsonb_build_array(jsonb_build_object('titre', 'Pioche', 'lignes', v_lignes));

  return jsonb_build_object('titre', v_titre, 'note', null, 'sections', v_sections);
end $$;
revoke all on function public.hg_adrep_uno(text) from public, anon, authenticated;
