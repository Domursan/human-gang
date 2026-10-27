// ===== Humane Gang — le carnet des secrets (/pages/jeux/secret.html) =====
// Page cachée, hors du menu : compte les secrets trouvés, liste ceux-ci avec leur date, et compte les autres sans les nommer.
// Ouvrir la page est en soi un secret (« console ») : eggFound('console') part avant la lecture du carnet.
// Visiteur sans compte : seulement un message pour se connecter (rien n'est lu ni enregistré).
// Les quatre champignons (saisons) forment une seule case « La cueillette » ; le total vient de hg_eggs_me.
// Dépendances : core.js (initPage, esc, fmtDate, hasSession), eggs/api.js (eggFound, eggsMe). N'exporte rien.
import { initPage, esc, fmtDate, hasSession } from '../../commun/core.js';
import { eggFound, eggsMe } from './api.js';

/* ---------- Constantes ---------- */

/** Nom poétique de chaque secret (code envoyé par le site -> libellé du carnet). */
const NOMS = {
  konami: 'Le code des anciens',
  logo: 'Le clic obstiné',
  humane: "L'arc-en-ciel discret",
  jeu404: 'Le perdu de la page 404',
  heure_gang: "L'heure du gang",
  anniversaire: 'La part de gâteau',
  console: "Le chercheur d'indices",
  lettres: 'Les sept lettres cachées',
  secousse: 'La secousse',
  nuit: 'La chouette insomniaque',
  rembobine: 'Le retour en arrière',
  tzatziki: 'Le pays imaginaire',
  champis: 'La cueillette',
  livre: 'Le livre est mieux',
  kc: 'Le supporter',
  creeper: 'Le démineur',
  serge: 'Le maître du jeu',
  domumobile: 'La voiture du gang',
};

/* ---------- Affichage ---------- */

/** Éléments de la page. */
const $bilan = document.getElementById('secret-bilan');
const $section = document.getElementById('secret-liste-section');
const $trouves = document.getElementById('secret-trouves');
const $titreCaches = document.getElementById('secret-titre-caches');
const $caches = document.getElementById('secret-caches');

/**
 * Affiche le message du visiteur sans compte : pas de carnet, seulement l'invitation à se connecter.
 */
function rendVisiteur() {
  $bilan.innerHTML = `<p>Connecte-toi pour garder la trace de tes trouvailles.</p>
    <p><a class="btn btn-light" href="/pages/compte/compte.html">Me connecter</a></p>`;
}

/**
 * Affiche le bilan (nombre de secrets trouvés, lettres cachées), les secrets trouvés et les cases « ??? » des autres.
 * @param {{found: number, total: number, eggs: {egg: string, first: string}[], letters: number}} etat réponse de hg_eggs_me
 */
function rendCarnet(etat) {
  // Total donné par le serveur (hg_eggs_me) : jamais écrit en dur ici
  const total = Math.max(0, Number(etat.total) || 0);
  const trouves = Math.min(Number(etat.found) || 0, total);
  const lettres = Math.min(Number(etat.letters) || 0, 7);
  const saisons = Math.min(Number(etat.champis) || 0, 4);
  const pct = total ? Math.round((trouves / total) * 100) : 0;
  $bilan.innerHTML = `<p><strong>${trouves}</strong> secret${trouves > 1 ? 's' : ''} trouvé${trouves > 1 ? 's' : ''} sur ${total}</p>
    <div class="egg-barre" role="img" aria-label="${pct} % des secrets trouvés"><span style="width:${pct}%"></span></div>
    <p class="egg-carnet-chiffres"><span>Lettres cachées : ${lettres} sur 7</span><span>Cueillette : ${saisons} saisons sur 4</span></p>`;

  // Secrets trouvés, du plus ancien au plus récent (les lettres et les saisons de cueillette sont comptées plus haut, pas une à une)
  const liste = (etat.eggs || [])
    .filter((s) => !/^(lettre_|champi_)/.test(s.egg))
    .sort((a, b) => String(a.first).localeCompare(String(b.first)));
  $trouves.innerHTML = liste.map((s) => `<li class="egg-case">
      <strong>${esc(NOMS[s.egg] || 'Un secret mystérieux')}</strong>
      <span class="small muted">${esc(fmtDate(s.first))}</span>
    </li>`).join('');

  // Les autres : des cases « ??? », sans nom ni indice
  const restants = Math.max(0, total - trouves);
  $caches.innerHTML = Array.from({ length: restants }, () => '<li class="egg-case inconnue">???</li>').join('');
  $titreCaches.hidden = restants === 0;
  $caches.hidden = restants === 0;
  $section.hidden = false;
}

/* ---------- Initialisation : session facultative (les visiteurs voient le message de connexion) ---------- */

await initPage({ auth: 'optional' });
const connecte = await hasSession();
if (!connecte) {
  rendVisiteur();
} else {
  await eggFound('console');
  const etat = await eggsMe();
  if (etat) rendCarnet(etat);
  else $bilan.innerHTML = '<p>Le carnet est indisponible pour le moment. Reviens plus tard.</p>';
}
