-- ===== Humane Gang — migration 134 : réponses des duels pour les administrateurs =====
-- Fonctions appelées par hg_admin_reponses (migration 133) : codejour, mastermind, bataille, quiestce.
-- Puissance 4 et Morpion n'ont rien de caché : pas de fonction.
-- Lecture seule. Pas de contrôle admin ici (le point d'entrée le fait) ; droits retirés, comme les autres hg_adrep_*.

-- Couleurs du Mastermind (lettres r o y g b p) → texte lisible : « Rouge (R) · Orange (O) · … »
create or replace function public.hg_adrep__couleurs(p_code text)
returns text language sql immutable as $$
  select case when p_code is null then null else (
    select string_agg(
      case c when 'r' then 'Rouge' when 'o' then 'Orange' when 'y' then 'Jaune'
             when 'g' then 'Vert' when 'b' then 'Bleu' when 'p' then 'Violet' else '?' end
      || ' (' || upper(c) || ')', ' · ' order by i)
    from unnest(string_to_array(p_code, null)) with ordinality as t(c, i)) end
$$;

-- Pseudo d'un joueur (hg_profiles, à défaut le pseudo enregistré dans le duel).
create or replace function public.hg_adrep__nom(p_partie uuid, p_user uuid)
returns text language sql stable set search_path = public as $$
  select coalesce(
    (select pr.pseudo from hg_profiles pr where pr.id = p_user),
    (select j.pseudo from hg_duel_joueurs j where j.partie = p_partie and j.user_id = p_user),
    '?')
$$;

-- Code du jour (Mastermind solo). Lecture seule : si le code n'a pas encore été tiré, on le dit.
create or replace function public.hg_adrep_codejour(p_ref text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare d date := hg_duel__aujourdhui(); v text;
begin
  select h.secret into v from hg_duel_jour h where h.jour = d;
  if v is null then
    return jsonb_build_object('titre', 'Code du jour : réponses',
      'note', 'Le code du jour n''a pas encore été tiré : personne ne l''a ouvert aujourd''hui.',
      'sections', '[]'::jsonb);
  end if;
  return jsonb_build_object('titre', 'Code du jour : réponses',
    'note', 'Jour : ' || to_char(d, 'DD.MM.YYYY'),
    'sections', jsonb_build_array(jsonb_build_object('titre', 'Code secret', 'lignes', jsonb_build_array(
      jsonb_build_object('label', 'Couleurs', 'valeur', hg_adrep__couleurs(v))))));
end $$;

-- Mastermind : code à percer par chaque joueur, dans la manche en cours de la partie p_ref.
create or replace function public.hg_adrep_mastermind(p_ref text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare p hg_duel_parties; j record; v text; lignes jsonb := '[]'::jsonb;
begin
  if p_ref is null or p_ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('titre', 'Mastermind : réponses',
      'note', 'Aucune partie sélectionnée : ouvre un duel Mastermind pour voir ses codes.', 'sections', '[]'::jsonb);
  end if;
  select * into p from hg_duel_parties where id = p_ref::uuid;
  if not found or p.jeu <> 'mastermind' then
    return jsonb_build_object('titre', 'Mastermind : réponses', 'note', 'Cette partie n''est pas un Mastermind.', 'sections', '[]'::jsonb);
  end if;
  if p.manche = 0 then
    return jsonb_build_object('titre', 'Mastermind : réponses', 'note', 'La première manche n''a pas encore commencé.', 'sections', '[]'::jsonb);
  end if;
  for j in select jo.user_id from hg_duel_joueurs jo where jo.partie = p.id order by jo.place loop
    select cd.secret into v from hg_duel_codes cd where cd.partie = p.id and cd.manche = p.manche and cd.pour = j.user_id;
    lignes := lignes || jsonb_build_array(jsonb_build_object(
      'label', 'Code à percer par ' || hg_adrep__nom(p.id, j.user_id),
      'valeur', coalesce(hg_adrep__couleurs(v), 'pas encore choisi')));
  end loop;
  return jsonb_build_object('titre', 'Mastermind : réponses',
    'note', 'Duel ' || p.code || ' · manche ' || p.manche,
    'sections', jsonb_build_array(jsonb_build_object('titre', 'Codes de la manche ' || p.manche, 'lignes', lignes)));
end $$;

-- Bataille navale : flotte de chaque joueur dans la manche en cours (grille 10×10, ■ navire, · eau) et liste des navires.
create or replace function public.hg_adrep_bataille(p_ref text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  p hg_duel_parties; j record; s record; v_cases int[]; v_grille jsonb; v_ligne jsonb; v_lignes jsonb;
  rr int; cc int; v_secs jsonb := '[]'::jsonb;
begin
  if p_ref is null or p_ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('titre', 'Bataille navale : réponses',
      'note', 'Aucune partie sélectionnée : ouvre un duel de Bataille navale pour voir les flottes.', 'sections', '[]'::jsonb);
  end if;
  select * into p from hg_duel_parties where id = p_ref::uuid;
  if not found or p.jeu <> 'bataille' then
    return jsonb_build_object('titre', 'Bataille navale : réponses', 'note', 'Cette partie n''est pas une Bataille navale.', 'sections', '[]'::jsonb);
  end if;
  if p.manche = 0 then
    return jsonb_build_object('titre', 'Bataille navale : réponses', 'note', 'La première manche n''a pas encore commencé.', 'sections', '[]'::jsonb);
  end if;
  for j in select jo.user_id from hg_duel_joueurs jo where jo.partie = p.id order by jo.place loop
    select coalesce(array_agg(x), '{}'::int[]) into v_cases
      from hg_duel_navires nv, unnest(nv.cases) x
      where nv.partie = p.id and nv.manche = p.manche and nv.user_id = j.user_id;

    if coalesce(array_length(v_cases, 1), 0) = 0 then
      v_secs := v_secs || jsonb_build_array(jsonb_build_object('titre', hg_adrep__nom(p.id, j.user_id),
        'lignes', jsonb_build_array(jsonb_build_object('label', 'Flotte', 'valeur', 'pas encore placée'))));
    else
      -- En-tête des colonnes (A à J), puis une ligne par rangée (1 à 10).
      v_grille := jsonb_build_array(to_jsonb(array[''] || array['A','B','C','D','E','F','G','H','I','J']::text[]));
      for rr in 0 .. 9 loop
        v_ligne := jsonb_build_array((rr + 1)::text);
        for cc in 0 .. 9 loop
          v_ligne := v_ligne || jsonb_build_array(case when (rr * 10 + cc) = any(v_cases) then '■' else '·' end);
        end loop;
        v_grille := v_grille || jsonb_build_array(v_ligne);
      end loop;

      v_lignes := '[]'::jsonb;
      for s in select f.nom, nav.cases, nav.coule
          from hg_duel_navires nav join hg_duel__bn_flotte() f on f.type = nav.type
          where nav.partie = p.id and nav.manche = p.manche and nav.user_id = j.user_id
          order by f.longueur desc loop
        v_lignes := v_lignes || jsonb_build_array(jsonb_build_object(
          'label', s.nom,
          'valeur', (select string_agg(chr(65 + x % 10) || (x / 10 + 1)::text, ' ' order by x) from unnest(s.cases) x)
                    || case when s.coule then ' (coulé)' else '' end));
      end loop;

      v_secs := v_secs || jsonb_build_array(jsonb_build_object('titre', hg_adrep__nom(p.id, j.user_id),
        'lignes', v_lignes, 'grille', v_grille));
    end if;
  end loop;

  return jsonb_build_object('titre', 'Bataille navale : réponses',
    'note', 'Duel ' || p.code || ' · manche ' || p.manche,
    'sections', v_secs);
end $$;

-- Qui est-ce ? : personnage secret de chaque joueur dans la manche en cours de la partie p_ref.
create or replace function public.hg_adrep_quiestce(p_ref text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare p hg_duel_parties; j record; v_perso int; v_nom text; lignes jsonb := '[]'::jsonb;
begin
  if p_ref is null or p_ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('titre', 'Qui est-ce ? : réponses',
      'note', 'Aucune partie sélectionnée : ouvre un duel Qui est-ce ? pour voir les personnages.', 'sections', '[]'::jsonb);
  end if;
  select * into p from hg_duel_parties where id = p_ref::uuid;
  if not found or p.jeu <> 'quiestce' then
    return jsonb_build_object('titre', 'Qui est-ce ? : réponses', 'note', 'Cette partie n''est pas une partie de Qui est-ce ?.', 'sections', '[]'::jsonb);
  end if;
  if p.manche = 0 then
    return jsonb_build_object('titre', 'Qui est-ce ? : réponses', 'note', 'La première manche n''a pas encore commencé.', 'sections', '[]'::jsonb);
  end if;
  for j in select jo.user_id from hg_duel_joueurs jo where jo.partie = p.id order by jo.place loop
    select sc.perso into v_perso from hg_duel_qec_secrets sc
      where sc.partie = p.id and sc.manche = p.manche and sc.user_id = j.user_id;
    select q.prenom into v_nom from hg_duel_qec_persos q where q.plateau = p.variante and q.id = v_perso;
    lignes := lignes || jsonb_build_array(jsonb_build_object(
      'label', hg_adrep__nom(p.id, j.user_id),
      'valeur', coalesce(v_nom, 'pas encore tiré')));
  end loop;
  return jsonb_build_object('titre', 'Qui est-ce ? : réponses',
    'note', 'Duel ' || p.code || ' · manche ' || p.manche,
    'sections', jsonb_build_array(jsonb_build_object('titre', 'Personnage secret de chacun', 'lignes', lignes)));
end $$;

revoke all on function public.hg_adrep__couleurs(text) from public, anon, authenticated;
revoke all on function public.hg_adrep__nom(uuid, uuid) from public, anon, authenticated;
revoke all on function public.hg_adrep_codejour(text) from public, anon, authenticated;
revoke all on function public.hg_adrep_mastermind(text) from public, anon, authenticated;
revoke all on function public.hg_adrep_bataille(text) from public, anon, authenticated;
revoke all on function public.hg_adrep_quiestce(text) from public, anon, authenticated;
