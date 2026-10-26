-- ===== Humane Gang — migration 148 : grilles du jour, deux correctifs =====
-- Anagramme : « passer » le premier mot de la journée s'enregistre (l'objet etat.mots est créé s'il manque).
-- Mots croisés : « Vérifier » ne signale que les cases remplies et fausses, et ne compte une erreur que s'il y en a.
select public.hg__patch('public.hg_nj_grille_essai(text, jsonb)'::regprocedure,
  $o$    if coalesce((p->>'passer')::boolean, false) then
      pa.etat := jsonb_set(pa.etat, array['mots', i::text], to_jsonb('passe'::text), true);$o$,
  $n$    if pa.etat->'mots' is null then pa.etat := jsonb_set(pa.etat, '{mots}', '{}'::jsonb); end if;
    if coalesce((p->>'passer')::boolean, false) then
      pa.etat := jsonb_set(pa.etat, array['mots', i::text], to_jsonb('passe'::text), true);$n$);
select public.hg__patch('public.hg_nj_grille_essai(text, jsonb)'::regprocedure,
  $o$and (coalesce((p->>'verifier')::boolean, false) or substr(lu, q, 1) <> ' ')), '[]'::jsonb);$o$,
  $n$and substr(lu, q, 1) <> ' '), '[]'::jsonb);$n$);
select public.hg__patch('public.hg_nj_grille_essai(text, jsonb)'::regprocedure,
  $o$      if coalesce((p->>'verifier')::boolean, false) then pa.erreurs := pa.erreurs + 1; end if;$o$,
  $n$      if coalesce((p->>'verifier')::boolean, false) and jsonb_array_length(faux) > 0 then pa.erreurs := pa.erreurs + 1; end if;$n$);
