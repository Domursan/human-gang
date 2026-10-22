// =====================================================================
// Affiches A3 : chiffres et listes lus sur le site (prix, gains, taux, critères des badges, quêtes, badges).
// Une affiche déclare sa page avec <body data-affiche="badges | paillettes | cartes | boosters">.
// Les chiffres sont des éléments data-cfg (valeur d'un réglage), data-expr (calcul) ou data-cfg-calc
// (calcul de la page) : voir assets/js/reglages-jetons.js. Le texte écrit dans la page est le repli :
// il reste affiché si un réglage est illisible (par exemple sans session, les affiches sont imprimées connecté).
// Les badges viennent de hg_badges (noms, images, niveaux, critères) ; sans lecture, BADGES_REPLI est affiché.
// Les quêtes viennent de hg_card_quests_templates ; sans lecture, la liste écrite dans la page reste.
// Dépendances : core/supabase.js (sb), reglages-jetons.js (valeurs et mise en forme), badge-levels.js (niveaux).
// Ne fait rien d'autre que remplir la page : la mise en page A3 est celle du HTML (impression inchangée).
// =====================================================================
import { sb } from '../assets/js/core/supabase.js';
import { chargerReglages, appliquerReglages, jetons, fmt } from '../assets/js/reglages-jetons.js';
import { sortedLevels, hasLevels, levelImage, metricCount } from '../assets/js/badge-levels.js';

/* ---------- Badges : regroupement, textes et liste de repli ---------- */
// Sections de l'affiche, dans l'ordre. Un badge absent de ces listes va dans la section « Événements » (fin de page).
const SECTIONS = [
  { titre: 'Secret Santa', codes: ['premier_noel', 'veteran', 'lutin_express', 'sur_le_fil', 'liste_parfaite'] },
  { titre: 'Sorties IRL', codes: ['toujours_la', 'organisateur', 'globe_trotter'] },
  { titre: 'Fidélité', codes: ['fondateur', 'fidele', 'saisonnier', 'anciennete'] },
  { titre: 'Communauté', codes: ['cupidon', 'paparazzi', 'boite_a_idees', 'chasseur_bugs'] },
];
// Texte de chaque badge sur l'affiche, avec les critères réglables (jetons). Un badge sans modèle garde sa description de la base.
const MODELES = {
  premier_noel: 'A participé à un Secret Santa terminé.',
  veteran: 'A participé à {{badges.criteres.veteran_editions|5}} Secret Santa.',
  lutin_express: 'A envoyé son cadeau en premier.',
  sur_le_fil: 'A envoyé son cadeau le dernier jour.',
  liste_parfaite: 'Un souhait dans sa liste avant le tirage.',
  toujours_la: 'Présent à {{badges.criteres.toujours_la_sorties|5}} sorties passées (RSVP « oui »).',
  organisateur: 'A créé une sortie.',
  globe_trotter: 'Sorties passées dans {{badges.criteres.globe_trotter_lieux|3}} lieux différents.',
  fondateur: 'Arrivé dès la première année du gang.',
  fidele: '{{badges.criteres.fidele_annees|3}} ans dans le gang, depuis la date d’arrivée.',
  saisonnier: 'Connecté pendant les {{badges.criteres.saisonnier_themes|7}} thèmes du site.',
  cupidon: 'Un membre a rejoint avec son code d’invitation.',
  paparazzi: '{{badges.criteres.paparazzi_photos|50}} photos ajoutées aux albums.',
  boite_a_idees: 'Une de ses idées retenue par l’admin.',
  chasseur_bugs: 'Un bug signalé via l’assistance, traité.',
};
// Liste de repli (sans lecture de hg_badges) : les 17 badges tels qu'ils étaient écrits dans l'affiche.
const IMG = (f) => `https://zqbdzokyhgavgmqgiwuw.supabase.co/storage/v1/object/public/hg-assets/badges/${f}`;
const BADGES_REPLI = [
  { code: 'premier_noel', name: 'Premier Noël', image_url: IMG('premier_noel.png?v=1792524833665') },
  { code: 'veteran', name: 'Vétéran', image_url: IMG('veteran.png?v=1792524838448') },
  { code: 'lutin_express', name: 'Lutin express', image_url: IMG('lutin_express.png?v=1792524869344') },
  { code: 'sur_le_fil', name: 'Sur le fil', image_url: IMG('sur_le_fil.png?v=1792524930375') },
  { code: 'liste_parfaite', name: 'Liste parfaite', image_url: IMG('liste_parfaite.png?v=1792524990655') },
  { code: 'toujours_la', name: 'Toujours là', image_url: IMG('toujours_la.png?v=1792525011471') },
  { code: 'organisateur', name: 'Organisateur', image_url: IMG('organisateur.png?v=1792525054543') },
  { code: 'globe_trotter', name: 'Globe-trotter', image_url: IMG('globe_trotter.png?v=1792525100426') },
  { code: 'fondateur', name: 'Membre fondateur', image_url: IMG('fondateur.png?v=1792525710316') },
  { code: 'fidele', name: 'Fidèle', image_url: IMG('fidele.png?v=1792525260919') },
  { code: 'saisonnier', name: 'Saisonnier', image_url: IMG('saisonnier.png?v=1792525336189') },
  {
    code: 'anciennete', name: 'Ancienneté', levels_enabled: true, metric: 'anciennete_annees',
    levels: [
      { level: 1, threshold: 1, name: 'Bronze', image_url: IMG('fondateur-n1.png?v=1792525710889') },
      { level: 2, threshold: 2, name: 'Argent', image_url: IMG('fondateur-n2.png?v=1792525711177') },
      { level: 3, threshold: 5, name: 'Or', image_url: IMG('fondateur-n3.png?v=1792525711382') },
      { level: 4, threshold: 10, name: 'Platine', image_url: IMG('fondateur-n4.png?v=1792525711802') },
      { level: 5, threshold: 20, name: 'Diamant', image_url: IMG('fondateur-n5.png?v=1792525712341') },
    ],
  },
  { code: 'cupidon', name: 'Cupidon du gang', image_url: IMG('cupidon.png?v=1792525404565') },
  { code: 'paparazzi', name: 'Paparazzi', image_url: IMG('paparazzi.png?v=1792525140417') },
  { code: 'boite_a_idees', name: 'Boîte à idées', image_url: IMG('boite_a_idees.png?v=1792525184828') },
  { code: 'chasseur_bugs', name: 'Chasseur de bugs', image_url: IMG('chasseur_bugs.png?v=1792525293492') },
  { code: 'it_s_halloween_time', name: 'It\'s Halloween Time !', description: 'A attrapé It\'s Halloween Time ! pendant l\'événement.', image_url: null },
];

/* ---------- Outils de construction (DOM, sans HTML venant de la base) ---------- */
/** Crée un élément avec sa classe et son texte (textContent : rien n'est interprété comme du HTML). */
const el = (tag, cls = '', texte) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (texte !== undefined) n.textContent = texte;
  return n;
};

/** Description affichée d'un badge : le modèle de l'affiche (critères réglables), sinon la description de la base. */
const descriptionDe = (b) => (MODELES[b.code] ? jetons(MODELES[b.code]) : (b.description || ''));

/** Carte d'un badge simple (sans niveaux). */
function carte(b, evenement) {
  const card = el('div', evenement ? 'card hot' : 'card');
  const ico = el('div', 'ico');
  if (b.image_url) {
    const img = el('img');
    img.src = b.image_url;
    img.alt = '';
    ico.append(img);
  } else {
    ico.setAttribute('aria-hidden', 'true');
    ico.textContent = '🏅';
  }
  const txt = el('div');
  txt.append(el('h3', '', b.name), el('p', '', descriptionDe(b)));
  card.append(ico, txt);
  return card;
}

/** Bloc d'un badge à niveaux (Ancienneté) : pastilles des niveaux, avec leur seuil lu sur la base. */
function blocNiveaux(b) {
  const niveaux = sortedLevels(b);
  const bloc = el('div', 'anc');
  const head = el('div', 'anc-head');
  head.append(el('h3', '', b.name), el('p', '', `${niveaux.length} niveaux, calculés sur les années passées dans le gang depuis la date d’arrivée.`));
  const grille = el('div', 'levels');
  for (const n of niveaux) {
    const lvl = el('div', 'lvl');
    const img = el('img');
    img.src = levelImage(b, n.level) || '';
    img.alt = '';
    lvl.append(img, el('b', '', n.name || `Niveau ${n.level}`), el('span', '', metricCount(b.metric, n.threshold)));
    grille.append(lvl);
  }
  bloc.append(head, grille);
  return bloc;
}

/** Une section de l'affiche : titre, nombre, cartes et blocs de niveaux. */
function section(titre, badges, tagDefaut) {
  const simples = badges.filter((b) => !hasLevels(b));
  const niveaux = badges.filter((b) => hasLevels(b));
  const evenement = titre === 'Événements';
  const sec = el('section');
  const t = el('div', 'sec-title');
  const suite = niveaux.map((b) => ` + ${b.name}`).join('');
  t.append(el('h2', '', titre), el('span', 'tag', tagDefaut ?? `${simples.length} badge${simples.length > 1 ? 's' : ''}${suite}`));
  sec.append(t);
  if (simples.length) {
    const grille = el('div', simples.length === 5 ? 'grid five' : simples.length <= 3 ? 'grid three' : 'grid');
    grille.append(...simples.map((b) => carte(b, evenement)));
    sec.append(grille);
  }
  for (const b of niveaux) sec.append(blocNiveaux(b));
  return sec;
}

/* ---------- Lectures sur la base (chacune se replie sans bruit) ---------- */
/** Badges de hg_badges (membres seulement). Liste vide si la lecture échoue. */
async function lireBadges() {
  try {
    const { data, error } = await sb.from('hg_badges').select('code, name, description, image_url, sort, levels_enabled, metric, levels').order('sort');
    if (error) throw error;
    return (data ?? []).filter((b) => b && b.code && b.name);
  } catch (e) {
    console.warn('[affiches] badges illisibles, liste de repli :', e?.message || e);
    return [];
  }
}

/** Quêtes actives de la semaine (hg_card_quests_templates). Liste vide si la lecture échoue. */
async function lireQuetes() {
  try {
    const { data, error } = await sb.from('hg_card_quests_templates').select('code, label, reward, active, sort').eq('active', true).order('sort');
    if (error) throw error;
    return (data ?? []).filter((q) => q && q.label && Number.isFinite(Number(q.reward)));
  } catch (e) {
    console.warn('[affiches] quêtes illisibles, liste écrite dans la page :', e?.message || e);
    return [];
  }
}

/* ---------- Remplissage par page ---------- */
/** Page des badges : sections construites depuis hg_badges, puis nombre total. */
async function afficherBadges() {
  const lus = await lireBadges();
  const badges = lus.length ? lus : BADGES_REPLI;
  const reste = [...badges];
  const sectionsBox = document.getElementById('sections');
  const blocs = SECTIONS.map((s) => {
    const membres = s.codes.map((c) => reste.find((b) => b.code === c)).filter(Boolean);
    membres.forEach((b) => reste.splice(reste.indexOf(b), 1));
    return membres.length ? section(s.titre, membres) : null;
  }).filter(Boolean);
  if (reste.length) blocs.push(section('Événements', reste, 'Limité'));
  sectionsBox.replaceChildren(...blocs);
  const nb = document.getElementById('nb-badges');
  if (nb) nb.textContent = String(badges.length);
}

/** Page Paillettes : liste des quêtes lue sur la base, si elle répond. */
function afficherQuetes(quetes) {
  const liste = document.getElementById('quetes');
  if (!liste || !quetes.length) return;
  liste.replaceChildren(...quetes.map((q) => {
    const d = el('div');
    d.append(el('div', 'q', q.label), el('div', 'v', `${fmt(q.reward)} ✦`));
    return d;
  }));
}

/* ---------- Démarrage ---------- */
const page = document.body.dataset.affiche;
await chargerReglages();
let quetes = [];
if (page === 'badges') await afficherBadges();
if (page === 'paillettes') {
  quetes = await lireQuetes();
  afficherQuetes(quetes);
}
// Calculs propres à une page, pour les éléments data-cfg-calc.
appliquerReglages(document, {
  // Nombre de quêtes actives (sinon le nombre écrit dans la page).
  quetes: () => quetes.length || undefined,
});
