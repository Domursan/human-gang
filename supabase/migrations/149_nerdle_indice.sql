-- ===== Humane Gang — migration 149 : Nerdle du gang, indice à la demande =====
-- hg_nj_grille_essai('nerdle', { indice: true }) révèle une case du calcul pas encore trouvée en vert (au hasard),
-- 3 indices au plus par jour. Les indices sont gardés dans etat.indices [{ pos (0 à 7), ch }] et ne coûtent pas d'essai,
-- mais chacun retire 1 point au score du jour (minimum 1 point si le calcul est trouvé). Réponse : { indice: { pos, ch } }.
select public.hg__patch('public.hg_nj_grille_essai(text, jsonb)'::regprocedure,
  $o$  elsif p_jeu = 'nerdle' then
    sol := g.secret->>'calcul';
    mot := replace(replace(btrim(p->>'calcul'), '×', '*'), '÷', '/');
    if not hg_nj__nerdle_ok(mot) then raise exception 'Ce n''est pas un calcul juste de 8 caractères.'; end if;
    ess := coalesce(pa.etat->'essais', '[]'::jsonb);
    pa.etat := jsonb_set(pa.etat, '{essais}', ess || jsonb_build_array(jsonb_build_object('calcul', mot, 'couleurs', hg_nj__couleurs(mot, sol))));
    res := jsonb_build_object('ok', mot = sol, 'couleurs', hg_nj__couleurs(mot, sol));
    n := jsonb_array_length(pa.etat->'essais');
    if mot = sol then pa.fini := true; pa.gagne := true; pa.score := 7 - n;
    elsif n >= 6 then pa.fini := true; pa.score := 0; end if;$o$,
  $n$  elsif p_jeu = 'nerdle' then
    sol := g.secret->>'calcul';
    if coalesce((p->>'indice')::boolean, false) then
      if jsonb_array_length(coalesce(pa.etat->'indices', '[]'::jsonb)) >= 3 then raise exception 'Tu as déjà pris les 3 indices du jour.'; end if;
      select q into k from generate_series(1, 8) q
        where not exists (select 1 from jsonb_array_elements(coalesce(pa.etat->'indices', '[]'::jsonb)) x where (x->>'pos')::int = q - 1)
          and not exists (select 1 from jsonb_array_elements(coalesce(pa.etat->'essais', '[]'::jsonb)) e where substr(e->>'calcul', q, 1) = substr(sol, q, 1))
        order by random() limit 1;
      if k is null then raise exception 'Toutes les cases sont déjà trouvées.'; end if;
      pa.etat := jsonb_set(pa.etat, '{indices}', coalesce(pa.etat->'indices', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('pos', k - 1, 'ch', substr(sol, k, 1))));
      res := jsonb_build_object('indice', jsonb_build_object('pos', k - 1, 'ch', substr(sol, k, 1)));
    else
      mot := replace(replace(btrim(p->>'calcul'), '×', '*'), '÷', '/');
      if not hg_nj__nerdle_ok(mot) then raise exception 'Ce n''est pas un calcul juste de 8 caractères.'; end if;
      ess := coalesce(pa.etat->'essais', '[]'::jsonb);
      pa.etat := jsonb_set(pa.etat, '{essais}', ess || jsonb_build_array(jsonb_build_object('calcul', mot, 'couleurs', hg_nj__couleurs(mot, sol))));
      res := jsonb_build_object('ok', mot = sol, 'couleurs', hg_nj__couleurs(mot, sol));
      n := jsonb_array_length(pa.etat->'essais');
      if mot = sol then pa.fini := true; pa.gagne := true; pa.score := greatest(1, 7 - n - jsonb_array_length(coalesce(pa.etat->'indices', '[]'::jsonb)));
      elsif n >= 6 then pa.fini := true; pa.score := 0; end if;
    end if;$n$);
