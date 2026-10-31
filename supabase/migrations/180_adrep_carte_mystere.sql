-- ===== Humane Gang — migration 180 : réponse de la Carte mystère dans le bouton « Réponses » des admins =====
-- hg_nj__contenu ne donne pas de « libelle » pour la Carte mystère (seulement « reponse », le nom de la carte) : la ligne
-- « Réponse » de hg_adrep_nj restait vide pour ce jeu. Elle prend maintenant « reponse » quand « libelle » manque.
-- Aucune donnée modifiée. Rejouable (le texte d'origine n'est plus là au second passage : on ne remplace que s'il y est).

do $do$
begin
  if pg_get_functiondef('public.hg_adrep_nj(text)'::regprocedure) like $l$%'valeur', k->>'libelle', 'ton', 'ok'%$l$ then
    perform public.hg__patch('public.hg_adrep_nj(text)'::regprocedure,
      $o$'valeur', k->>'libelle', 'ton', 'ok'$o$,
      $n$'valeur', coalesce(k->>'libelle', k->>'reponse'), 'ton', 'ok'$n$);
  end if;
end $do$;
