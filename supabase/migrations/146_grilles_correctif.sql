-- ===== Humane Gang — migration 146 : correctif des mots croisés (nom de colonne ambigu dans hg_nj_grille_essai) =====
select public.hg__patch('public.hg_nj_grille_essai(text, jsonb)'::regprocedure,
  $o$faux := coalesce((select jsonb_agg(k - 1) from generate_series(1, char_length(sol)) k
      where substr(sol, k, 1) <> '.' and substr(lu, k, 1) <> substr(sol, k, 1) and (coalesce((p->>'verifier')::boolean, false) or substr(lu, k, 1) <> ' ')), '[]'::jsonb);$o$,
  $n$faux := coalesce((select jsonb_agg(q - 1) from generate_series(1, char_length(sol)) q
      where substr(sol, q, 1) <> '.' and substr(lu, q, 1) <> substr(sol, q, 1) and (coalesce((p->>'verifier')::boolean, false) or substr(lu, q, 1) <> ' ')), '[]'::jsonb);$n$);
