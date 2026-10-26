-- ===== Humane Gang — migration 124 : Qui est-ce ?, plateau « Les habitants du quartier » =====
-- Le site n'a aucun lien avec un jeu de rôle : le plateau « paleto » devient « quartier » (mêmes 24 personnages).
-- Met à jour les données, les duels déjà créés, et les deux fonctions qui citaient l'ancien nom (valeur par défaut).
update public.hg_duel_qec_persos set plateau = 'quartier' where plateau = 'paleto';
update public.hg_duel_parties set variante = 'quartier' where jeu = 'quiestce' and variante = 'paleto';

do $$
declare f text; d text;
begin
  foreach f in array array['public.hg_duel_creer(jsonb)', 'public.hg_duel_plateau(text)'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position('''paleto''' in d) > 0 then
      execute replace(d, '''paleto''', '''quartier''');
    end if;
  end loop;
end $$;
