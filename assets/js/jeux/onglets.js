// ===== Humane Gang — onglets de la page Jeux (jeux.html) =====
// Une ligne par onglet, triées par numéro d'idée. Chaque paquet ajoute SES lignes ; le coordinateur les réunit à la fusion.
// Champs : id (ancre jeux.html#<id>, lettres minuscules), titre (libellé de l'onglet), module (chemin relatif à ce dossier,
// qui exporte mount(panel, ctx) et éventuellement unmount()), idee (numéro de l'idée du catalogue).
// Exporte : ONGLETS.
export const ONGLETS = [
  { id: 'jour', titre: 'Question du jour', module: './jour.js', idee: 'J4' },
  { id: 'pronos', titre: 'Pronostics', module: './pronos.js', idee: 'J5' },
  { id: 'sutom', titre: 'Sutom', module: './sutom.js', idee: 'J8' },
];
