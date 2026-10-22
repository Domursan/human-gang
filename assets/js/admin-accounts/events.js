// =====================================================================
// Comptes admin : écouteurs de la section (clics, saisies, formulaires) et démarrage.
// Un seul écouteur par type d'événement, posé sur la section #comptes ; les actions se repèrent aux attributs data-*.
// Dépendances : core.js (sb, toast, errMsg, $, $$), ui-confirm.js (confirmBox), utils.js (safeUrl), common.js,
// state.js, list.js, fiche.js, admin-ghosts.js, inspect.js, profile.js, ss.js, activity.js, admin-access.js, ss-shared.js.
// Exporte : initAccounts (point d'entrée appelé par admin.js).
// =====================================================================
import { sb, toast, errMsg, $, $$ } from '../core.js';
import { confirmBox } from '../ui-confirm.js';
import { safeUrl } from '../utils.js';
import { busy, check, fromLocalInput } from './common.js';
import { A, IDEA } from './state.js';
import { loadAccounts, paintAccountsList } from './list.js';
import { selectTab, renderPanel, renderDetail, reloadDetail, paintSugg } from './fiche.js';
import { bindGhostPanel, setGhostHooks, ensureGhosts } from '../admin-ghosts.js';
import { closeDetail } from './inspect.js';
import { saveProfile, saveInfos } from './profile.js';
import { ssJoin, ssLeave, setPair, clearPair, curEdition } from './ss.js';
import { setRsvp, deletePhoto, toggleBadge } from './activity.js';
import { setAccess, accessPages } from '../admin-access.js';
import { bindSharedFields } from './ss-shared.js';

/* =========================================================
   Événements de la section Comptes
   ========================================================= */
/**
 * Branche les écouteurs de la section Comptes. Appelée une seule fois par initAccounts.
 * Les actions sont repérées par les attributs data-* des boutons et formulaires.
 */
function bindAccounts() {
  const sec = $('#comptes');
  let searchTimer = 0;
  sec.addEventListener('input', (ev) => {
    if (ev.target.id === 'ap-joined') { const b = $('[data-act="clear-joined"]', sec); if (b) b.disabled = !ev.target.value; }
  });
  // Navigation au clavier entre les onglets : flèches gauche / droite, Début et Fin (comme un groupe d'onglets ARIA).
  sec.addEventListener('keydown', (ev) => {
    const tab = ev.target.closest('[role="tab"]');
    if (!tab || !['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(ev.key)) return;
    ev.preventDefault();
    const tabs = $$('[role="tab"]', sec);
    const i = tabs.indexOf(tab);
    const n = ev.key === 'Home' ? 0 : ev.key === 'End' ? tabs.length - 1 : (i + (ev.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    selectTab(tabs[n].dataset.tab, true);
  });
  // Clics sur les boutons : onglets, retour, actions de la fiche (badges, souhaits, idées, demandes d'aide, photos).
  sec.addEventListener('click', async (ev) => {
    const t = ev.target.closest('button');
    if (!t || t.disabled) return;
    if (t.dataset.tab) return selectTab(t.dataset.tab);
    const act = t.dataset.act;
    if (act === 'back') { closeDetail(); return; }
    if (act === 'clear-joined') { const i = $('#ap-joined'); i.value = ''; t.disabled = true; i.focus(); return; }
    if (act === 'show-pair' || act === 'hide-pair') { A.showPair = act === 'show-pair'; renderPanel(); return; }
    if (act === 'ss-join') return busy(t, async () => { await ssJoin(); await afterSS(); });
    if (act === 'ss-leave') return busy(t, async () => { if (await ssLeave()) await afterSS(); });
    if (t.dataset.delWish) {
      /* Souhait visé par le bouton de suppression. */
      const w = (A.d.wishes.data ?? []).find((x) => x.id === t.dataset.delWish);
      if (!(await confirmBox('Supprimer ce souhait ?', `« ${w?.label ?? ''} » sera retiré de la liste de ${A.d.profile.pseudo}.`, { ok: 'Supprimer', danger: true }))) return;
      return busy(t, async () => { check(await sb.from('hg_ss_wishes').delete().eq('id', t.dataset.delWish)); await reloadDetail(); toast('Souhait supprimé', 'ok'); });
    }
    if (t.dataset.delPhoto) return busy(t, async () => { if (await deletePhoto(t.dataset.delPhoto)) await reloadDetail(); });
    if (t.dataset.toggleBadge) {
      return busy(t, async () => {
        if (await toggleBadge(t.dataset.toggleBadge, t.getAttribute('aria-pressed') === 'true')) { renderDetail(); await A.onChange('badges'); }
      });
    }
    if (t.dataset.delIdea) {
      if (!(await confirmBox('Supprimer cette idée ?', 'Elle disparaîtra de la boîte à idées.', { ok: 'Supprimer', danger: true }))) return;
      return busy(t, async () => { check(await sb.from('hg_ideas').delete().eq('id', t.dataset.delIdea)); await reloadDetail(); toast('Idée supprimée', 'ok'); await A.onChange('ideas'); });
    }
    if (t.dataset.support) {
      return busy(t, async () => {
        check(await sb.from('hg_support').update({ status: t.dataset.status }).eq('id', t.dataset.support));
        await reloadDetail(); toast(t.dataset.status === 'traitee' ? 'Demande marquée comme traitée' : 'Demande rouverte', 'ok'); await A.onChange('support');
      });
    }
    if (t.dataset.delSupport) {
      if (!(await confirmBox('Supprimer cette demande ?', 'Elle sera effacée définitivement.', { ok: 'Supprimer', danger: true }))) return;
      return busy(t, async () => { check(await sb.from('hg_support').delete().eq('id', t.dataset.delSupport)); await reloadDetail(); toast('Demande supprimée', 'ok'); await A.onChange('support'); });
    }
  });
  // Changements de champs : édition du Secret Santa choisie, accès aux pages, réponse à une sortie IRL, statut d'une idée.
  sec.addEventListener('change', async (ev) => {
    const el = ev.target;
    if (el.matches('[data-ss-edition]')) { A.ssEdition = el.value; A.showPair = false; return selectTab('ss'); }
    if (el.dataset.pageAccess) {
      const slug = el.dataset.pageAccess, on = el.checked;
      el.disabled = true;
      try {
        await setAccess(slug, [A.uid], on); // déclenche 'hg:access' -> nouveau rendu de l'onglet
        const label = accessPages().find((x) => x.slug === slug)?.label || slug;
        toast(on ? `Accès à « ${label} » donné` : `Accès à « ${label} » retiré`, 'ok');
      } catch (e) { toast(errMsg(e), 'error'); el.checked = !on; el.disabled = false; }
      $(`[data-page-access="${CSS.escape(slug)}"]`)?.focus();
      return;
    }
    if (el.dataset.rsvp) {
      el.disabled = true;
      try { await setRsvp(el.dataset.rsvp, el.value); } catch (e) { toast(errMsg(e), 'error'); }
      renderPanel(); $(`[data-rsvp="${CSS.escape(el.dataset.rsvp)}"]`)?.focus();
      return;
    }
    if (el.dataset.ideaStatus) {
      el.disabled = true;
      try {
        check(await sb.from('hg_ideas').update({ status: el.value }).eq('id', el.dataset.ideaStatus));
        toast(`Idée : ${IDEA[el.value].toLowerCase()}`, 'ok'); await A.onChange('ideas');
      } catch (e) { toast(errMsg(e), 'error'); }
      await reloadDetail();
    }
  });
  // Envois de formulaires : profil, informations, dates du Secret Santa, attributions, souhaits.
  sec.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const form = ev.target, btn = ev.submitter, kind = form.dataset.form;
    if (kind === 'profile') return busy(btn, () => saveProfile(form, btn));
    if (kind === 'infos') return busy(btn, () => saveInfos(form));
    if (kind === 'ss-dates') {
      return busy(btn, async () => {
        const ed = curEdition();
        check(await sb.from('hg_ss_participants').update({ sent_at: fromLocalInput(form.sent_at.value), received_at: fromLocalInput(form.received_at.value) })
          .eq('edition_id', ed.id).eq('user_id', A.uid));
        toast('Dates enregistrées', 'ok'); await afterSS();
      });
    }
    if (kind === 'pair-target' || kind === 'pair-santa') {
      return busy(btn, async () => {
        const ed = curEdition(), who = form.who.value;
        let done;
        if (!who) done = await clearPair(ed.id, kind === 'pair-target' ? 'giver_id' : 'receiver_id');
        else done = kind === 'pair-target' ? await setPair(ed.id, A.uid, who) : await setPair(ed.id, who, A.uid);
        if (done) { toast('Attribution enregistrée', 'ok'); await afterSS(); }
      });
    }
    if (kind === 'wish-add' || kind === 'wish-edit') {
      return busy(btn, async () => {
        const label = form.label.value.trim(), rawUrl = form.url.value.trim();
        if (!label) throw new Error('Écris le souhait.');
        const url = rawUrl ? safeUrl(rawUrl) : null;
        if (rawUrl && !url) throw new Error('Lien invalide : http ou https uniquement.');
        if (kind === 'wish-add') check(await sb.from('hg_ss_wishes').insert({ edition_id: curEdition().id, user_id: A.uid, label, url }));
        else check(await sb.from('hg_ss_wishes').update({ label, url }).eq('id', form.dataset.id));
        await reloadDetail();
        toast(kind === 'wish-add' ? 'Souhait ajouté' : 'Souhait modifié', 'ok');
        if (kind === 'wish-add') $('#aw-new-l')?.focus();
      });
    }
  });
}
/** Après une modification du Secret Santa : recharge la fiche ouverte et prévient admin.js pour mettre à jour les autres vues. */
async function afterSS() { await reloadDetail(); await A.onChange('ss'); }

/** Point d'entrée appelé par admin.js. onChange(kind) : 'members' | 'badges' | 'ss' | 'ideas' | 'support'. */
export async function initAccounts({ me, onChange }) {
  A.me = me; if (onChange) A.onChange = async (k) => { try { await onChange(k); } catch (e) { console.error(e); } };
  bindAccounts();
  bindSharedFields();
  // Fantômes : zone principale (fiche d'un fantôme, bannière d'un compte) et tiroirs ; effets de bord ici.
  bindGhostPanel($('#acc-root'));
  setGhostHooks({
    members: () => A.accounts.filter((a) => !a.is_ghost && a.pseudo).map((a) => ({ id: a.id, pseudo: a.pseudo })),
    refreshed: async () => { await A.onChange('members'); paintSugg(); },
    merged: async (ghostId, memberId) => {
      // Après une liaison : la fiche du compte inscrit s'ouvre (rechargée si elle est déjà à l'écran)
      if (A.uid === memberId) return reloadDetail();
      location.hash = `#membres/comptes/${memberId}`;
    },
    removed: async (ghostId) => { if (A.uid === ghostId) location.hash = '#membres/comptes'; },
    openFiche: (id) => { location.hash = `#membres/comptes/${id}/profil`; },
  });
  try { await Promise.all([loadAccounts(), ensureGhosts()]); } catch (e) { A.listError = e; }
  paintAccountsList();
  paintSugg();
}
