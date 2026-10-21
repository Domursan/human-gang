// Mode sans limite (admin uniquement) — état, bandeau, cadre rayé, compte à rebours, dialogue d'activation.
// Côté serveur : rpc hg_god_mode() → bool, rpc hg_set_god_mode(p_on, p_minutes) → fin (timestamptz) ou null,
// table hg_admin_state(user_id, god_until). Côté client : état { on, until }, minuteur d'expiration,
// bandeau + cadre rayé sur toutes les pages, html[data-godmode="on"], événement window 'hg:godmode'.
import { sb } from './supabase.js';
import { toast } from './ui.js';
import { esc, errMsg } from './util.js';
import { playSound } from '../sound.js';
import { ICON_ALERT } from './icons.js';

export const GOD_MINUTES = [15, 30, 60, 120];
export const GOD_PHRASE = 'SANS LIMITE';
/** Ce que le mode lève (affiché dans le dialog d'activation et la carte de la page admin). */
export const GOD_LIFTS = [
  ['Secret Santa', 'nouvelle édition même si une autre est en cours ; tirage dès 1 participant (on peut s\'offrir à soi-même) ; exclusions et « même cible que l\'an dernier » ignorées ; tirage refaisable (auto ou manuel) ; statut libre, sans confirmation de tirage.'],
  ['Secret Santa (page membre)', 't\'inscrire ou te désinscrire quel que soit le statut ; marquer (ou annuler) « envoyé » / « reçu » même après la fin.'],
  ['IRL', 'répondre à une sortie passée ; ajouter une rencontre « passée » datée dans le futur.'],
  ['Événements dynamiques', 'chaque événement (même inactif ou terminé) apparaît à chaque page, captures sans limite. Tes captures sont réellement enregistrées.'],
  ['Dates', 'moments cultes et date d\'arrivée d\'un membre dans le futur ; lien d\'invitation avec une date d\'expiration passée.'],
];
let _god = { on: false, until: null };
let _godAdmin = false;
let _godTimer = 0;
let _godTick = 0;
let _godBannerRO = null;
const GOD_SYNC_KEY = 'hg_godmode_sync';

/** État du mode sans limite : { on, until } (until = Date de fin ou null). Toujours off pour un non-admin. */
export function getGodMode() { return { on: _god.on, until: _god.until }; }
/** Raccourci : le mode sans limite est-il actif pour moi ? */
export function isGodMode() { return _god.on; }
/** Petit libellé à ajouter sur une action débloquée par le mode (chaîne HTML vide si le mode est coupé). */
export function godTag(force = false) { return force || _god.on ? ' <span class="god-tag">(mode sans limite)</span>' : ''; }
/**
 * Attribut min/max « levé » en mode sans limite, pour un gabarit HTML : renvoie `data-god-<attr>="v" <attr>="v"`
 * (ou sans l'attribut si le mode est actif). paintGod remet / retire l'attribut quand le mode change.
 */
export function godLimitAttr(attr, value) {
  return `data-god-${attr}="${esc(value)}"${_god.on ? '' : ` ${attr}="${esc(value)}"`}`;
}
/** Même chose sur un élément existant. */
export function godLimit(el, attr, value) {
  if (!el) return;
  el.setAttribute(`data-god-${attr}`, value);
  if (_god.on) el.removeAttribute(attr); else el.setAttribute(attr, value);
}
function syncGodLimits() {
  for (const attr of ['min', 'max']) {
    document.querySelectorAll(`[data-god-${attr}]`).forEach((el) => {
      if (_god.on) el.removeAttribute(attr); else el.setAttribute(attr, el.getAttribute(`data-god-${attr}`));
    });
  }
}

function godLeft() {
  if (!_god.until) return '';
  const s = Math.max(0, Math.ceil((_god.until.getTime() - Date.now()) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
const godEndLabel = () => (_god.until ? new Intl.DateTimeFormat('fr-CH', { hour: '2-digit', minute: '2-digit' }).format(_god.until) : '');

function setGodState(on, until, { silent = false, expired = false, sync = false } = {}) {
  const t = until ? new Date(until).getTime() : NaN;
  const active = !!on && _godAdmin && (Number.isFinite(t) ? t > Date.now() : until == null);
  const nextUntil = active && Number.isFinite(t) ? new Date(t) : null;
  const changed = active !== _god.on || (nextUntil?.getTime() ?? 0) !== (_god.until?.getTime() ?? 0);
  _god = { on: active, until: nextUntil };
  clearTimeout(_godTimer);
  if (active && nextUntil) {
    const ms = Math.min(nextUntil.getTime() - Date.now(), 2 ** 31 - 1);
    _godTimer = setTimeout(godExpire, Math.max(0, ms));
  }
  if (sync) { try { localStorage.setItem(GOD_SYNC_KEY, JSON.stringify({ on: active, until: nextUntil?.toISOString() ?? null, t: Date.now() })); } catch {} }
  paintGod();
  if (expired && changed) toast('Mode sans limite terminé : les garde-fous sont rétablis.');
  if (changed && !silent) { try { window.dispatchEvent(new CustomEvent('hg:godmode', { detail: getGodMode() })); } catch {} }
}
function godExpire() {
  if (!_god.on) return;
  if (_god.until && _god.until.getTime() > Date.now() + 500) { setGodState(true, _god.until, { silent: true }); return; } // réveil trop tôt
  setGodState(false, null, { expired: true });
}

/** Charge l'état du mode pour un admin (rpc hg_god_mode + hg_admin_state.god_until). Ne jette jamais. */
export async function loadGodMode(profile) {
  _godAdmin = !!profile?.is_admin;
  if (!_godAdmin) { _god = { on: false, until: null }; paintGod(); return; }
  try {
    const [g, s] = await Promise.all([
      sb.rpc('hg_god_mode'),
      sb.from('hg_admin_state').select('god_until').eq('user_id', profile.id).maybeSingle(),
    ]);
    if (g.error) throw g.error;
    const raw = Array.isArray(g.data) ? g.data[0] : g.data;
    const on = raw === true || (raw && typeof raw === 'object' && Object.values(raw)[0] === true);
    if (s.error) console.warn('[mode sans limite] date de fin', s.error);
    setGodState(on, on ? (s.data?.god_until ?? null) : null, { silent: true });
  } catch (e) {
    console.warn('[mode sans limite]', e?.message || e);
  }
}

/** Active (minutes : 5 à 240) ou coupe le mode sans limite. Renvoie le nouvel état. Jette en cas d'échec. */
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

async function toggleGodOff(btn) {
  if (btn) btn.disabled = true;
  try { await setGodMode(false); toast('Mode sans limite désactivé : garde-fous rétablis.', 'ok'); }
  catch (e) { toast(`Désactivation impossible : ${errMsg(e)}`, 'error'); }
  finally { if (btn?.isConnected) btn.disabled = false; }
}
/** Coupe le mode (bouton « Désactiver » du bandeau, de l'en-tête ou de la page admin). */
export function disableGodMode(btn) { return toggleGodOff(btn); }

/* Rendu : attribut sur <html>, bandeau fixe, cadre rayé, bouton de l'en-tête, compte à rebours */
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
    if (on) btn.removeAttribute('aria-haspopup'); else btn.setAttribute('aria-haspopup', 'dialog');
  }
  if (!document.body) return;
  let banner = document.querySelector('.god-banner');
  let frame = document.querySelector('.god-frame');
  if (!on) {
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
function godTickNow() {
  if (!_god.on) return;
  if (_god.until && _god.until.getTime() <= Date.now()) { godExpire(); return; }
  const txt = godLeft();
  document.querySelectorAll('[data-god-left]').forEach((el) => {
    if (el.textContent !== txt) el.textContent = txt;
    if (_god.until) el.setAttribute('datetime', _god.until.toISOString());
  });
  document.querySelectorAll('[data-god-end]').forEach((el) => { el.textContent = godEndLabel(); });
}
// Autre onglet : activation / désactivation répercutée sans rechargement
window.addEventListener('storage', (e) => {
  if (e.key !== GOD_SYNC_KEY || !_godAdmin || !e.newValue) return;
  try { const v = JSON.parse(e.newValue); setGodState(!!v.on, v.until); } catch {}
});

/* Dialog d'activation */
let _godDialog = null;
let _godOpener = null;
const normPhrase = (s) => String(s || '').trim().replace(/\s+/g, ' ').toUpperCase();
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
  input.addEventListener('input', () => { go.disabled = normPhrase(input.value) !== GOD_PHRASE; err.textContent = ''; });
  d.querySelector('.god-cancel').addEventListener('click', () => d.close());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
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
/** Ouvre le dialog d'avertissement (admin). Ne fait rien si le mode est déjà actif. */
export function openGodDialog(e) {
  if (!_godAdmin || _god.on) return;
  _godDialog ||= buildGodDialog();
  _godOpener = e?.currentTarget || document.activeElement;
  const f = _godDialog.querySelector('form');
  f.elements.phrase.value = '';
  _godDialog.querySelector('.god-go').disabled = true;
  _godDialog.querySelector('.god-err').textContent = '';
  if (!_godDialog.open) _godDialog.showModal();
  f.elements.phrase.focus();
}
