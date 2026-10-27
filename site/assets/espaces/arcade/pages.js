// ===== Humane Gang — secrets cachés des pages Cartes et Historique =====
/*
 * Rôle : deux secrets propres à une page, chargés à part (import dynamique en fin de cartes.js et historique.js).
 *  - Cartes : secouer le téléphone (code « secousse »). Sur iOS, un petit bouton 📳 demande d'abord la permission.
 *  - Historique : maintenir l'appui (600 ms) sur le dernier élément de la frise (code « rembobine ») : la page
 *    remonte en défilant, façon magnétoscope, puis le secret est signalé. Un clic simple garde le comportement normal.
 * Les effets respectent « réduire les animations » : sans mouvement, seul le secret est signalé.
 * Dépendances : eggs/api.js (eggFound, qui affiche le message du serveur), core.js (motionAllowed).
 * Exporte : secretsCartes(), secretsHistorique(). La feuille de style assets/css/eggs-pages.css est ajoutée ici.
 */
import { eggFound } from './api.js';
import { motionAllowed } from '../../commun/core.js';

/* ---------- Constantes ---------- */
const SEUIL_SECOUSSE = 25; // m/s² : la pesanteur seule donne environ 9,8 ; au-dessus, c'est un coup
const FENETRE_SECOUSSE_MS = 1000; // deux coups dans cette fenêtre comptent pour une secousse
const ANTIREBOND_MS = 120; // un même coup donne plusieurs mesures : elles ne comptent qu'une fois
const DELAI_SECOUSSE_MS = 3000; // après une secousse, pas de nouvelle avant ce délai
const APPUI_REMBOBINE_MS = 600; // appui long sur le dernier élément
const DUREE_REMBOBINE_MS = 2400; // durée de la remontée en haut de la frise
const DEPLACEMENT_MAX_PX = 12; // au-delà, l'appui devient un défilement : pas de rembobinage

/**
 * Ajoute la feuille de style des secrets à la page (une seule fois).
 */
function injecterCss() {
  if (document.querySelector('link[data-eggs]')) return;
  const lien = document.createElement('link');
  lien.rel = 'stylesheet';
  lien.href = new URL('./eggs-pages.css', import.meta.url).href;
  lien.dataset.eggs = '';
  document.head.append(lien);
}

/* ---------- Page Cartes : secousse ---------- */
/**
 * Active le secret « secousse » sur /pages/cartes/cartes.html : deux coups en moins d'1 s déclenchent l'effet (la page tremble
 * 0,6 s) puis signalent le secret au serveur. Sans capteur (ordinateur), rien ne s'affiche.
 * Sur iOS, la permission se demande depuis un geste : un bouton 📳 discret est proposé et disparaît après la réponse.
 */
export function secretsCartes() {
  if (typeof DeviceMotionEvent === 'undefined') return; // pas de capteur : rien à faire
  injecterCss();
  const app = document.querySelector('#app') || document.body;
  let coups = []; // instants des coups comptés dans la fenêtre
  let dernier = 0; // instant du dernier coup compté (antirebond)
  let attente = 0; // instant avant lequel une nouvelle secousse est ignorée

  /**
   * Compte les coups fortement accélérés (accélération avec pesanteur) et déclenche la secousse à deux coups.
   * @param {DeviceMotionEvent} ev mesure du capteur
   */
  const surMouvement = (ev) => {
    const a = ev.accelerationIncludingGravity;
    if (!a) return;
    const force = Math.hypot(a.x || 0, a.y || 0, a.z || 0);
    const t = Date.now();
    if (force < SEUIL_SECOUSSE || t - dernier < ANTIREBOND_MS) return;
    dernier = t;
    coups = coups.filter((c) => t - c < FENETRE_SECOUSSE_MS);
    coups.push(t);
    if (coups.length >= 2 && t >= attente) {
      coups = [];
      attente = t + DELAI_SECOUSSE_MS;
      secoue(app);
    }
  };

  const ecoute = () => window.addEventListener('devicemotion', surMouvement);

  if (typeof DeviceMotionEvent.requestPermission === 'function') {
    // iOS : la permission exige un geste. Bouton discret, sans fenêtre qui s'impose.
    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = 'egg-motion-btn';
    bouton.textContent = '📳';
    bouton.title = 'Autoriser le mouvement du téléphone';
    bouton.setAttribute('aria-label', 'Autoriser le mouvement du téléphone');
    bouton.addEventListener('click', async () => {
      try {
        if ((await DeviceMotionEvent.requestPermission()) === 'granted') ecoute();
      } catch { /* refus ou capteur indisponible : rien à montrer */ }
      bouton.remove();
    });
    document.body.append(bouton);
  } else {
    ecoute(); // Android et ordinateurs portables : pas de permission à demander
  }
}

/**
 * Joue l'effet de tremblement (si le mouvement est permis), puis signale la secousse au serveur.
 * Si le serveur vient d'offrir le booster, propose d'actualiser la page (pas de fonction publique pour
 * redessiner seulement la zone des boosters offerts).
 * @param {HTMLElement} app élément qui tremble
 */
function secoue(app) {
  if (motionAllowed()) {
    app.classList.remove('egg-shake');
    void app.offsetWidth; // relance l'animation si elle était déjà jouée
    app.classList.add('egg-shake');
    setTimeout(() => app.classList.remove('egg-shake'), 650);
  }
  eggFound('secousse').then((r) => { if (r?.new) afficherRelance(); });
}

/**
 * Affiche la proposition « Actualiser la page » pour voir le booster offert dans la zone des boosters offerts.
 */
function afficherRelance() {
  if (document.querySelector('.egg-relance')) return;
  const bloc = document.createElement('div');
  bloc.className = 'egg-relance';
  bloc.setAttribute('role', 'status');
  const texte = document.createElement('span');
  texte.textContent = 'Un booster offert t\'attend dans la zone « Boosters offerts ».';
  const bouton = document.createElement('button');
  bouton.type = 'button';
  bouton.className = 'btn btn-light btn-sm';
  bouton.textContent = 'Actualiser la page';
  bouton.addEventListener('click', () => location.reload());
  bloc.append(texte, bouton);
  document.body.append(bloc);
}

/* ---------- Page Historique : rembobinage ---------- */
/**
 * Active le secret « rembobine » sur /pages/irl/historique.html : un appui long (600 ms) sur le dernier élément de la frise
 * (le plus ancien, tout en bas) fait remonter la page en haut, façon magnétoscope, puis signale le secret.
 * L'appui long a été choisi plutôt que le double-clic : il ne double pas le clic des liens et des boutons de la carte.
 * Le menu contextuel est aussi bloqué pendant l'appui sur ce seul élément.
 */
export function secretsHistorique() {
  const frise = document.querySelector('#timeline');
  if (!frise) return;
  injecterCss();
  let minuteur = 0; // délai de l'appui long
  let enAppui = false; // un doigt ou une souris est posé sur le dernier élément
  let consomme = false; // l'appui long a déclenché l'effet : le clic qui suit ne doit rien faire
  let occupe = false; // un rembobinage est en cours
  let depart = null; // position de l'appui, pour détecter un défilement
  const dernierElement = () => { const els = frise.querySelectorAll('.tl-item'); return els[els.length - 1] || null; };
  const annule = () => { clearTimeout(minuteur); enAppui = false; };

  frise.addEventListener('pointerdown', (e) => {
    consomme = false;
    if (occupe || !e.isPrimary || e.target.closest('.tl-item') !== dernierElement()) return;
    enAppui = true;
    depart = { x: e.clientX, y: e.clientY };
    clearTimeout(minuteur);
    minuteur = setTimeout(() => { enAppui = false; consomme = true; rembobine(); }, APPUI_REMBOBINE_MS);
  });
  frise.addEventListener('pointermove', (e) => {
    if (depart && Math.hypot(e.clientX - depart.x, e.clientY - depart.y) > DEPLACEMENT_MAX_PX) annule();
  });
  for (const type of ['pointerup', 'pointerleave', 'pointercancel']) frise.addEventListener(type, annule);
  // Pendant l'appui sur le dernier élément, pas de menu contextuel (appui long du tactile).
  frise.addEventListener('contextmenu', (e) => { if (enAppui && e.target.closest('.tl-item') === dernierElement()) e.preventDefault(); });
  // Le clic qui suit un appui long ne doit pas ouvrir le lien ni le bouton de la carte.
  frise.addEventListener('click', (e) => {
    if (!consomme) return;
    consomme = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  /**
   * Lance la remontée en haut de la frise, puis signale le secret. Une action de l'utilisateur (molette, tactile,
   * clavier) interrompt la remontée sans empêcher le secret d'être signalé.
   */
  function rembobine() {
    if (occupe) return;
    occupe = true;
    if (!motionAllowed()) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      fini();
      return;
    }
    const vhs = document.createElement('div');
    vhs.className = 'egg-vhs';
    vhs.setAttribute('aria-hidden', 'true');
    vhs.innerHTML = '<div class="egg-vhs-bandes"></div><div class="egg-vhs-grain"></div>'
      + '<div class="egg-vhs-hud"><span class="egg-vhs-rew">◀◀ REWIND</span><span class="egg-vhs-cpt">00:00:02</span></div>';
    document.body.append(vhs);
    const cpt = vhs.querySelector('.egg-vhs-cpt');
    const y0 = window.scrollY;
    const t0 = performance.now();
    let interrompu = false;
    const stop = () => { interrompu = true; };
    for (const type of ['wheel', 'touchstart', 'keydown']) window.addEventListener(type, stop, { once: true, passive: true });

    /** Une image : avance linéaire (façon bobine), compteur qui descend. */
    const image = (now) => {
      if (interrompu) { vhs.remove(); fini(); return; } // l'utilisateur reprend la main : on reste où il est
      const k = Math.min(1, (now - t0) / DUREE_REMBOBINE_MS);
      window.scrollTo({ top: Math.round(y0 * (1 - k)), behavior: 'instant' });
      cpt.textContent = `00:00:${String(Math.ceil((1 - k) * DUREE_REMBOBINE_MS / 1000)).padStart(2, '0')}`;
      if (k < 1) requestAnimationFrame(image);
      else { vhs.remove(); fini(); }
    };
    requestAnimationFrame(image);
  }

  /** Fin du rembobinage : le secret est signalé (le serveur ne verse la récompense qu'une fois). */
  function fini() {
    occupe = false;
    eggFound('rembobine');
  }
}
