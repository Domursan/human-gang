// ===== Humane Gang — liste des onglets de la page « Jeux » (jeux.html) =====
/*
 * Rôle : déclare les jeux affichés en onglets, dans l'ordre (trié par numéro d'idée du catalogue).
 * Une ligne par onglet :
 *   id      adresse jeux.html#<id> (minuscules, chiffres, tirets ; « aujourdhui » est réservé au tableau de bord) ;
 *   titre   libellé de l'onglet ;
 *   module  chemin relatif à ce dossier, chargé à la première ouverture ;
 *   idee    référence du catalogue ;
 *   rythme  facultatif : 'jour' (Chaque jour, défaut), 'semaine' (Chaque semaine) ou 'competition' (Compétition) ;
 *   icone   facultatif : contenu SVG (viewBox 0 0 24 24, trait) de l'icône ;
 *   couleur facultatif : couleur de l'icône dans le tableau de bord (variable CSS ou hexadécimal) ;
 *   admin   facultatif : true = jeu en développement, onglet visible des seuls admins (le serveur le vérifie aussi).
 * Contrat d'un module :
 *   export async function mount(panel, ctx)  panel = <section role="tabpanel"> vide, ctx = { sb, me, toast, esc, sub } (sub : choix
 *     tiré de l'adresse, jeux.html#<id>-<choix>, ou null) ; un changement de choix alors que le module est monté arrive par « jeux:sub » ;
 *   export function unmount()                facultatif, appelé quand on quitte la page ;
 *   export async function resume(ctx)        facultatif, pour le tableau de bord « Les missions du jour » : { etat: 'fait' | 'a_jouer' |
 *     'en_cours' | 'info', texte, badge, gain?, serie? } (texte = sous-titre, badge = pastille, gain = Paillettes
 *     gagnées aujourd'hui, serie = jours consécutifs). Sans resume, le jeu apparaît avec « Ouvrir ».
 * Le panneau reçoit l'événement « jeux:show » chaque fois qu'il redevient visible (carte à redimensionner…).
 * Exporte : ONGLETS.
 */
export const ONGLETS = [
  { id: 'geo', titre: 'GeoGuessr', module: './geo.js', idee: 'J1', rythme: 'jour', couleur: 'var(--sage)',
    icone: '<circle cx="12" cy="10" r="3"/><path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z"/>' },
  { id: 'citations', titre: 'Qui a dit ça ?', module: './citations.js', idee: 'J3', rythme: 'jour', couleur: 'var(--slate)',
    icone: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>' },
  { id: 'jour', titre: 'Question du jour', module: './jour.js', idee: 'J4', rythme: 'jour' },
  { id: 'sutom', titre: 'Sutom HG', module: './sutom.js', idee: 'J8', rythme: 'jour' },
  { id: 'framed', titre: 'Framed', module: './framed.js', idee: 'J9', rythme: 'jour' },
  { id: 'heardle', titre: 'Heardle', module: './heardle.js', idee: 'J10', rythme: 'jour' },
  { id: 'arcade', titre: 'Arcade', module: './arcade.js', idee: 'J18', rythme: 'jour' },
  // Nouveaux jeux en développement (admins seulement) : jeux du jour « devine en 6 essais » (moteur nj-devine.js)
  { id: 'carte-mystere', titre: 'Carte mystère', module: './nj-carte.js', idee: 'N1', rythme: 'jour', admin: true, couleur: 'var(--plum)',
    icone: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M10 9.5a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.2V13M12 16.5v.01"/>' },
  { id: 'jeu-video', titre: 'Jeu vidéo du jour', module: './nj-jv.js', idee: 'N2', rythme: 'jour', admin: true, couleur: 'var(--slate)',
    icone: '<rect x="2" y="7" width="20" height="10" rx="4"/><path d="M7 10v4M5 12h4M15 11h.01M18 13h.01"/>' },
  { id: 'pochette', titre: 'Pochette du jour', module: './nj-pochette.js', idee: 'N3', rythme: 'jour', admin: true, couleur: 'var(--rose)',
    icone: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".5"/>' },
  { id: 'replique', titre: 'Réplique du jour', module: './nj-replique.js', idee: 'N4', rythme: 'jour', admin: true, couleur: 'var(--sand)',
    icone: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h1M12 9h1M8 12h5"/>' },
  { id: 'pays', titre: 'Pays du jour', module: './nj-pays.js', idee: 'N5', rythme: 'jour', admin: true, couleur: 'var(--sage)',
    icone: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>' },
  { id: 'plat', titre: 'Plat du jour', module: './nj-plat.js', idee: 'N6', rythme: 'jour', admin: true, couleur: 'var(--amber)',
    icone: '<path d="M3 13h18a9 9 0 0 1-18 0z"/><path d="M8 9c0-2 2-2 2-4M13 9c0-2 2-2 2-4"/>' },
  // Jeux solo (classement de la semaine)
  { id: 'demineur', titre: 'Démineur', module: './nj-demineur.js', idee: 'N7', rythme: 'competition', admin: true, couleur: 'var(--rust)',
    icone: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>' },
  { id: 'sudoku', titre: 'Sudoku du jour', module: './nj-sudoku.js', idee: 'N8', rythme: 'jour', admin: true, couleur: 'var(--slate)',
    icone: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>' },
  { id: '2048', titre: '2048 Paillettes', module: './nj-2048.js', idee: 'N9', rythme: 'competition', admin: true, couleur: 'var(--sand)',
    icone: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>' },
];
