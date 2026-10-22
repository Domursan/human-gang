// ===== Cartes : carte agrandie (fenêtre plein écran), loupe ×2,5 et navigation =====
// Module autonome, en lecture seule : il n'écrit rien et ne rafraîchit pas la page.
// cartes.js lui fournit deux fonctions : ids() (cartes affichées, dans l'ordre affiché) et info(id) (fiche d'une carte).
// Ordinateur (pointeur fin) : loupe ronde ×2,5 qui suit le curseur. Tactile : appui long = loupe sous le doigt,
// le pincement reste le zoom natif de la page. Styles : assets/css/cartes-zoom.css.
import { esc } from './core.js';
import { cardHtml, rarityLabel, familyLabel, numberLabel } from './cartes-ui.js';

export const ICON_ZOOM = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/><path d="M10.5 7.8v5.4M7.8 10.5h5.4"/></svg>';

/* ---------- Constantes : taille et grossissement de la loupe, appui long, couleurs, icônes ---------- */
const LENS_D = 240; // diamètre de la loupe (px)
const LENS_K = 2.5; // grossissement
const PRESS_MS = 450; // durée de l'appui long tactile
const MOVE_TOL = 10; // déplacement toléré pendant l'appui long (px)
// Couleur d'accent de chaque rareté (utilisée pour le libellé de rareté dans la fiche ; exportée pour la console de cartes.js).
export const TINT ={ commune: '#c4c9d6', peu_commune: '#2fd17a', rare: '#4f80ff', epique: '#a674f5', legendaire: '#FCA301', mythique: '#FE3104', identite: '#FBD32D' };
const X_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const CHEV_L = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
const CHEV_R = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';

/* ---------- Gabarit de la fenêtre : entête, carte, fiche, barre de navigation et loupe (créé une seule fois) ---------- */
// Le gabarit est inséré dans la page au premier appel de createZoom().open(). Les boutons portent data-cz pour être reconnus par onClick.
const DIALOG = `
<dialog id="cz-dialog" class="cz-dialog" aria-labelledby="cz-title" aria-describedby="cz-hint">
  <div class="cz-stage">
    <header class="cz-top">
      <p class="cz-eyebrow" id="cz-eyebrow"></p>
      <button type="button" class="cz-icon cz-close" data-cz="close" aria-label="Fermer la carte">${X_ICON}</button>
    </header>
    <div class="cz-body">
      <div class="cz-main">
        <button type="button" class="cz-icon cz-nav" data-cz="prev" aria-label="Carte précédente">${CHEV_L}</button>
        <div class="cz-card" id="cz-card"></div>
        <button type="button" class="cz-icon cz-nav" data-cz="next" aria-label="Carte suivante">${CHEV_R}</button>
      </div>
      <div class="cz-info" id="cz-info" aria-live="polite"></div>
    </div>
    <nav class="cz-bar" aria-label="Naviguer entre les cartes">
      <button type="button" class="cz-bar-btn" data-cz="prev">&lsaquo; Précédent</button>
      <button type="button" class="cz-bar-btn" data-cz="next">Suivant &rsaquo;</button>
    </nav>
  </div>
  <div class="cz-lens" id="cz-lens" aria-hidden="true" hidden><div class="cz-lens-in"></div><span class="cz-lens-badge">×2,5</span><span class="cz-lens-dot"></span></div>
</dialog>`;

/* ---------- Pointeur : souris précise ou tactile ---------- */
/** Vrai sur un appareil dont le pointeur est une souris (survol possible), faux sur tactile. */
const isFine = () => matchMedia('(hover: hover) and (pointer: fine)').matches;

/** Texte d'aide : selon le pointeur (souris ou tactile). */
const hintText = () => (isFine() ? 'Survolez la carte pour zoomer ×2,5' : 'Pincer : zoom · appui long : loupe ×2,5');

/* ---------- Rendu de la fiche (colonne d'informations à droite de la carte) ---------- */
/** Bloc d'informations à droite de la carte (nom, rareté, série, numéro, ambiance, exemplaires). */
function infoHtml(d) {
  const k = d.card;
  const title = d.missing ? '???' : String(k.name ?? '');
  const num = d.missing ? '' : numberLabel({ ...k, set_total: d.setTotal });
  const meta = [familyLabel(k.family), d.setName, num ? `N° ${num}` : ''].filter(Boolean).join(' · ');
  const flavor = d.missing ? '' : k.flavor ? `<p class="cz-flavor"><em>« ${esc(k.flavor)} »</em></p>` : '';
  const caption = d.missing || !k.caption ? '' : `<p class="cz-cap">${esc(k.caption)}</p>`;
  const copies = d.missing || !d.lines.length
    ? '<p class="cz-empty">Pas encore obtenue.</p>'
    : `<ul class="cz-copies">${d.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`;
  return `<p class="cz-rar" style="--rc:${TINT[k.rarity] || TINT.identite}">${esc(rarityLabel(k.rarity))}</p>
    <h2 class="cz-title" id="cz-title">${esc(title)}</h2>
    <p class="cz-meta">${esc(meta)}</p>
    ${flavor}${caption}
    <h3 class="cz-sec">${esc(d.heading || 'Dans ta collection')}</h3>
    ${copies}
    <p class="cz-hint" id="cz-hint">${esc(hintText())}</p>`;
}

/**
 * Crée la fenêtre de carte agrandie.
 * @param {{ ids: () => string[], info: (id: string) => ({card, count, shiny, serial, missing, setName, setTotal, lines, kicker?, heading?} | null) }} src
 *   kicker / heading (facultatifs) : libellés de la fenêtre (par défaut « Collection » et « Dans ta collection »).
 * @returns {{ open: (id: string, opener?: HTMLElement) => void }}
 */
export function createZoom({ ids, info }) {
  let dlg = null;
  let ui = null;
  let list = [];
  let pos = -1;
  let cur = null;
  let opener = null;
  let lens = null; // { w, h, left, top, touch } quand la loupe est affichée
  let press = null; // { x, y, id, timer, on } pendant un appui tactile
  let press_timer = 0;

  /* ---------- Construction : insère le gabarit dans la page et branche les écouteurs (une seule fois) ---------- */
  /** Insère la fenêtre dans la page et relie ses événements (clics, clavier, pointeur, fermeture). */
  function build() {
    document.body.insertAdjacentHTML('beforeend', DIALOG);
    dlg = document.getElementById('cz-dialog');
    ui = {
      eyebrow: dlg.querySelector('#cz-eyebrow'),
      card: dlg.querySelector('#cz-card'),
      info: dlg.querySelector('#cz-info'),
      lens: dlg.querySelector('#cz-lens'),
      lensIn: dlg.querySelector('.cz-lens-in'),
      prevs: [...dlg.querySelectorAll('[data-cz=prev]')],
      nexts: [...dlg.querySelectorAll('[data-cz=next]')],
    };
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('keydown', onKey);
    dlg.addEventListener('close', onClose);
    dlg.addEventListener('cancel', hideLens);
    ui.card.addEventListener('pointerenter', onEnter);
    ui.card.addEventListener('pointermove', onMove);
    ui.card.addEventListener('pointerleave', onLeave);
    ui.card.addEventListener('pointerdown', onDown);
    ui.card.addEventListener('pointerup', onUp);
    ui.card.addEventListener('pointercancel', onUp);
    ui.card.addEventListener('contextmenu', (e) => e.preventDefault()); // pas de menu à l'appui long
  }

  /* ---------- Navigation entre les cartes ---------- */
  /** Affiche la carte d'indice donné dans la liste ; renvoie false si elle n'a pas de fiche. */
  function show(id) {
    const d = info(id);
    if (!d) return false;
    cur = id;
    pos = list.indexOf(id);
    hideLens();
    ui.card.innerHTML = cardHtml(d.card, { size: 'lg', count: d.count, shiny: d.shiny, serial: d.serial, missing: d.missing });
    ui.eyebrow.textContent = `${d.kicker || 'Collection'} · ${d.setName} · ${pos + 1} / ${list.length}`;
    ui.info.innerHTML = infoHtml(d);
    const many = list.length > 1;
    for (const b of [...ui.prevs, ...ui.nexts]) b.disabled = !many;
    return true;
  }

  /**
   * Passe à la carte suivante (delta 1) ou précédente (delta -1), en bouclant sur la liste.
   * @param {number} delta
   */
  function step(delta) {
    if (list.length < 2) return;
    const n = (pos + delta + list.length) % list.length; // boucle : après la dernière, la première
    show(list[n]);
  }

  /** Ouvre la fenêtre sur la carte donnée. opener : bouton qui a ouvert la fenêtre (le focus y revient). */
  function open(id, from = null) {
    if (!dlg) build();
    list = ids();
    if (!list.length) list = [id];
    opener = from;
    if (!show(id)) return;
    dlg.scrollTop = 0;
    if (!dlg.open) dlg.showModal();
  }

  /* ---------- Événements : clics, clavier, fermeture ---------- */
  /** Gère les clics : fond (ferme), boutons fermer, précédent, suivant. */
  function onClick(e) {
    // Un clic sur le fond (hors carte, infos et boutons) ferme la fenêtre
    if (e.target.matches?.('.cz-stage, .cz-body, .cz-main')) return dlg.close();
    const t = e.target.closest('[data-cz]');
    if (!t || t.disabled) return;
    if (t.dataset.cz === 'close') dlg.close();
    else if (t.dataset.cz === 'prev') step(-1);
    else if (t.dataset.cz === 'next') step(1);
  }

  /** Flèches gauche et droite : carte précédente et suivante. */
  function onKey(e) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  }

  /** À la fermeture : cache la loupe, annule l'appui long et rend le focus au bouton d'origine. */
  function onClose() {
    hideLens();
    cancelPress();
    // Le focus revient au bouton qui a ouvert la fenêtre (sans faire défiler la page)
    const back = opener?.isConnected ? opener : document.querySelector(`[data-action="zoom-card"][data-card="${CSS.escape(String(cur))}"]`);
    back?.focus({ preventScroll: true });
    opener = null;
  }

  /** Affiche la loupe au point (x, y) de l'écran. touch : appui long tactile (la loupe reste sous le doigt). */
  function showLens(x, y, touch) {
    const cardEl = ui.card.querySelector('.hgc');
    if (!cardEl) return;
    const r = cardEl.getBoundingClientRect();
    const clone = cardEl.cloneNode(true);
    clone.classList.add('cz-clone');
    clone.setAttribute('aria-hidden', 'true');
    clone.removeAttribute('aria-label');
    clone.style.width = `${r.width}px`;
    clone.style.height = `${r.height}px`;
    ui.lensIn.replaceChildren(clone);
    lens = { w: r.width, h: r.height, left: r.left, top: r.top, touch };
    ui.lens.hidden = false;
    moveLens(x, y);
  }

  /** Centre la loupe sur (x, y) et décale la copie grossie pour que le point visé soit au centre. */
  function moveLens(x, y) {
    if (!lens) return;
    ui.lens.style.left = `${x - LENS_D / 2}px`;
    ui.lens.style.top = `${y - LENS_D / 2}px`;
    const px = x - lens.left;
    const py = y - lens.top;
    const clone = ui.lensIn.firstElementChild;
    if (clone) clone.style.transform = `translate(${LENS_D / 2 - LENS_K * px}px, ${LENS_D / 2 - LENS_K * py}px) scale(${LENS_K})`;
  }

  /** Masque la loupe et vide sa copie de carte. */
  function hideLens() {
    lens = null;
    if (ui?.lens) { ui.lens.hidden = true; ui.lensIn.replaceChildren(); }
  }

  /** Annule le minuteur d'appui long en cours (s'il y en a un). */
  function cancelPress() {
    if (press_timer) clearTimeout(press_timer);
    press_timer = 0;
    press = null;
  }

  /* ---------- Pointeur : loupe au survol (souris) ou à l'appui long (tactile) ---------- */
  /** Souris : entrée sur la carte, la loupe s'affiche. */
  function onEnter(e) {
    if (e.pointerType !== 'touch' && isFine()) showLens(e.clientX, e.clientY, false);
  }

  /** Déplace la loupe avec le pointeur ; sur tactile, annule l'appui long si le doigt glisse. */
  function onMove(e) {
    if (!lens && !press && e.pointerType !== 'touch' && isFine()) showLens(e.clientX, e.clientY, false); // après une navigation au clavier
    if (lens && !lens.touch) moveLens(e.clientX, e.clientY);
    else if (press) {
      if (lens?.touch) moveLens(e.clientX, e.clientY);
      else if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > MOVE_TOL) cancelPress(); // glissement : c'est un geste de page
    }
  }

  /** Souris : sortie de la carte, la loupe se cache. */
  function onLeave() {
    if (lens && !lens.touch) hideLens();
  }

  /** Tactile : un appui démarre un minuteur ; s'il dure PRESS_MS, la loupe s'affiche sous le doigt. */
  function onDown(e) {
    if (e.pointerType !== 'touch') return;
    cancelPress();
    press = { x: e.clientX, y: e.clientY, id: e.pointerId };
    press_timer = setTimeout(() => {
      press_timer = 0;
      if (press) showLens(press.x, press.y, true);
    }, PRESS_MS);
  }

  /** Tactile : le doigt se lève, la loupe (si elle était ouverte) se referme. */
  function onUp(e) {
    if (e.pointerType !== 'touch') return;
    const was = lens?.touch;
    cancelPress();
    if (was) hideLens();
  }

  return { open };
}
