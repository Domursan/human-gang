// Admin : actions de la section Secret Santa. Création, modification et exclusions dans le tiroir ; tirage,
// refaire le tirage et suppression après confirmation. Les formulaires gardent leur logique d'enregistrement.
// Utilisé par admin.js (bindSecretSanta) et ss-render.js (boutons de la page). Toutes les actions passent par une
// délégation de clics installée une seule fois sur le document (la barre de zone et les tiroirs sont hors de la section).
// Dépend de core.js, confirm, admin-godmode.js (confirmation « Refaire le tirage »), admin-ss-manual.js (tirage manuel),
// admin-accounts.js (champs partagés), ui/drawer.js, state.js, loaders.js, ss-render.js et reglages-valeurs-lot3.js.
import { sb, toast, errMsg, esc, fmtDateTime, $, isGodMode, notify, godTag } from '../core.js';
import { confirmBox } from '../ui-confirm.js';
import { confirmRedo } from '../admin-godmode.js';
import { openManualDraw } from '../admin-ss-manual.js';
import { readSharedFields, sharedFieldsHtml } from '../admin-accounts.js';
import { openDrawer } from './ui/drawer.js';
import { S, pseudoOf, STATUS, STATUS_LABEL } from './state.js';
import { busy, check, uploadAsset, pickFile, nullIfEmpty } from './common.js';
import { loadEditions, loadEditionDetails } from './loaders.js';
import { refreshCounts } from './counts.js';
import { renderSS, SSV, ssCurrent, ssOpenEdition } from './ss-render.js';
import { navigate } from './shell.js';
import { reglage } from '../reglages-valeurs-lot3.js';

// Adresse de la sous-section Secret Santa (retour après suppression d'une édition).
const SS_ROUTE = 'irl/secret-santa';
// Vrai une fois les écouteurs installés : bindSecretSanta ne s'exécute qu'une fois.
let bound = false;

/* ---------- Tiroirs : création, modification, exclusion ---------- */

/**
 * Contenu du tiroir « Nouvelle édition » : année proposée, budget par défaut, dates, champs partagés.
 * Une édition en cours bloque la création (sauf en mode sans limite) : le formulaire est alors désactivé.
 * @returns {{locked: boolean, html: string}}
 */
function createBody() {
  const god = isGodMode();
  const openEd = ssOpenEdition();
  const locked = openEd && !god; // une seule édition en cours à la fois (trigger en base, levé en mode sans limite)
  const nextYear = Math.max(new Date().getFullYear(), ...S.editions.map((e) => e.year + 1));
  // Vrai si une édition porte déjà cette année (l'année proposée doit être libre).
  const yearExists = (y) => S.editions.some((e) => e.year === y);
  const defaultYear = yearExists(new Date().getFullYear()) ? nextYear : new Date().getFullYear();
  const note = openEd && !god
    ? `<p class="ss-locked small" id="ssc-locked" role="note">Termine l'édition ${esc(openEd.year)} avant d'en créer une nouvelle (statut actuel : ${esc(STATUS_LABEL[openEd.status] ?? openEd.status)}).</p>`
    : openEd && god
      ? `<p class="god-note" id="ssc-locked" role="note"><strong>Mode sans limite :</strong> l'édition ${esc(openEd.year)} n'est pas terminée (${esc(STATUS_LABEL[openEd.status] ?? openEd.status)}), tu peux quand même en créer une nouvelle. La page Secret Santa des membres affichera la plus récente.</p>`
      : '';
  return {
    locked,
    html: `${note}
      <fieldset class="ss-create-fields"${locked ? ' disabled' : ''}>
        <div class="grid-2">
          <div class="field"><label for="ssc-year">Année</label><input id="ssc-year" name="year" type="number" min="2020" max="2100" required value="${defaultYear}"></div>
          <div class="field"><label for="ssc-budget">Budget</label><input id="ssc-budget" name="budget" maxlength="60" placeholder="ex. 20 à 30 CHF" value="${esc(reglage('ss.budget_defaut') ?? '')}"></div>
          <div class="field"><label for="ssc-send">Date limite d'envoi</label><input id="ssc-send" name="send_deadline" type="date"></div>
          <div class="field"><label for="ssc-exch">Date d'échange</label><input id="ssc-exch" name="exchange_date" type="date"></div>
        </div>
        ${sharedFieldsHtml('ssc', [])}
      </fieldset>`,
  };
}

/** Ouvre le tiroir de création d'une édition ; le bouton « Créer » est désactivé si une édition est en cours. */
function openCreate() {
  const body = createBody();
  const d = openDrawer({
    title: 'Nouvelle édition',
    subtitle: 'Les inscriptions ouvrent dès la création.',
    body: body.html,
    submitLabel: 'Créer l\'édition',
    onSubmit: (form) => createEdition(form),
    wide: true,
  });
  if (body.locked) d.el.querySelector('[data-drawer-submit]').disabled = true;
}

/**
 * Crée l'édition à partir du formulaire, puis ouvre sa page. Un refus du serveur (trigger « une seule édition en cours »)
 * recharge les éditions et explique la marche à suivre.
 */
async function createEdition(form) {
  const fd = new FormData(form);
  const year = Number(fd.get('year'));
  if (S.editions.some((e) => e.year === year)) throw new Error(`L'édition ${year} existe déjà.`);
  const openEd = ssOpenEdition();
  if (openEd && !isGodMode()) throw new Error(`Termine l'édition ${openEd.year} avant d'en créer une nouvelle.`);
  const res = await sb.from('hg_ss_editions').insert({
    year, budget: nullIfEmpty(fd.get('budget')), send_deadline: nullIfEmpty(fd.get('send_deadline')),
    exchange_date: nullIfEmpty(fd.get('exchange_date')), shared_fields: readSharedFields(form),
  }).select().single();
  if (res.error && /termine/i.test(errMsg(res.error))) { // trigger hg_ss_editions_guard (levé côté serveur en mode sans limite)
    await loadEditions(); renderSS();
    throw new Error(isGodMode()
      ? 'Le serveur refuse encore : le mode sans limite a peut-être expiré. Réactive-le puis réessaie.'
      : 'Une édition est encore en cours : passe-la en « Terminé » avant d\'en créer une nouvelle.');
  }
  const row = check(res);
  await loadEditions();
  renderSS(); refreshCounts();
  toast(`Édition ${year} créée, inscriptions ouvertes`, 'ok');
  navigate(`${SS_ROUTE}/${row.id}`);
  return true;
}

/** Contenu du tiroir « Modifier » : statut, budget, dates et champs partagés, avec la date du tirage. */
function editBody(ed) {
  return `
    <div class="grid-2">
      <div class="field"><label for="sse-status">Statut${godTag()}</label>
        <select id="sse-status" name="status">${STATUS.map(([k, l]) => `<option value="${k}"${k === ed.status ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <div class="field"><label for="sse-budget">Budget</label><input id="sse-budget" name="budget" maxlength="60" value="${esc(ed.budget ?? '')}"></div>
      <div class="field"><label for="sse-send">Date limite d'envoi</label><input id="sse-send" name="send_deadline" type="date" value="${esc(ed.send_deadline ?? '')}"></div>
      <div class="field"><label for="sse-exch">Date d'échange</label><input id="sse-exch" name="exchange_date" type="date" value="${esc(ed.exchange_date ?? '')}"></div>
    </div>
    ${sharedFieldsHtml('sse', ed.shared_fields ?? [])}
    <p class="small muted">${ed.drawn_at ? `Tirage effectué le ${esc(fmtDateTime(ed.drawn_at))}.` : 'Tirage pas encore effectué.'} Le tirage passe automatiquement l'édition en « Envoi des cadeaux ».</p>`;
}

/** Ouvre le tiroir de modification de l'édition (la courante par défaut). */
function openEdit(ed = ssCurrent()) {
  if (!ed) return;
  openDrawer({
    title: `Modifier l'édition ${ed.year}`,
    subtitle: 'Statut, budget, dates et informations transmises aux Santas.',
    body: editBody(ed),
    submitLabel: 'Enregistrer',
    onSubmit: (form) => saveEdition(form, ed),
    wide: true,
  });
}

/**
 * Enregistre les modifications d'une édition. Deux passages demandent confirmation :
 * aller vers « envoi » ou plus sans tirage, et passer à la révélation (tous verront qui offrait à qui).
 * @returns {Promise<boolean>} false si la personne annule une confirmation (le tiroir reste ouvert).
 */
async function saveEdition(form, ed) {
  const fd = new FormData(form);
  const status = fd.get('status');
  if (status !== ed.status && ['envoi', 'revelation', 'termine'].includes(status) && !ed.drawn_at && !isGodMode()) {
    if (!(await confirmBox('Aucun tirage effectué', `Passer en « ${STATUS_LABEL[status]} » sans tirage ? Les participants n'auront pas de cible.`, { ok: 'Changer quand même' }))) return false;
  }
  if (status === 'revelation' && ed.status !== 'revelation') {
    if (!(await confirmBox('Passer à la révélation ?', 'Tous les membres pourront voir qui offrait à qui.', { ok: 'Révéler' }))) return false;
  }
  check(await sb.from('hg_ss_editions').update({
    status, budget: nullIfEmpty(fd.get('budget')),
    send_deadline: nullIfEmpty(fd.get('send_deadline')), exchange_date: nullIfEmpty(fd.get('exchange_date')),
    shared_fields: readSharedFields(form),
  }).eq('id', ed.id));
  await loadEditions();
  renderSS(); refreshCounts();
  toast('Édition enregistrée', 'ok');
  return true;
}

/** Fantôme (compte non inscrit) : exclu des choix, pas de l'historique. */
function isGhost(id) { return !!S.byId.get(id)?.is_ghost; }

/**
 * Tiroir « Nouvelle exclusion » : deux personnes qui ne se tireront pas l'une l'autre.
 * Ne propose que les comptes actifs ; une exclusion existante reste affichée avec son nom.
 */
function openExcl() {
  // Choix des deux personnes : comptes actifs seulement (les exclusions déjà saisies restent affichées avec leur nom).
  const parts = S.participants.filter((p) => !S.byId.get(p.user_id)?.is_ghost)
    .sort((a, b) => pseudoOf(a.user_id).localeCompare(pseudoOf(b.user_id), 'fr'));
  if (parts.length < 2) return;
  const opts = parts.map((p) => `<option value="${esc(p.user_id)}">${esc(pseudoOf(p.user_id))}</option>`).join('');
  openDrawer({
    title: 'Nouvelle exclusion',
    subtitle: 'Ces deux personnes ne se tireront pas l\'une l\'autre.',
    body: `<div class="grid-2">
      <div class="field"><label for="ex-a">Personne A</label><select id="ex-a" name="a" required>${opts}</select></div>
      <div class="field"><label for="ex-b">Personne B</label><select id="ex-b" name="b" required>${opts}</select></div>
    </div>`,
    submitLabel: 'Ajouter',
    onSubmit: (form) => addExclusion(form),
  });
  // Deux personnes différentes par défaut : la seconde liste démarre sur la deuxième option.
  const b = document.getElementById('ex-b');
  if (b && b.options.length > 1) b.selectedIndex = 1;
}

/**
 * Ajoute une exclusion. Les deux identifiants sont rangés dans l'ordre (user_a < user_b) pour qu'une paire
 * n'existe qu'une fois, quel que soit l'ordre de saisie.
 */
async function addExclusion(form) {
  let a = $('#ex-a', form).value, b = $('#ex-b', form).value;
  if (!a || !b || a === b) throw new Error('Choisis deux personnes différentes.');
  if (a > b) [a, b] = [b, a];
  if (S.exclusions.some((x) => (x.user_a === a && x.user_b === b) || (x.user_a === b && x.user_b === a))) throw new Error('Cette exclusion existe déjà.');
  check(await sb.from('hg_ss_exclusions').insert({ edition_id: S.editionId, user_a: a, user_b: b }));
  await loadEditionDetails();
  renderSS();
  toast('Exclusion ajoutée', 'ok');
  return true;
}

/* ---------- Tirage, cartes, suppression ---------- */

/** Retire une exclusion. Le bouton porte la paire dans data-del-excl, « idA|idB ». */
async function deleteExclusion(btn) {
  const [a, b] = btn.dataset.delExcl.split('|');
  await busy(btn, async () => {
    check(await sb.from('hg_ss_exclusions').delete().eq('edition_id', S.editionId).eq('user_a', a).eq('user_b', b));
    await loadEditionDetails(); renderSS();
    toast('Exclusion retirée', 'ok');
  });
}

/**
 * Tirage au sort (une seule fois par édition). Demande confirmation ; le bot prévient les participants
 * (sans jamais révéler les paires).
 */
async function draw(btn, ed) {
  if (ed.drawn_at) return; // un seul tirage par édition
  const n = S.participants.length;
  const msg = isGodMode()
    ? `${n} participants. Mode sans limite : les ${S.exclusions.length} exclusion${S.exclusions.length > 1 ? 's' : ''} et la cible de l'an dernier sont ignorées.\nTu pourras refaire le tirage tant que le mode est actif.\nL'édition passera en « Envoi des cadeaux » et les participants seront prévenus par le bot.`
    : `${n} participants, ${S.exclusions.length} exclusion${S.exclusions.length > 1 ? 's' : ''}.\nLe tirage est définitif : il ne pourra pas être relancé. Vérifie les inscrits et les exclusions avant.\nL'édition passera en « Envoi des cadeaux » et les participants seront prévenus par le bot.`;
  if (!(await confirmBox('Lancer le tirage ?', msg, { ok: 'Lancer le tirage' }))) return;
  await busy(btn, async () => {
    const count = check(await sb.rpc('hg_ss_draw', { p_edition: ed.id }));
    S.lastDraw = { edition: ed.id, n: count };
    notify('ss_draw', { edition_id: ed.id }); // le bot prévient (sans jamais révéler les paires)
    await loadEditions(); renderSS(); refreshCounts();
    toast(`Tirage OK pour ${count} participants`, 'ok');
  });
}

/** Tirage manuel : l'administrateur fixe chaque paire, le reste est complété au hasard (tiroir dédié). */
async function drawManual(btn, ed) {
  if (ed.drawn_at) return;
  await busy(btn, () => openManualDraw({
    edition: ed, participants: S.participants.map((p) => p.user_id), exclusions: S.exclusions, editions: S.editions, pseudoOf, isGhost,
    onDone: async (count) => {
      S.lastDraw = { edition: ed.id, n: count };
      await loadEditions(); renderSS(); refreshCounts();
      toast(`Tirage manuel enregistré pour ${count} participants`, 'ok');
    },
  }));
}

/* Mode sans limite : refaire le tirage (suppression des attributions puis nouveau tirage auto ou manuel) */
/** Supprime les attributions de l'édition (première étape d'un nouveau tirage). */
async function deleteAssignments(ed) {
  check(await sb.from('hg_ss_assignments').delete().eq('edition_id', ed.id));
}
/**
 * Appelée quand le nouveau tirage échoue après la suppression : l'édition redevient « sans tirage » pour
 * qu'on puisse le relancer. Échec de cette remise à zéro = simple avertissement dans la console.
 */
async function afterFailedRedraw(ed) {
  // Attributions supprimées mais nouveau tirage refusé : l'édition redevient « sans tirage » pour pouvoir relancer.
  try { check(await sb.from('hg_ss_editions').update({ drawn_at: null }).eq('id', ed.id)); } catch (e) { console.warn('[tirage] remise à zéro', e); }
  await loadEditions(); renderSS(); refreshCounts();
}

/**
 * Refaire le tirage (mode sans limite uniquement) : confirmation, suppression des attributions, nouveau tirage.
 * @param {boolean} manual true : tirage manuel (tiroir), false : tirage au hasard.
 */
async function redraw(btn, ed, manual) {
  const n = S.participants.length;
  if (manual) {
    await busy(btn, () => openManualDraw({
      edition: ed, participants: S.participants.map((p) => p.user_id), exclusions: S.exclusions, editions: S.editions, pseudoOf, isGhost,
      redo: {
        confirm: () => confirmRedo({ year: ed.year, participants: n, manual: true }),
        before: () => deleteAssignments(ed),
        onFail: () => afterFailedRedraw(ed),
      },
      onDone: async (count) => {
        S.lastDraw = { edition: ed.id, n: count };
        await loadEditions(); renderSS(); refreshCounts();
        toast(`Nouveau tirage manuel enregistré pour ${count} participants`, 'ok');
      },
    }));
    return;
  }
  const { ok, notify: tell } = await confirmRedo({ year: ed.year, participants: n });
  if (!ok) return;
  await busy(btn, async () => {
    if (!isGodMode()) throw new Error('Le mode sans limite a expiré : réactive-le pour refaire le tirage.');
    await deleteAssignments(ed);
    const res = await sb.rpc('hg_ss_draw', { p_edition: ed.id });
    if (res.error) { await afterFailedRedraw(ed); throw res.error; }
    const count = res.data;
    S.lastDraw = { edition: ed.id, n: count };
    if (tell) notify('ss_draw', { edition_id: ed.id });
    await loadEditions(); renderSS(); refreshCounts();
    toast(`Nouveau tirage OK pour ${count} participants`, 'ok');
  });
}

/* Suppression d'une édition : la base supprime en cascade inscrits, exclusions, attributions, vœux,
   conversations de l'édition et leurs messages. Le détail est compté avant la confirmation. */
/**
 * Supprime l'édition après confirmation. Le détail de ce qui sera effacé (comptes à rebours en base) est affiché d'abord.
 * Une fois supprimée, la page revient à la liste.
 */
async function deleteEdition(btn, ed) {
  /** Nombre de lignes de `table` liées à l'édition (requête de comptage seule). */
  const count = (table) => sb.from(table).select('*', { count: 'exact', head: true }).eq('edition_id', ed.id)
    .then((r) => { if (r.error) throw r.error; return r.count ?? 0; });
  let assign, wishes, convs;
  // Conversations : par RPC (le Staff n'a plus d'accès direct à hg_conversations, migration 073).
  const countConvs = () => sb.rpc('hg_ss_edition_conv_count', { p_edition: ed.id }).then((r) => { if (r.error) throw r.error; return r.data ?? 0; });
  try { [assign, wishes, convs] = await Promise.all([count('hg_ss_assignments'), count('hg_ss_wishes'), countConvs()]); }
  catch (e) { toast(errMsg(e), 'error'); return; }
  const parts = S.participants.length, ex = S.exclusions.length;
  const detail = `Effacé avec l'édition : ${parts} inscrit${parts > 1 ? 's' : ''}, ${ex} exclusion${ex > 1 ? 's' : ''}, ${assign} attribution${assign > 1 ? 's' : ''} du tirage, ${wishes} vœu${wishes > 1 ? 'x' : ''}, ${convs} conversation${convs > 1 ? 's' : ''} de l'édition avec tous leurs messages.`;
  const warn = ed.drawn_at ? ' Le tirage déjà effectué sera perdu.' : '';
  const ok = await confirmBox(`Supprimer définitivement l'édition ${ed.year} ?`,
    `${detail}${warn} La carte de base téléversée reste dans le stockage. Impossible à annuler.`,
    { ok: 'Supprimer l\'édition', danger: true });
  if (!ok) return;
  await busy(btn, async () => {
    check(await sb.from('hg_ss_editions').delete().eq('id', ed.id));
    await loadEditions();
    S.editionId = S.editions[0]?.id ?? null;
    await loadEditionDetails();
    renderSS(); refreshCounts();
    toast(`Édition ${ed.year} supprimée`, 'ok');
    navigate(SS_ROUTE);
  });
}

/* ---------- Délégation (une fois) : la zone, la barre d'actions et les tiroirs sont hors de #secret-santa ---------- */

/**
 * Clics de la section : routé par l'attribut data-ss-act (ou data-del-excl) du bouton.
 * La carte de base est téléversée ici (sélecteur de fichier, puis enregistrement de l'URL).
 */
async function onClick(ev) {
  const t = ev.target.closest('button, [data-del-excl]');
  if (!t) return;
  const ed = ssCurrent();
  if (t.dataset.delExcl) return deleteExclusion(t);
  const act = t.dataset.ssAct;
  // Ces actions portent sur l'édition courante : sans édition sélectionnée, on ne fait rien.
  if (!ed && ['draw', 'draw-manual', 'redraw', 'redraw-manual', 'card-upload', 'card-reset', 'delete'].includes(act)) return;
  if (act === 'new') return openCreate();
  if (act === 'excl-new') return openExcl();
  if (act === 'draw') return draw(t, ed);
  if (act === 'draw-manual') return drawManual(t, ed);
  if (act === 'redraw' || act === 'redraw-manual') {
    if (!isGodMode() || !ed.drawn_at) return; // refaire le tirage : mode sans limite et tirage déjà fait
    return redraw(t, ed, act === 'redraw-manual');
  }
  if (act === 'card-upload') {
    const file = await pickFile($('#ss-card-file'));
    if (!file) return;
    return busy(t, async () => {
      const url = await uploadAsset(`cartes/base-${ed.year}`, file);
      check(await sb.from('hg_ss_editions').update({ card_base_url: url }).eq('id', ed.id));
      await loadEditions(); renderSS();
      toast('Carte de base mise à jour', 'ok');
    });
  }
  if (act === 'card-reset') {
    if (!(await confirmBox('Revenir à la carte par défaut ?', 'La carte dessinée automatiquement sera utilisée. Le fichier téléversé reste stocké.', { ok: 'Revenir au défaut' }))) return;
    return busy(t, async () => {
      check(await sb.from('hg_ss_editions').update({ card_base_url: null }).eq('id', ed.id));
      await loadEditions(); renderSS();
      toast('Carte par défaut rétablie', 'ok');
    });
  }
  if (act === 'delete') { if (ed) await deleteEdition(t, ed); }
}

/**
 * Liaison unique : clics (délégation sur le document), édition depuis l'en-tête, rafraîchissement mode sans limite.
 * Appelée par admin.js si l'administrateur a le droit Secret Santa ; sans effet au second appel.
 */
export function bindSecretSanta() {
  if (bound) return;
  bound = true;
  SSV.onEdit = (ed) => openEdit(ed);
  document.addEventListener('click', onClick);
  window.addEventListener('hg:godmode', () => { if (S.ssLoaded) renderSS(); });
}
