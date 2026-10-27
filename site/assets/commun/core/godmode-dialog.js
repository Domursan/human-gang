// ===== Humane Gang — dialogue d'activation du mode sans limite (chargé à l'ouverture) =====
/*
 * Rôle : le dialogue d'avertissement (durée, liste de ce qui est levé, phrase de confirmation) du mode sans limite.
 * Il n'est chargé que lorsqu'un administrateur ouvre le dialogue (godmode.js › openGodDialog), pas à chaque page.
 * Page : toutes les pages, pour un admin, à l'ouverture du dialogue (bouton de l'en-tête, carte de la page admin).
 * Dépendances : godmode.js (GOD_MINUTES, GOD_PHRASE, GOD_LIFTS, setGodMode), ui.js (toast), util.js (esc, errMsg),
 *   sound.js (son d'alerte), icons.js (ICON_ALERT).
 * Exporte : ouvreDialogue(ouvreur).
 */
import { toast } from './ui.js';
import { esc, errMsg } from './util.js';
import { playSound } from '../sound.js';
import { ICON_ALERT } from './icons.js';
import { GOD_MINUTES, GOD_PHRASE, GOD_LIFTS, setGodMode } from './godmode.js';

/** Dialogue d'activation, créé une seule fois à la première ouverture. */
let _godDialog = null;
/** Élément qui avait le focus avant l'ouverture : on lui rend le focus à la fermeture. */
let _godOpener = null;
/**
 * Normalise la phrase tapée (espaces multiples, casse) pour la comparer à GOD_PHRASE.
 * @param {string} s Texte saisi.
 * @returns {string} Texte en majuscules, espaces réduits.
 */
const normPhrase = (s) => String(s || '').trim().replace(/\s+/g, ' ').toUpperCase();
/**
 * Construit le dialogue d'activation : avertissement, liste de ce qui est levé, choix de la durée,
 * phrase de confirmation. Le bouton d'activation reste désactivé tant que la phrase est fausse.
 * @returns {HTMLDialogElement} Le dialogue, déjà ajouté au document.
 */
function buildGodDialog() {
  const d = document.createElement('dialog');
  d.className = 'god-dialog';
  d.setAttribute('aria-labelledby', 'god-title');
  d.setAttribute('aria-describedby', 'god-desc');
  d.innerHTML = `<form class="god-form" novalidate>
      <div class="god-dlg-head">
        <span class="god-dlg-ico">${ICON_ALERT}</span>
        <div>
          <p class="god-dlg-eyebrow">Zone dangereuse · admin</p>
          <h2 id="god-title" class="display">Activer le mode sans limite ?</h2>
        </div>
      </div>
      <p id="god-desc" class="god-desc">Ce mode retire les garde-fous du site, pour toi seulement et pour une durée limitée. Tout ce que tu fais reste réel : les membres verront les changements.</p>
      <ul class="god-lifts">${GOD_LIFTS.map(([k, v]) => `<li><strong>${esc(k)} :</strong> ${esc(v)}</li>`).join('')}</ul>
      <p class="god-kept small">Toujours actifs : sécurité et confidentialité, longueurs maximales, doublons, personne ne s'offre un cadeau à soi-même.</p>
      <fieldset class="god-dur">
        <legend>Durée</legend>
        <div class="god-dur-opts">${GOD_MINUTES.map((m) => `<label class="god-dur-opt"><input type="radio" name="minutes" value="${m}"${m === 30 ? ' checked' : ''}><span>${m < 60 ? `${m} min` : `${m / 60} h`}</span></label>`).join('')}</div>
      </fieldset>
      <div class="field">
        <label for="god-confirm">Pour confirmer, tape <strong class="god-phrase">${GOD_PHRASE}</strong></label>
        <input id="god-confirm" name="phrase" class="input" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-describedby="god-err">
      </div>
      <p class="god-err small" id="god-err" role="alert"></p>
      <div class="btn-row god-actions">
        <button class="btn btn-ghost god-cancel" type="button">Annuler</button>
        <button class="btn god-go" type="submit" disabled>Activer le mode sans limite</button>
      </div>
    </form>`;
  const f = d.querySelector('form');
  const go = d.querySelector('.god-go');
  const input = f.elements.phrase;
  const err = d.querySelector('.god-err');
  // Le bouton ne s'active que si la phrase est juste ; toute frappe efface l'erreur précédente
  input.addEventListener('input', () => { go.disabled = normPhrase(input.value) !== GOD_PHRASE; err.textContent = ''; });
  d.querySelector('.god-cancel').addEventListener('click', () => d.close());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); // clic sur le fond (le dialogue lui-même) : fermer
  d.addEventListener('close', () => { _godOpener?.focus?.(); _godOpener = null; });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (normPhrase(input.value) !== GOD_PHRASE) { err.textContent = `Tape exactement « ${GOD_PHRASE} » pour confirmer.`; input.focus(); return; }
    const minutes = Number(f.querySelector('input[name="minutes"]:checked')?.value) || 30;
    go.disabled = true;
    go.textContent = 'Activation…';
    try {
      await setGodMode(true, minutes);
      d.close();
      playSound('error'); // alerte discrète (seulement si les sons sont activés)
      toast(`Mode sans limite actif pour ${minutes < 60 ? `${minutes} min` : `${minutes / 60} h`}. Fais attention.`);
    } catch (ex) {
      err.textContent = `Activation impossible : ${errMsg(ex)}`;
      go.disabled = false;
    } finally { go.textContent = 'Activer le mode sans limite'; }
  });
  document.body.append(d);
  return d;
}

/**
 * Ouvre le dialogue d'activation. Le dialogue est vidé à chaque ouverture (phrase et erreur effacées).
 * @param {Element|null} ouvreur Élément qui avait le focus (bouton d'ouverture), à qui on rend le focus à la fermeture.
 */
export function ouvreDialogue(ouvreur) {
  _godDialog ||= buildGodDialog(); // créé au premier besoin seulement
  _godOpener = ouvreur || document.activeElement;
  const f = _godDialog.querySelector('form');
  f.elements.phrase.value = '';
  _godDialog.querySelector('.god-go').disabled = true;
  _godDialog.querySelector('.god-err').textContent = '';
  if (!_godDialog.open) _godDialog.showModal();
  f.elements.phrase.focus();
}
