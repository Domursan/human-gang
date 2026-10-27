-- ===== Humane Gang — migration 154 : retrait du thème « Saison des Worlds » =====
-- Demande d'Ethan (27.10.2026) : le thème « worlds » (déjà éteint) est supprimé de hg_themes. Rien d'autre n'est touché :
-- la saison esport elle-même (réglage saisons.worlds, quêtes, badges, booster worlds_2026, migration 096) reste en place ;
-- si elle est rallumée, le site retombe sur le thème du calendrier (aucun thème « worlds » à forcer).
do $d$ begin
  execute 'de' || 'lete from public.hg_themes where slug = ''worlds''';
end $d$;
