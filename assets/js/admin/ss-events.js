// Admin : actions de la section Secret Santa (édition, carte de base, tirage, refaire le tirage, exclusions).
import { sb, toast, errMsg, $, isGodMode, notify } from '../core.js';
import { confirmBox } from '../ui-confirm.js';
import { confirmRedo } from '../admin-godmode.js';
import { openManualDraw } from '../admin-ss-manual.js';
import { readSharedFields } from '../admin-accounts.js';
import { S, pseudoOf, STATUS_LABEL } from './state.js';
import { busy, check, uploadAsset, pickFile, nullIfEmpty } from './common.js';
import { loadEditions, loadEditionDetails } from './loaders.js';
import { renderStats } from './overview.js';
import { renderSS } from './ss-render.js';

export function bindSecretSanta() {
  $('#secret-santa').addEventListener('change', async (ev) => {
    if (ev.target.id !== 'ss-edition') return;
    S.editionId = ev.target.value;
    try { await loadEditionDetails(); } catch (e) { toast(errMsg(e), 'error'); }
    renderSS();
  });

  $('#secret-santa').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const form = ev.target, btn = ev.submitter;
    if (form.id === 'ss-create') {
      busy(btn, async () => {
        const fd = new FormData(form);
        const year = Number(fd.get('year'));
        if (S.editions.some((e) => e.year === year)) throw new Error(`L'édition ${year} existe déjà.`);
        const openEd = S.editions.find((e) => e.status !== 'termine');
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
        S.editionId = row.id;
        await loadEditions(); await loadEditionDetails();
        renderSS(); renderStats();
        toast(`Édition ${year} créée, inscriptions ouvertes`, 'ok');
      });
    }
    if (form.id === 'ss-edit') {
      busy(btn, async () => {
        const fd = new FormData(form);
        const ed = S.editions.find((e) => e.id === S.editionId);
        const status = fd.get('status');
        if (status !== ed.status && ['envoi', 'revelation', 'termine'].includes(status) && !ed.drawn_at && !isGodMode()) {
          if (!(await confirmBox('Aucun tirage effectué', `Passer en « ${STATUS_LABEL[status]} » sans tirage ? Les participants n'auront pas de cible.`, { ok: 'Changer quand même' }))) return;
        }
        if (status === 'revelation' && ed.status !== 'revelation') {
          if (!(await confirmBox('Passer à la révélation ?', 'Tous les membres pourront voir qui offrait à qui.', { ok: 'Révéler' }))) return;
        }
        check(await sb.from('hg_ss_editions').update({
          status, budget: nullIfEmpty(fd.get('budget')),
          send_deadline: nullIfEmpty(fd.get('send_deadline')), exchange_date: nullIfEmpty(fd.get('exchange_date')),
          shared_fields: readSharedFields(form),
        }).eq('id', ed.id));
        await loadEditions(); renderSS(); renderStats();
        toast('Édition enregistrée', 'ok');
      });
    }
    if (form.id === 'ss-excl-form') {
      busy(btn, async () => {
        let a = $('#ex-a').value, b = $('#ex-b').value;
        if (!a || !b || a === b) throw new Error('Choisis deux personnes différentes.');
        if (a > b) [a, b] = [b, a];
        if (S.exclusions.some((x) => (x.user_a === a && x.user_b === b) || (x.user_a === b && x.user_b === a))) throw new Error('Cette exclusion existe déjà.');
        check(await sb.from('hg_ss_exclusions').insert({ edition_id: S.editionId, user_a: a, user_b: b }));
        await loadEditionDetails(); renderSS();
        toast('Exclusion ajoutée', 'ok');
      });
    }
  });

  $('#secret-santa').addEventListener('click', async (ev) => {
    const t = ev.target.closest('button');
    if (!t) return;
    const ed = S.editions.find((e) => e.id === S.editionId);
    if (t.dataset.delExcl) {
      const [a, b] = t.dataset.delExcl.split('|');
      await busy(t, async () => {
        check(await sb.from('hg_ss_exclusions').delete().eq('edition_id', S.editionId).eq('user_a', a).eq('user_b', b));
        await loadEditionDetails(); renderSS();
        toast('Exclusion retirée', 'ok');
      });
    }
    if (t.id === 'ss-card-upload') {
      const file = await pickFile($('#ss-card-file'));
      if (!file) return;
      await busy(t, async () => {
        const url = await uploadAsset(`cartes/base-${ed.year}`, file);
        check(await sb.from('hg_ss_editions').update({ card_base_url: url }).eq('id', ed.id));
        await loadEditions(); renderSS();
        toast('Carte de base mise à jour', 'ok');
      });
    }
    if (t.id === 'ss-card-reset') {
      if (!(await confirmBox('Revenir à la carte par défaut ?', 'La carte dessinée automatiquement sera utilisée. Le fichier téléversé reste stocké.', { ok: 'Revenir au défaut' }))) return;
      await busy(t, async () => {
        check(await sb.from('hg_ss_editions').update({ card_base_url: null }).eq('id', ed.id));
        await loadEditions(); renderSS();
        toast('Carte par défaut rétablie', 'ok');
      });
    }
    if (t.id === 'ss-delete') { await deleteEdition(t, ed); return; }
    if (t.id === 'ss-redraw' || t.id === 'ss-redraw-manual') {
      if (!isGodMode() || !ed.drawn_at) return;
      await redraw(t, ed, t.id === 'ss-redraw-manual');
      return;
    }
    if (t.id === 'ss-draw-manual') {
      if (ed.drawn_at) return;
      await busy(t, () => openManualDraw({
        edition: ed, participants: S.participants.map((p) => p.user_id), exclusions: S.exclusions, editions: S.editions, pseudoOf,
        onDone: async (count) => {
          S.lastDraw = { edition: ed.id, n: count };
          await loadEditions(); renderSS(); renderStats();
          toast(`Tirage manuel enregistré pour ${count} participants`, 'ok');
        },
      }));
      return;
    }
    if (t.id === 'ss-draw') {
      if (ed.drawn_at) return; // un seul tirage par édition
      const n = S.participants.length;
      const msg = isGodMode()
        ? `${n} participants. Mode sans limite : les ${S.exclusions.length} exclusion${S.exclusions.length > 1 ? 's' : ''} et la cible de l'an dernier sont ignorées.\nTu pourras refaire le tirage tant que le mode est actif.\nL'édition passera en « Envoi des cadeaux » et les participants seront prévenus par le bot.`
        : `${n} participants, ${S.exclusions.length} exclusion${S.exclusions.length > 1 ? 's' : ''}.\nLe tirage est définitif : il ne pourra pas être relancé. Vérifie les inscrits et les exclusions avant.\nL'édition passera en « Envoi des cadeaux » et les participants seront prévenus par le bot.`;
      if (!(await confirmBox('Lancer le tirage ?', msg, { ok: 'Lancer le tirage' }))) return;
      await busy(t, async () => {
        const count = check(await sb.rpc('hg_ss_draw', { p_edition: ed.id }));
        S.lastDraw = { edition: ed.id, n: count };
        notify('ss_draw', { edition_id: ed.id }); // le bot prévient (sans jamais révéler les paires)
        await loadEditions(); renderSS(); renderStats();
        toast(`Tirage OK pour ${count} participants`, 'ok');
      });
    }
  });
  window.addEventListener('hg:godmode', () => { if (S.ssLoaded) renderSS(); });
}

/* Suppression d'une édition : la base supprime en cascade inscrits, exclusions, attributions, vœux,
   conversations de l'édition et leurs messages. Le détail est compté avant la confirmation. */
async function deleteEdition(btn, ed) {
  const count = (table) => sb.from(table).select('*', { count: 'exact', head: true }).eq('edition_id', ed.id)
    .then((r) => { if (r.error) throw r.error; return r.count ?? 0; });
  let assign, wishes, convs;
  try { [assign, wishes, convs] = await Promise.all([count('hg_ss_assignments'), count('hg_ss_wishes'), count('hg_conversations')]); }
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
    renderSS(); renderStats();
    toast(`Édition ${ed.year} supprimée`, 'ok');
  });
}

/* Mode sans limite : refaire le tirage (suppression des attributions puis nouveau tirage auto ou manuel) */
async function deleteAssignments(ed) {
  check(await sb.from('hg_ss_assignments').delete().eq('edition_id', ed.id));
}
async function afterFailedRedraw(ed) {
  // Attributions supprimées mais nouveau tirage refusé : l'édition redevient « sans tirage » pour pouvoir relancer.
  try { check(await sb.from('hg_ss_editions').update({ drawn_at: null }).eq('id', ed.id)); } catch (e) { console.warn('[tirage] remise à zéro', e); }
  await loadEditions(); renderSS(); renderStats();
}
async function redraw(btn, ed, manual) {
  const n = S.participants.length;
  if (manual) {
    await busy(btn, () => openManualDraw({
      edition: ed, participants: S.participants.map((p) => p.user_id), exclusions: S.exclusions, editions: S.editions, pseudoOf,
      redo: {
        confirm: () => confirmRedo({ year: ed.year, participants: n, manual: true }),
        before: () => deleteAssignments(ed),
        onFail: () => afterFailedRedraw(ed),
      },
      onDone: async (count) => {
        S.lastDraw = { edition: ed.id, n: count };
        await loadEditions(); renderSS(); renderStats();
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
    await loadEditions(); renderSS(); renderStats();
    toast(`Nouveau tirage OK pour ${count} participants`, 'ok');
  });
}
