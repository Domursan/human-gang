// Mode sans limite (admin uniquement) — état, bandeau, cadre rayé, compte à rebours, dialogue d'activation.
// Côté serveur : rpc hg_god_mode() → bool, rpc hg_set_god_mode(p_on, p_minutes) → fin (timestamptz) ou null,
// table hg_admin_state(user_id, god_until). Côté client : état { on, until }, minuteur d'expiration,
// bandeau + cadre rayé sur toutes les pages, html[data-godmode="on"], événement window 'hg:godmode'.
/*
 * Rôle : permet à un administrateur de lever temporairement les garde-fous du site (liste GOD_LIFTS)
 * pendant une durée fixée (proposée de 15 min à 2 h ; le serveur accepte de 5 à 240 min).
 * Tout ce que l'admin fait reste réel : les membres voient les changements.
 * Page : toutes les pages, pour un admin ; le bouton de l'en-tête et la carte de la page admin l'utilisent.
 * Dépendances : supabase.js (RPC et table), ui.js (toast), util.js (esc, errMsg), icons.js (ICON_ALERT).
 * Le dialogue d'activation (godmode-dialog.js) est chargé seulement à l'ouverture.
 * Rendu : attribut data-godmode sur <html>, bandeau fixe en haut, cadre rayé autour de la page, compte à rebours.
 * Synchronisation : entre onglets, via localStorage « hg_godmode_sync » (événement storage).
 * Exporte : GOD_MINUTES, GOD_PHRASE, GOD_LIFTS, getGodMode, isGodMode, godTag, godLimitAttr, godLimit,
 *   loadGodMode, setGodMode, disableGodMode, paintGod, openGodDialog.
 */
import { sb } from './supabase.js';
import { toast } from './ui.js';
import { esc, errMsg } from './util.js';
import { ICON_ALERT } from './icons.js';

/* ---------- Constantes ---------- */

/** Durées proposées dans le dialogue d'activation, en minutes. */
export const GOD_MINUTES = [15, 30, 60, 120];
/** Phrase à taper pour confirmer l'activation (évite un clic involontaire). */
export const GOD_PHRASE = 'SANS LIMITE';
/** Ce que le mode lève (affiché dans le dialog d'activation et la carte de la page admin). */
export const GOD_LIFTS = [
  ['Secret Santa', 'nouvelle édition même si une autre est en cours ; tirage dès 1 participant (on peut s\'offrir à soi-même) ; exclusions et « même cible que l\'an dernier » ignorées ; tirage refaisable (auto ou manuel) ; statut libre, sans confirmation de tirage.'],
  ['Secret Santa (page membre)', 't\'inscrire ou te désinscrire quel que soit le statut ; marquer (ou annuler) « envoyé » / « reçu » même après la fin.'],
  ['IRL', 'répondre à une sortie passée ; ajouter une rencontre « passée » datée dans le futur.'],
  ['Événements dynamiques', 'chaque événement (même inactif ou terminé) apparaît à chaque page, captures sans limite. Tes captures sont réellement enregistrées.'],
  ['Dates', 'moments cultes et date d\'arrivée d\'un membre dans le futur ; lien d\'invitation avec une date d\'expiration passée.'],
];

/* ---------- État interne ---------- */

/** État courant : on = mode actif ; until = date de fin (Date) ou null. */
let _god = { on: false, until: null };
/** true seulement si le profil chargé est admin. Sans cela, le mode reste éteint. */
let _godAdmin = false;
/** Minuteur qui coupe le mode à l'heure de fin (setTimeout). */
let _godTimer = 0;
/** Minuteur d'affichage du compte à rebours (setInterval, une fois par seconde). */
let _godTick = 0;
/** Observateur qui garde la variable CSS --god-h à la hauteur réelle du bandeau. */
let _godBannerRO = null;
/** Clé localStorage utilisée pour répercuter l'état vers les autres onglets. */
const GOD_SYNC_KEY = 'hg_godmode_sync';

/* ---------- Lecture de l'état ---------- */

/**
 * État du mode sans limite : { on, until } (until = Date de fin ou null). Toujours off pour un non-admin.
 * @returns {{on: boolean, until: Date|null}} Copie de l'état.
 */
export function getGodMode() { return { on: _god.on, until: _god.until }; }
/** Raccourci : le mode sans limite est-il actif pour moi ? */
export function isGodMode() { return _god.on; }
/**
 * Petit libellé à ajouter sur une action débloquée par le mode (chaîne HTML vide si le mode est coupé).
 * @param {boolean} [force=false] Affiche le libellé même si le mode est coupé (cas d'une action déjà passée).
 * @returns {string} Fragment HTML « (mode sans limite) » ou ''.
 */
export function godTag(force = false) { return force || _god.on ? ' <span class="god-tag">(mode sans limite)</span>' : ''; }

/* ---------- Limites levables (min / max des champs) ---------- */

/**
 * Attribut min/max « levé » en mode sans limite, pour un gabarit HTML : renvoie `data-god-<attr>="v" <attr>="v"`
 * (ou sans l'attribut si le mode est actif). paintGod remet / retire l'attribut quand le mode change.
 * Le « data-god-<attr> » garde la vraie valeur pour pouvoir la remettre plus tard.
 * @param {string} attr Nom de l'attribut ('min' ou 'max').
 * @param {string|number} value Valeur de la limite.
 * @returns {string} Attributs HTML à insérer dans la balise.
 */
export function godLimitAttr(attr, value) {
  return `data-god-${attr}="${esc(value)}"${_god.on ? '' : ` ${attr}="${esc(value)}"`}`;
}
/**
 * Même chose sur un élément existant.
 * @param {HTMLElement|null} el Élément à modifier (ignoré si null).
 * @param {string} attr Nom de l'attribut ('min' ou 'max').
 * @param {string|number} value Valeur de la limite.
 */
export function godLimit(el, attr, value) {
  if (!el) return;
  el.setAttribute(`data-god-${attr}`, value);
  if (_god.on) el.removeAttribute(attr); else el.setAttribute(attr, value);
}
/**
 * Applique l'état actuel à tous les champs marqués data-god-min / data-god-max :
 * mode actif = l'attribut est retiré ; mode coupé = il est remis depuis sa valeur gardée.
 */
function syncGodLimits() {
  for (const attr of ['min', 'max']) {
    document.querySelectorAll(`[data-god-${attr}]`).forEach((el) => {
      if (_god.on) el.removeAttribute(attr); else el.setAttribute(attr, el.getAttribute(`data-god-${attr}`));
    });
  }
}

/* ---------- Compte à rebours ---------- */

/**
 * Temps restant avant la fin, au format MM:SS (ou '' sans date de fin).
 * @returns {string} Par exemple « 04:59 ».
 */
function godLeft() {
  if (!_god.until) return '';
  const s = Math.max(0, Math.ceil((_god.until.getTime() - Date.now()) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
/** Heure de fin lisible (ex. « 14:30 »), ou '' sans date de fin. */
const godEndLabel = () => (_god.until ? new Intl.DateTimeFormat('fr-CH', { hour: '2-digit', minute: '2-digit' }).format(_god.until) : '');

/* ---------- Changement d'état ---------- */

/**
 * Passe le mode à on / off et met tout à jour : minuteur de fin, synchro entre onglets, rendu,
 * message de fin et événement « hg:godmode ».
 * Le mode n'est jamais actif sans droit admin, ni après sa date de fin.
 * @param {boolean} on Nouvel état demandé.
 * @param {string|Date|null} until Date de fin (ou null).
 * @param {{silent?: boolean, expired?: boolean, sync?: boolean}} [opts]
 *   silent : pas d'événement « hg:godmode » ; expired : affiche le message de fin ;
 *   sync : écrit l'état dans localStorage pour les autres onglets.
 */
function setGodState(on, until, { silent = false, expired = false, sync = false } = {}) {
  const t = until ? new Date(until).getTime() : NaN;
  const active = !!on && _godAdmin && (Number.isFinite(t) ? t > Date.now() : until == null);
  const nextUntil = active && Number.isFinite(t) ? new Date(t) : null;
  const changed = active !== _god.on || (nextUntil?.getTime() ?? 0) !== (_god.until?.getTime() ?? 0);
  _god = { on: active, until: nextUntil };
  clearTimeout(_godTimer);
  if (active && nextUntil) {
    // setTimeout ne supporte pas plus de 2^31-1 ms (environ 24 jours) : on borne la valeur
    const ms = Math.min(nextUntil.getTime() - Date.now(), 2 ** 31 - 1);
    _godTimer = setTimeout(godExpire, Math.max(0, ms));
  }
  if (sync) { try { localStorage.setItem(GOD_SYNC_KEY, JSON.stringify({ on: active, until: nextUntil?.toISOString() ?? null, t: Date.now() })); } catch {} }
  paintGod();
  if (expired && changed) toast('Mode sans limite terminé : les garde-fous sont rétablis.');
  if (changed && !silent) { try { window.dispatchEvent(new CustomEvent('hg:godmode', { detail: getGodMode() })); } catch {} }
}
/**
 * Appelée par le minuteur à l'heure de fin. Si le minuteur se déclenche trop tôt (horloge ou
 * mise en veille), on réarme au lieu de couper.
 */
function godExpire() {
  if (!_god.on) return;
  if (_god.until && _god.until.getTime() > Date.now() + 500) { setGodState(true, _god.until, { silent: true }); return; } // réveil trop tôt
  setGodState(false, null, { expired: true });
}

/* ---------- Chargement et activation (serveur) ---------- */

/**
 * Charge l'état du mode pour un admin (rpc hg_god_mode + hg_admin_state.god_until). Ne jette jamais.
 * Un non-admin n'envoie aucune requête : le mode est simplement coupé.
 * @param {object|null} profile Profil courant.
 */
export async function loadGodMode(profile) {
  _godAdmin = !!profile?.is_admin;
  if (!_godAdmin) { _god = { on: false, until: null }; paintGod(); return; }
  try {
    const [g, s] = await Promise.all([
      sb.rpc('hg_god_mode'),
      sb.from('hg_admin_state').select('god_until').eq('user_id', profile.id).maybeSingle(),
    ]);
    if (g.error) throw g.error;
    // La réponse peut être un booléen nu ou un objet { nom: bool } : on accepte les deux formes
    const raw = Array.isArray(g.data) ? g.data[0] : g.data;
    const on = raw === true || (raw && typeof raw === 'object' && Object.values(raw)[0] === true);
    if (s.error) console.warn('[mode sans limite] date de fin', s.error);
    setGodState(on, on ? (s.data?.god_until ?? null) : null, { silent: true });
  } catch (e) {
    console.warn('[mode sans limite]', e?.message || e);
  }
}

/**
 * Active (minutes : 5 à 240) ou coupe le mode sans limite. Renvoie le nouvel état. Jette en cas d'échec.
 * La durée est bornée ici (5 à 240 min). Si le serveur ne renvoie pas de date de fin à l'activation,
 * on considère que l'activation a échoué et on le signale.
 * @param {boolean} on true pour activer, false pour couper.
 * @param {number} [minutes=30] Durée d'activation.
 * @returns {Promise<{on: boolean, until: Date|null}>} Nouvel état.
 */
export async function setGodMode(on, minutes = 30) {
  if (!_godAdmin) throw new Error('Réservé à l\'administration.');
  const m = Math.min(240, Math.max(5, Math.round(Number(minutes) || 30)));
  const { data, error } = await sb.rpc('hg_set_god_mode', { p_on: !!on, p_minutes: m });
  if (error) throw error;
  const raw = Array.isArray(data) ? data[0] : data;
  const until = raw && typeof raw === 'object' ? Object.values(raw)[0] : raw;
  if (on && !until) throw new Error('Le serveur n\'a pas activé le mode (es-tu bien admin ?).');
  setGodState(!!on, on ? until : null, { sync: true });
  return getGodMode();
}

/**
 * Coupe le mode depuis un bouton (désactive le bouton pendant l'appel). Affiche le résultat dans un toast.
 * @param {HTMLButtonElement|null} btn Bouton à désactiver pendant l'appel.
 */
async function toggleGodOff(btn) {
  if (btn) btn.disabled = true;
  try { await setGodMode(false); toast('Mode sans limite désactivé : garde-fous rétablis.', 'ok'); }
  catch (e) { toast(`Désactivation impossible : ${errMsg(e)}`, 'error'); }
  finally { if (btn?.isConnected) btn.disabled = false; }
}
/**
 * Coupe le mode (bouton « Désactiver » du bandeau, de l'en-tête ou de la page admin).
 * @param {HTMLButtonElement|null} btn Bouton d'origine, désactivé pendant l'appel.
 * @returns {Promise<void>}
 */
export function disableGodMode(btn) { return toggleGodOff(btn); }

/* ---------- Rendu : attribut sur <html>, bandeau fixe, cadre rayé, bouton de l'en-tête, compte à rebours ---------- */

/**
 * Met à jour tout l'affichage selon l'état : attribut sur <html>, limites, bouton de l'en-tête,
 * bandeau et cadre rayé (créés à l'activation, retirés à la désactivation).
 * Appelée à chaque changement d'état, et une fois par seconde tant que le mode est actif.
 */
export function paintGod() {
  const root = document.documentElement;
  const on = _god.on;
  if (on) root.dataset.godmode = 'on'; else delete root.dataset.godmode;
  syncGodLimits();
  const btn = document.querySelector('.site-header .nav-god');
  if (btn) {
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? 'Désactiver le mode sans limite (actif)' : 'Activer le mode sans limite');
    btn.title = on ? 'Mode sans limite actif : cliquer pour le désactiver' : 'Mode sans limite';
    if (on) btn.removeAttribute('aria-haspopup'); else btn.setAttribute('aria-haspopup', 'dialog'); // actif : le clic coupe, il n'ouvre plus de dialogue
  }
  if (!document.body) return;
  let banner = document.querySelector('.god-banner');
  let frame = document.querySelector('.god-frame');
  if (!on) {
    // Mode coupé : on retire le bandeau, le cadre et les minuteurs d'affichage
    banner?.remove(); frame?.remove();
    _godBannerRO?.disconnect(); _godBannerRO = null;
    root.style.removeProperty('--god-h');
    clearInterval(_godTick); _godTick = 0;
    return;
  }
  if (!frame) {
    frame = document.createElement('div');
    frame.className = 'god-frame';
    frame.setAttribute('aria-hidden', 'true');
    document.body.append(frame);
  }
  if (!banner) {
    banner = document.createElement('div');
    banner.className = 'god-banner';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Mode sans limite');
    banner.innerHTML = `<div class="god-banner-in">
        <span class="god-ico">${ICON_ALERT}</span>
        <p class="god-msg" role="status"><strong>MODE SANS LIMITE</strong><span class="god-msg-sub"> — garde-fous désactivés</span></p>
        <p class="god-count" aria-live="off"><span class="god-count-l">expire dans </span><time class="god-left" data-god-left></time></p>
        <button class="god-off" type="button">Désactiver</button>
      </div>`;
    banner.querySelector('.god-off').addEventListener('click', (e) => toggleGodOff(e.currentTarget));
    document.body.prepend(banner);
    // La hauteur du bandeau est recopiée dans --god-h pour décaler le contenu sous lui
    if ('ResizeObserver' in window) {
      _godBannerRO = new ResizeObserver(() => root.style.setProperty('--god-h', `${Math.ceil(banner.getBoundingClientRect().height)}px`));
      _godBannerRO.observe(banner);
    }
    root.style.setProperty('--god-h', `${Math.ceil(banner.getBoundingClientRect().height)}px`);
  } else if (document.body.firstElementChild !== banner && !banner.contains(document.activeElement)) {
    document.body.prepend(banner); // reste le premier élément (ordre du clavier) même si l'en-tête est injecté après
  }
  const cnt = banner.querySelector('.god-count');
  cnt.hidden = !_god.until;
  cnt.title = _god.until ? `Fin à ${godEndLabel()}` : '';
  godTickNow();
  if (!_godTick) _godTick = setInterval(godTickNow, 1000);
}
/**
 * Rafraîchit le compte à rebours et l'heure de fin dans la page. Si l'heure de fin est passée,
 * le mode s'arrête (godExpire).
 */
function godTickNow() {
  if (!_god.on) return;
  if (_god.until && _god.until.getTime() <= Date.now()) { godExpire(); return; }
  const txt = godLeft();
  document.querySelectorAll('[data-god-left]').forEach((el) => {
    if (el.textContent !== txt) el.textContent = txt; // écrit seulement si ça change (moins de travail pour le navigateur)
    if (_god.until) el.setAttribute('datetime', _god.until.toISOString());
  });
  document.querySelectorAll('[data-god-end]').forEach((el) => { el.textContent = godEndLabel(); });
}

// Autre onglet : activation / désactivation répercutée sans rechargement
window.addEventListener('storage', (e) => {
  if (e.key !== GOD_SYNC_KEY || !_godAdmin || !e.newValue) return;
  try { const v = JSON.parse(e.newValue); setGodState(!!v.on, v.until); } catch {}
});

/**
 * Ouvre le dialog d'avertissement (admin). Ne fait rien si le mode est déjà actif.
 * Le dialogue (godmode-dialog.js) n'est chargé qu'à ce moment-là. L'élément qui a le focus est noté tout de suite
 * (l'événement du clic n'est plus lisible après le chargement).
 * @param {Event|null} [e] Événement du clic : son bouton reçoit le focus à la fermeture.
 */
export function openGodDialog(e) {
  if (!_godAdmin || _god.on) return;
  const ouvreur = e?.currentTarget || document.activeElement;
  import('./godmode-dialog.js').then((m) => m.ouvreDialogue(ouvreur)).catch((err) => console.warn('[mode sans limite]', err));
}
