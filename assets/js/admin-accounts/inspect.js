// Comptes admin : mode « vue admin » d'une fiche (bandeau et balayage visuel, sans modifier de données).
import { esc, avatarHtml, $ } from '../core.js';
import { IC } from './common.js';
import { A } from './state.js';
import { renderList } from './list.js';

/* =========================================================
   Mode inspection : effet visuel quand une fiche de membre est ouverte
   (purement visuel, aucune donnée modifiée)
   ========================================================= */
const INSP = { bar: null, layer: null, fx: null, leaveT: 0 };
const inspReduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

export function closeDetail() {
  A.uid = null; A.d = null;
  renderList();
  exitInspect();
  $('#acc-q')?.focus();
}
function inspIdentity() {
  const acc = A.accounts.find((a) => a.id === A.uid) || {};
  const p = A.d?.profile || { ...(A.avatars.get(A.uid) || {}), pseudo: acc.pseudo };
  return { ...(A.avatars.get(A.uid) || {}), ...p, pseudo: p.pseudo || acc.pseudo || 'Membre' };
}
export function enterInspect() {
  clearTimeout(INSP.leaveT);
  const body = document.body;
  const fresh = !INSP.bar;
  if (fresh) {
    INSP.layer = document.createElement('div');
    INSP.layer.className = 'insp-layer';
    INSP.layer.setAttribute('aria-hidden', 'true');
    INSP.fx = document.createElement('div');
    INSP.fx.className = 'insp-fx';
    INSP.fx.setAttribute('aria-hidden', 'true');
    INSP.fx.innerHTML = '<div class="insp-frame"><i></i><i></i><i></i><i></i></div><div class="insp-scan"></div>';
    INSP.bar = document.createElement('div');
    INSP.bar.className = 'insp-bar';
    INSP.bar.setAttribute('role', 'region');
    INSP.bar.setAttribute('aria-label', 'Vue admin d\'un compte');
    INSP.bar.innerHTML = `<div class="insp-bar-in">
        <span class="insp-tag">${IC.eye}<span>Vue admin</span></span>
        <span class="insp-who" aria-live="polite"></span>
        <button class="btn btn-ghost btn-sm insp-quit" type="button">Quitter la vue</button>
      </div>`;
    INSP.bar.querySelector('.insp-quit').addEventListener('click', closeDetail);
    body.append(INSP.layer, INSP.fx, INSP.bar);
  }
  body.classList.remove('is-inspect-leaving');
  body.classList.add('is-inspecting');
  updateInspect();
  // rejoue le balayage d'entrée (y compris quand on passe d'une fiche à l'autre)
  if (!inspReduced()) {
    body.classList.remove('is-inspect-enter');
    void INSP.fx.offsetWidth;
    body.classList.add('is-inspect-enter');
  }
}
export function updateInspect() {
  if (!INSP.bar || !A.uid) return;
  const p = inspIdentity();
  INSP.bar.querySelector('.insp-who').innerHTML = `${avatarHtml(p, 30)}<strong>${esc(p.pseudo)}</strong>`;
}
function exitInspect() {
  if (!INSP.bar) return;
  const body = document.body;
  const done = () => {
    body.classList.remove('is-inspecting', 'is-inspect-leaving', 'is-inspect-enter');
    INSP.layer?.remove(); INSP.fx?.remove(); INSP.bar?.remove();
    INSP.layer = INSP.fx = INSP.bar = null;
  };
  if (inspReduced()) return done();
  body.classList.add('is-inspect-leaving');
  INSP.leaveT = setTimeout(done, 320);
}
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape' || !A.uid || ev.defaultPrevented) return;
  if (document.querySelector('dialog[open]')) return;
  ev.preventDefault();
  closeDetail();
});
