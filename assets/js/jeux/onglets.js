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
 *   couleur facultatif : couleur de l'icône dans le tableau de bord (variable CSS ou hexadécimal).
 * Contrat d'un module :
 *   export async function mount(panel, ctx)  panel = <section role="tabpanel"> vide, ctx = { sb, me, toast, esc } ;
 *   export function unmount()                facultatif, appelé quand on quitte la page ;
 *   export async function resume(ctx)        facultatif, pour l'onglet « Aujourd'hui » : { etat: 'fait' | 'a_jouer' |
 *     'en_cours' | 'info', texte, badge, gain?, serie? } (texte = sous-titre, badge = pastille, gain = Paillettes
 *     gagnées aujourd'hui, serie = jours consécutifs). Sans resume, le jeu apparaît avec « Ouvrir ».
 * Le panneau reçoit l'événement « jeux:show » chaque fois qu'il redevient visible (carte à redimensionner…).
 * Exporte : ONGLETS.
 */
export const ONGLETS = [
  { id: 'geo', titre: 'GeoGuessr', module: './geo.js', idee: 'J1', rythme: 'jour', couleur: 'var(--sage)',
    icone: '<circle cx="12" cy="10" r="3"/><path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z"/>' },
  { id: 'jdj', titre: 'Jeux du jour', module: './jdj.js', idee: 'J2', rythme: 'jour', couleur: 'var(--sage-text)',
    icone: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>' },
  { id: 'citations', titre: 'Qui a dit ça ?', module: './citations.js', idee: 'J3', rythme: 'jour', couleur: 'var(--slate)',
    icone: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>' },
];
