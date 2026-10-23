// ===== Humane Gang — page Jeux : liste des onglets =====
/*
 * Rôle : un onglet par jeu de la page jeux.html (contrat commun des paquets xJ1 à xJ4).
 * Chaque paquet ajoute SES lignes, triées par numéro d'idée ; le coordinateur réunit les lignes à la fusion.
 * Exporte : ONGLETS ({ id, titre, module, idee }) : module relatif à assets/js/jeux/, exportant mount(panel, ctx).
 */
export const ONGLETS = [
  { id: 'saison', titre: 'Saisons', module: './saison.js', idee: 'J16' },
  { id: 'qui-main', titre: 'Qui main ?', module: './qui-main.js', idee: 'J17' },
  { id: 'arcade', titre: 'Arcade', module: './arcade.js', idee: 'J18' },
  { id: 'soiree', titre: 'Soirée complète', module: './soiree.js', idee: 'J19' },
];
