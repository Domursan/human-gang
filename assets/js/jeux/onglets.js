// ===== Humane Gang — page « Jeux » : liste des onglets (JEUX-CONTRAT.md) =====
// Une ligne par onglet, triées par numéro d'idée. Chaque paquet ajoute SES lignes ; le coordinateur les réunit à la fusion.
// module : chemin relatif à assets/js/jeux/ ; le module exporte mount(panel, ctx) et, au besoin, unmount().
export const ONGLETS = [
  { id: 'framed', titre: 'Framed', module: './framed.js', idee: 'J9' },
  { id: 'heardle', titre: 'Heardle', module: './heardle.js', idee: 'J10' },
  { id: 'bataille', titre: 'Bataille', module: './bataille.js', idee: 'J15' },
];
