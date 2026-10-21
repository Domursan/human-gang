// Admin : codes d'invitation (génération, liste, suppression).
import { sb, toast, esc, $, fmtDate } from '../core.js';
import { confirmBox } from '../ui-confirm.js';
import { S, pseudoOf } from './state.js';
import { ICON, busy, check, copyText } from './common.js';
import { loadInvites } from './loaders.js';
import { renderStats } from './overview.js';
import { matches, mountSearch, bindSearch, setCount, emptyHtml } from './list-tools.js';
import { openDrawer } from './ui/drawer.js';
import { openLinkDrawer } from '../admin-invite-links.js';
import { inviteConfig } from '../invite-config.js';

/* =========================================================
   Membres & invitations
   ========================================================= */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans I, L, O, 0, 1
function newCode() {
  const r = crypto.getRandomValues(new Uint32Array(4));
  return inviteConfig().prefixe + [...r].map((n) => CODE_ALPHABET[n % CODE_ALPHABET.length]).join('');
}

// La liste des membres est dans la section « Comptes » (admin-accounts.js).
export function renderMembers() { /* rien à rafraîchir ici : la liste des comptes ne dépend pas des badges */ }

export function renderInvites() {
  $('#invite-new').innerHTML = S.lastCodes.length ? `
    <div class="new-codes" role="status">
      <strong>${S.lastCodes.length > 1 ? 'Nouveaux codes' : 'Nouveau code'}</strong>
      <div class="codes">${S.lastCodes.map((c) => `<span class="code">${esc(c)}</span>`).join('')}</div>
      <button class="btn btn-ghost btn-sm" type="button" data-copy-all>${ICON.copy} Copier ${S.lastCodes.length > 1 ? 'tous les codes' : 'le code'}</button>
    </div>` : '';

  // Les codes issus d'un lien d'invitation sont listés sous leur lien (admin-invite-links.js)
  const manual = S.invites.filter((i) => !i.link_id);
  const shown = manual.filter((i) => matches(S.q.membres, i.code, i.used_by ? pseudoOf(i.used_by) : ''));
  const unused = shown.filter((i) => !i.used_by);
  const used = shown.filter((i) => i.used_by);
  setCount($('#invite-search-count'), shown.length, manual.length, S.q.membres, ['code', 'codes']);
  const unusedHtml = unused.length ? unused.map((i) => `
      <div class="list-row">
        <div class="grow"><span class="code">${esc(i.code)}</span><div class="small muted">Créé le ${esc(fmtDate(i.created_at))}</div></div>
        <div class="actions">
          <button class="btn btn-ghost btn-sm" type="button" data-copy="${esc(i.code)}">${ICON.copy} Copier</button>
          <button class="btn btn-danger btn-sm btn-icon" type="button" data-del-code="${esc(i.code)}" aria-label="Supprimer le code ${esc(i.code)}" title="Supprimer">${ICON.trash}</button>
        </div>
      </div>`).join('') : emptyHtml(S.q.membres, 'Aucun code disponible. Génère-en un pour inviter quelqu\'un.');
  const usedHtml = used.length ? used.map((i) => `
      <div class="list-row">
        <div class="grow"><span class="code muted">${esc(i.code)}</span>
          <div class="small muted">Utilisé par <strong class="text">${esc(pseudoOf(i.used_by))}</strong> le ${esc(fmtDate(i.used_at))}</div></div>
      </div>`).join('') : `<p class="small muted">${S.q.membres.trim() ? 'Aucun résultat.' : 'Aucun code utilisé pour l\'instant.'}</p>`;

  $('#invite-list').innerHTML = `
    <div class="subhead"><h4 class="sub-title">Disponibles (${unused.length})</h4>
      ${unused.length > 1 ? '<button class="btn btn-danger btn-sm" type="button" data-del-all>Supprimer tous les disponibles</button>' : ''}</div>
    <div class="scroll-list">${unusedHtml}</div>
    <div class="subhead"><h4 class="sub-title">Utilisés (${used.length})</h4></div>
    <div class="scroll-list">${usedHtml}</div>`;
}

let ME = null;

/** Ouvre le tiroir « Nouveau code » : génère 1 à 10 codes. */
function openCodeDrawer() {
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="field"><label for="invite-count">Nombre de codes</label>
      <select id="invite-count" name="count">${[1, 3, 5, 10].map((n) => `<option value="${n}">${n}</option>`).join('')}</select></div>
    <p class="muted small">Chaque code permet à une personne de créer son compte. Il devient inutilisable une fois utilisé.</p>`;
  openDrawer({
    title: 'Nouveau code d’invitation', body, submitLabel: 'Générer',
    onSubmit: async (form) => {
      const n = Number(form.elements.count.value) || 1;
      let codes = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        const set = new Set(); while (set.size < n) set.add(newCode());
        codes = [...set];
        const res = await sb.from('hg_invites').insert(codes.map((code) => ({ code, created_by: ME.id })));
        if (!res.error) break;
        if (res.error.code !== '23505' || attempt === 2) throw res.error; // doublon improbable : on retente
      }
      S.lastCodes = codes;
      await loadInvites();
      renderInvites(); renderStats();
      toast(n > 1 ? `${n} codes générés` : 'Code généré', 'ok');
    },
  });
}

/** Boutons de l'en-tête de zone de la sous-section Invitations. */
export function inviteActions() {
  const mk = (label, fn) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn-primary btn-sm'; b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  };
  return [mk('+ Nouveau code', openCodeDrawer), mk('+ Nouveau lien', () => openLinkDrawer())];
}

export function bindInvites(me) {
  ME = me;
  const search = mountSearch($('#invite-list'), { id: 'invite-search', label: 'Rechercher un code', placeholder: 'Code ou pseudo de la personne…' });
  bindSearch(search.input, (q) => { S.q.membres = q; renderInvites(); });

  $('#membres').addEventListener('click', async (ev) => {
    const t = ev.target.closest('button');
    if (!t) return;
    if (t.dataset.copy) return copyText(t.dataset.copy);
    if (t.hasAttribute('data-copy-all')) return copyText(S.lastCodes.join('\n'));
    if (t.dataset.delCode) {
      const code = t.dataset.delCode;
      if (!(await confirmBox('Supprimer ce code ?', `Le code ${code} ne pourra plus être utilisé.`, { ok: 'Supprimer', danger: true }))) return;
      await busy(t, async () => {
        check(await sb.from('hg_invites').delete().eq('code', code).is('used_by', null));
        S.lastCodes = S.lastCodes.filter((c) => c !== code);
        await loadInvites(); renderInvites(); renderStats();
        toast('Code supprimé', 'ok');
      });
    }
    if (t.hasAttribute('data-del-all')) {
      const n = S.invites.filter((i) => !i.used_by && !i.link_id).length;
      if (!(await confirmBox('Supprimer tous les codes disponibles ?', `${n} codes non utilisés seront supprimés. Les codes déjà utilisés sont conservés.`, { ok: 'Tout supprimer', danger: true }))) return;
      await busy(t, async () => {
        check(await sb.from('hg_invites').delete().is('used_by', null).is('link_id', null));
        S.lastCodes = [];
        await loadInvites(); renderInvites(); renderStats();
        toast('Codes disponibles supprimés', 'ok');
      });
    }
  });
}
