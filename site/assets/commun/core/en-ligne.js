// ===== Humane Gang — menu « En ligne » (à droite du site, migration 159) =====
/*
 * Rôle : montre les membres connectés en ce moment, avec deux raccourcis pour chacun : « Écrire » (/pages/compte/messages.html?to=<id>)
 *   et « Défier » (/pages/jeux/duels.html#creer/membre/<id>).
 *   Ordinateur (à partir de 720 px) : barre verticale à droite, sous l'en-tête (son haut suit --en-tete-bas, posé par init.js),
 *   avatars avec pastille verte ; le pseudo sort en bulle au survol ; un clic ouvre une petite fenêtre avec les deux raccourcis
 *   (Échap ou clic ailleurs la ferme). Le contenu de la page est décalé de la largeur de la barre (html[data-en-ligne] body).
 *   Personne en ligne : la barre se replie en bouton (classe is-vide), qui ouvre la liste vide comme sur téléphone.
 *   Téléphone : bouton flottant en bas à droite (nombre de membres en ligne) ; il ouvre la liste avec les raccourcis.
 * Données : RPC hg_membres_en_ligne() (les autres membres, statut non masqué), relue toutes les 60 s quand la page est visible.
 * Pas affiché sur /pages/admin/admin.html, ni en vue « comme un membre », ni (sur téléphone) pendant une partie.
 * Page : toutes (init.js appelle startEnLigne avec le profil connecté).
 * Dépendances : supabase.js (sb), util.js (esc, avatarHtml), pages-access.js (page courante), view-as.js.
 * Exporte : startEnLigne.
 */
import { sb } from './supabase.js';
import { esc, avatarHtml } from './util.js';
import { currentPageSlug } from './pages-access.js';
import { viewAsActive } from './view-as.js';

/** Rafraîchissement de la liste (ms). */
const RAFRAICHIR_MS = 60000;
/** Feuille de style du module. */
const CSS_HREF = new URL('../en-ligne.css', import.meta.url).href;
/** Pages de partie : pas de bouton flottant sur téléphone (il recouvrirait les actions du jeu). */
const PAGES_PARTIE = new Set(['blackjack', 'catan', 'cluedo', 'destins', 'duels', 'loup-garou', 'monopoly', 'nom-de-code', 'pictionary', 'poker', 'quiz', 'risk', 'shadow-hunters', 'uno', 'simulateur']);

/** Pictogrammes (traits, couleur du texte). */
const PICTO = {
  msg: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  epee: '<path d="M14.5 17.5L3 6V3h3l11.5 11.5"/><path d="M13 19l6-6"/><path d="M16 16l4 4"/><path d="M19 21l2-2"/>',
  gens: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14a6.5 6.5 0 0 1 3.5 6"/>',
};
/** @param {string} nom @returns {string} SVG décoratif */
const ico = (nom) => `<svg class="ol-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${PICTO[nom] || ''}</svg>`;

/** Liens des deux raccourcis pour un membre. */
const lienEcrire = (id) => `/pages/compte/messages.html?to=${encodeURIComponent(id)}`;
const lienDefier = (id) => `/pages/jeux/duels.html#creer/membre/${encodeURIComponent(id)}`;

/** Ajoute la feuille de style une seule fois. */
function chargerCss() {
  if (document.querySelector('link[data-en-ligne]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = CSS_HREF; l.dataset.enLigne = '';
  document.head.append(l);
}

/**
 * Lance le menu « En ligne ». Ne lève jamais d'erreur vers la page.
 * @param {object|null} profil membre connecté (null : rien)
 */
export function startEnLigne(profil) {
  if (!profil || currentPageSlug() === 'admin' || viewAsActive() || document.getElementById('en-ligne')) return;
  chargerCss();
  if (PAGES_PARTIE.has(currentPageSlug())) document.documentElement.dataset.olPartie = '';

  const aside = document.createElement('aside');
  aside.id = 'en-ligne';
  aside.className = 'ol';
  aside.setAttribute('aria-label', 'Membres en ligne');
  aside.innerHTML = `
    <button type="button" class="ol-fab" aria-expanded="false" aria-controls="ol-corps">${ico('gens')}<span class="ol-fab-n">0</span><span class="ol-sr">membres en ligne : afficher la liste</span></button>
    <div class="ol-corps" id="ol-corps">
      <p class="ol-tete"><span class="ol-point" aria-hidden="true"></span><span class="ol-tete-t">En ligne</span> <span class="ol-n">0</span></p>
      <ul class="ol-liste"></ul>
      <p class="ol-vide">Personne d’autre pour l’instant</p>
    </div>`;
  const pop = document.createElement('div');
  pop.className = 'ol-pop';
  pop.id = 'ol-pop';
  pop.hidden = true;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Raccourcis');
  document.body.append(aside, pop);
  document.documentElement.dataset.enLigne = '';

  const liste = aside.querySelector('.ol-liste');
  const fab = aside.querySelector('.ol-fab');
  let membres = [];
  let ouvertPour = null;

  /** Ferme la petite fenêtre des raccourcis (et rend le focus à l'avatar si demandé). */
  const fermerPop = (rendreFocus = false) => {
    if (pop.hidden) return;
    pop.hidden = true;
    const b = liste.querySelector(`[data-ol="${CSS.escape(ouvertPour || '')}"]`);
    b?.setAttribute('aria-expanded', 'false');
    if (rendreFocus) b?.focus();
    ouvertPour = null;
  };

  /** Ouvre la fenêtre des raccourcis à gauche de l'avatar cliqué (ordinateur). */
  const ouvrirPop = (btn) => {
    const m = membres.find((x) => x.user_id === btn.dataset.ol);
    if (!m) return;
    if (ouvertPour === m.user_id) { fermerPop(); return; }
    fermerPop();
    ouvertPour = m.user_id;
    pop.innerHTML = `<p class="ol-pop-nom">${avatarHtml(m, 28)}<span>${esc(m.pseudo || 'Membre')}</span></p>
      <a class="ol-act" href="${lienEcrire(m.user_id)}">${ico('msg')}Écrire</a>
      <a class="ol-act" href="${lienDefier(m.user_id)}">${ico('epee')}Défier à un jeu</a>`;
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    const r = btn.getBoundingClientRect();
    const h = pop.offsetHeight;
    pop.style.top = `${Math.max(8, Math.min(window.innerHeight - h - 8, r.top + r.height / 2 - h / 2))}px`;
    pop.style.right = `${window.innerWidth - r.left + 10}px`;
    pop.querySelector('a')?.focus();
  };

  /** Redessine la liste à partir des membres chargés. */
  const peindre = () => {
    const n = membres.length;
    aside.querySelector('.ol-n').textContent = String(n);
    fab.querySelector('.ol-fab-n').textContent = String(n);
    fab.querySelector('.ol-sr').textContent = `${n} membre${n > 1 ? 's' : ''} en ligne : afficher la liste`;
    aside.classList.toggle('is-vide', !n);
    liste.innerHTML = membres.map((m) => `<li>
        <button type="button" class="ol-av" data-ol="${esc(m.user_id)}" aria-haspopup="dialog" aria-expanded="false" aria-label="${esc(m.pseudo || 'Membre')} : raccourcis">${avatarHtml(m, 36)}<span class="ol-dot" aria-hidden="true"></span><span class="ol-nom" aria-hidden="true">${esc(m.pseudo || 'Membre')}</span></button>
        <span class="ol-acts-tel"><a class="ol-act" href="${lienEcrire(m.user_id)}" aria-label="Écrire à ${esc(m.pseudo || 'Membre')}">${ico('msg')}<span>Écrire</span></a><a class="ol-act" href="${lienDefier(m.user_id)}" aria-label="Défier ${esc(m.pseudo || 'Membre')}">${ico('epee')}<span>Défier</span></a></span>
      </li>`).join('');
    if (ouvertPour && !membres.some((m) => m.user_id === ouvertPour)) fermerPop();
  };

  /** Relit la liste des membres en ligne. */
  const charger = async () => {
    if (document.hidden) return;
    try {
      const { data, error } = await sb.rpc('hg_membres_en_ligne');
      if (error) throw error;
      membres = Array.isArray(data) ? data : [];
      peindre();
    } catch (e) { console.warn('[en ligne]', e?.message || e); }
  };

  liste.addEventListener('click', (e) => {
    const b = e.target.closest('.ol-av');
    if (b && window.matchMedia('(min-width: 720px)').matches) ouvrirPop(b);
  });
  // Bulle du pseudo (fixe, la liste peut défiler) : alignée sur l'avatar survolé
  liste.addEventListener('pointerover', (e) => {
    const b = e.target.closest('.ol-av');
    const nom = b?.querySelector('.ol-nom');
    if (!nom || !window.matchMedia('(min-width: 720px)').matches) return;
    const r = b.getBoundingClientRect();
    nom.style.top = `${r.top + r.height / 2}px`;
  });
  fab.addEventListener('click', () => {
    const ouvert = aside.dataset.open === '1';
    aside.dataset.open = ouvert ? '0' : '1';
    fab.setAttribute('aria-expanded', String(!ouvert));
  });
  document.addEventListener('click', (e) => {
    const chemin = e.composedPath();
    if (!pop.hidden && !chemin.includes(pop) && !chemin.some((x) => x?.classList?.contains?.('ol-av'))) fermerPop();
    if (aside.dataset.open === '1' && !chemin.includes(aside)) { aside.dataset.open = '0'; fab.setAttribute('aria-expanded', 'false'); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!pop.hidden) { fermerPop(true); return; }
    if (aside.dataset.open === '1') { aside.dataset.open = '0'; fab.setAttribute('aria-expanded', 'false'); fab.focus(); }
  });
  window.addEventListener('resize', () => fermerPop());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) charger(); });

  peindre();
  charger();
  setInterval(charger, RAFRAICHIR_MS);
}
