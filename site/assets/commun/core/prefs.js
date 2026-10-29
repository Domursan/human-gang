// Préférences d'affichage : modification (setPrefs) et panneau <dialog> « Préférences d'affichage ».
/*
 * Rôle : applique une modification de préférence (thème, mode, effets, son) à l'écran tout de suite,
 * et fournit le panneau « Préférences d'affichage » ouvert depuis l'en-tête ou le pied de page.
 * Page : toutes les pages (bouton dans header.js et footer.js).
 * Dépendances : prefs-state.js (lecture et écriture), theme.js (repeindre le thème), effects.js (calque d'effets),
 * util.js (reducedMotion), sound.js (sons de test), icons.js.
 * Événement émis : window « hg:prefs » (détail = préférences) après chaque changement.
 * Exporte : setPrefs, openPrefs.
 */
import { getPrefs, writePrefs, PREF_DEFAULTS } from './prefs-state.js';
import { paintSiteTheme, paintActiveTheme, getActiveTheme } from './theme.js';
import { startEffects } from './effects.js';
import { reducedMotion } from './util.js';
import { playSound, playTurnSound } from '../sound.js';
import { ICON_CLOSE } from './icons.js';

/* ---------- Application d'une modification ---------- */

/**
 * Modifie et enregistre les préférences, puis les applique immédiatement. Renvoie les nouvelles préférences.
 * Seul ce qui a changé est repeint : thème spécial, mode, ou effets.
 * @param {object} [patch={}] Champs à changer.
 * @returns {object} Préférences après la modification.
 */
export function setPrefs(patch = {}) {
  const before = writePrefs(patch);
  const after = getPrefs();
  // Un seul repaint : si plusieurs champs changent, le thème spécial est prioritaire, puis le mode, puis les effets
  if (before.special !== after.special) paintSiteTheme();
  else if (before.mode !== after.mode) paintActiveTheme();
  else if (before.effects !== after.effects) startEffects(getActiveTheme());
  syncPrefsDialog();
  try { window.dispatchEvent(new CustomEvent('hg:prefs', { detail: getPrefs() })); } catch {}
  return getPrefs();
}
/* ---------- Panneau « Préférences d'affichage » (<dialog>) ---------- */

/**
 * Vrai sur un écran seulement tactile (pas de souris ni de clavier attendu) : la ligne « Raccourcis clavier » y est cachée.
 * @returns {boolean}
 */
const touchOnly = () => { try { return matchMedia('(hover: none) and (pointer: coarse)').matches; } catch { return false; } };

/** Dialogue des préférences, créé à la première ouverture. */
let _prefsDialog = null;
/** Élément qui avait le focus avant l'ouverture : on lui rend le focus à la fermeture. */
let _prefsOpener = null;
/**
 * Construit le dialogue : modes, thème spécial, effets, révélation des boosters, raccourcis, sons, volume, réinitialisation.
 * Chaque changement s'applique tout de suite (pas de bouton « Enregistrer »).
 * @returns {HTMLDialogElement} Le dialogue, déjà ajouté au document.
 */
function buildPrefsDialog() {
  const d = document.createElement('dialog');
  d.className = 'prefs-dialog';
  d.setAttribute('aria-labelledby', 'prefs-title');
  const modes = [
    ['sombre', 'Sombre', 'Par défaut'],
    ['clair', 'Clair', 'Fond clair, texte foncé'],
    ['daltonien', 'Daltonien', 'Bleu / orange, contrastes renforcés'],
  ];
  d.innerHTML = `<form method="dialog" class="prefs-form">
      <div class="prefs-head">
        <h2 id="prefs-title" class="display">Préférences</h2>
        <button class="prefs-close" type="submit" value="close" aria-label="Fermer les préférences">${ICON_CLOSE}</button>
      </div>
      <p class="muted small prefs-note">Enregistrées sur cet appareil seulement.</p>
      <fieldset class="prefs-modes">
        <legend>Mode d'affichage</legend>
        <div class="prefs-mode-grid">
          ${modes.map(([v, l, s]) => `<label class="mode-opt">
            <input type="radio" name="mode" value="${v}">
            <span class="mode-swatch sw-${v}" aria-hidden="true"><i></i><i></i><i></i></span>
            <span class="mode-txt"><strong>${l}</strong><small>${s}</small></span>
          </label>`).join('')}
        </div>
      </fieldset>
      <div class="prefs-switches">
        <label class="switch-row">
          <span class="switch-txt"><strong>Thème spécial</strong><small>Thèmes de saison (Noël, Halloween…). Coupé : toujours le thème Classique.</small></span>
          <input class="pref-switch" type="checkbox" role="switch" name="special">
        </label>
        <label class="switch-row">
          <span class="switch-txt"><strong>Effets visuels</strong><small class="fx-note">Animations décoratives : étoiles, neige, confettis…</small></span>
          <input class="pref-switch" type="checkbox" role="switch" name="effects">
        </label>
        <label class="switch-row">
          <span class="switch-txt"><strong>Sons</strong><small>Petits sons discrets : clics, confirmations, messages, badges.</small></span>
          <input class="pref-switch" type="checkbox" role="switch" name="sound">
        </label>
        <label class="switch-row">
          <span class="switch-txt"><strong>Sons des jeux</strong><small>Dans les jeux à plusieurs : le son « à toi de jouer » et les sons des coups (même si les autres sons sont coupés).</small></span>
          <input class="pref-switch" type="checkbox" role="switch" name="sonTour">
        </label>
        <label class="switch-row">
          <span class="switch-txt"><strong>Révéler mes boosters d’un coup</strong><small>Sans la séquence animée : toutes les cartes s’affichent tout de suite.</small></span>
          <input class="pref-switch" type="checkbox" role="switch" name="revealDirect">
        </label>
        <label class="switch-row prefs-shortcuts-row"${touchOnly() ? ' hidden' : ''}>
          <span class="switch-txt"><strong>Raccourcis clavier</strong><small>« g » puis une lettre pour changer de page, « / » pour chercher, « ? » pour l’aide-mémoire.</small></span>
          <input class="pref-switch" type="checkbox" role="switch" name="shortcuts">
        </label>
        <div class="volume-row">
          <label for="prefs-volume">Volume</label>
          <input id="prefs-volume" type="range" name="volume" min="0" max="100" step="5">
          <output for="prefs-volume" class="volume-out">60 %</output>
          <button class="btn btn-ghost prefs-test" type="button">Tester</button>
        </div>
      </div>
      <div class="btn-row prefs-actions">
        <button class="btn btn-ghost prefs-reset" type="button">Réinitialiser</button>
        <button class="btn btn-primary" type="submit" value="close">Terminé</button>
      </div>
    </form>`;
  const f = d.querySelector('form');
  // Délégation : un seul écouteur pour les modes et les interrupteurs
  f.addEventListener('change', (e) => {
    const el = e.target;
    if (el.name === 'mode') {
      setPrefs({ mode: el.value });
      // quête « thème changé » : import dynamique, pour ne pas charger le client Supabase avant le thème
      import('../quest-track.js').then((m) => m.questTrack('theme_change', el.value)).catch(() => {});
    }
    else if (['special', 'effects', 'revealDirect', 'shortcuts'].includes(el.name)) setPrefs({ [el.name]: el.checked });
    else if (el.name === 'sound') { setPrefs({ sound: el.checked }); if (el.checked) playSound('success'); }
    else if (el.name === 'sonTour') { setPrefs({ sonTour: el.checked }); if (el.checked) playTurnSound(); }
  });
  const vol = f.elements.volume;
  vol.addEventListener('input', () => { setPrefs({ volume: Number(vol.value) / 100 }); }); // le son suit le curseur en direct
  vol.addEventListener('change', () => playSound('click')); // un petit clic confirme le volume choisi
  f.querySelector('.prefs-test').addEventListener('click', () => playSound('badge'));
  f.querySelector('.prefs-reset').addEventListener('click', () => { setPrefs({ ...PREF_DEFAULTS }); });
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); // clic sur le fond
  d.addEventListener('close', () => { _prefsOpener?.focus?.(); _prefsOpener = null; });
  document.body.append(d);
  return d;
}
/**
 * Recopie les préférences dans les champs du dialogue (utile si elles ont changé ailleurs).
 * Le volume et le test sont grisés quand les sons sont coupés. La description des effets suit
 * la préférence « réduire les animations » du système.
 */
function syncPrefsDialog() {
  const d = _prefsDialog;
  if (!d) return;
  const p = getPrefs();
  const f = d.querySelector('form');
  for (const r of f.querySelectorAll('input[name="mode"]')) r.checked = r.value === p.mode;
  f.elements.special.checked = p.special;
  f.elements.effects.checked = p.effects;
  f.elements.sound.checked = p.sound;
  f.elements.revealDirect.checked = p.revealDirect;
  f.elements.shortcuts.checked = p.shortcuts;
  f.elements.sonTour.checked = p.sonTour;
  f.elements.volume.value = String(Math.round(p.volume * 100));
  f.elements.volume.disabled = !p.sound;
  f.querySelector('.prefs-test').disabled = !p.sound;
  f.querySelector('.volume-out').textContent = `${Math.round(p.volume * 100)} %`;
  f.querySelector('.volume-row').classList.toggle('is-off', !p.sound);
  f.querySelector('.fx-note').textContent = reducedMotion()
    ? 'Ton appareil demande de réduire les animations : elles restent coupées.'
    : 'Animations décoratives : étoiles, neige, confettis…';
}
/**
 * Ouvre le panneau des préférences d'affichage.
 * @param {Event|null} [e] Événement du clic : son bouton reçoit le focus à la fermeture.
 */
export function openPrefs(e) {
  _prefsDialog ||= buildPrefsDialog();
  _prefsOpener = e?.currentTarget || document.activeElement;
  syncPrefsDialog();
  if (!_prefsDialog.open) _prefsDialog.showModal();
  _prefsDialog.querySelector('input[name="mode"]:checked')?.focus();
}
