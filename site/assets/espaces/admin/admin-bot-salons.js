// ===== Humane Gang — administration : bot Discord, onglet « Salons » (admin-bot.js) =====
// Salons connus (ajout, retrait, enregistrement immédiat) et salons par type d’annonce (matrice de cases à cocher).
// Exporte : montageSalons(c). Contexte c : voir admin-bot.js.

import { sb, toast, esc, $ } from '../../commun/core.js';
import { CHAN_MAX, DISCORD_ID, MENTION_TYPES, SALONS_MAX, SALON_NAME_MAX, check, norm } from './admin-bot-commun.js';

export function montageSalons(c) {
  const { S, api, assertLoaded, chanOf, container } = c;
  /** Brouillon des salons : copie des salons connus et des salons par type enregistrés, puis redessin de l'onglet Salons. */
  function resetDraft() {
    S.salonDraft = {
      salons: S.bot.salons.map((s) => ({ ...s })),
      channels: Object.fromEntries(Object.entries(S.bot.channels ?? {}).map(([k, v]) => [k, [...v]])),
    };
    S.salonAsk = null;
    renderSalons(); renderChannelsUI(); api.syncMentionControls();
  }

  /* ---------- Salons connus : liste, ajout, retrait ---------- */
  /** Forme canonique des salons par type (ordre des types fixe), pour comparer le brouillon à l'enregistré. */
  const canonChan = (c) => JSON.stringify(MENTION_TYPES.map(([k]) => c?.[k] ?? []));
  /** Vrai si le brouillon des salons diffère de ce qui est enregistré. */
  const draftDirty = () => JSON.stringify(S.salonDraft.salons) !== JSON.stringify(S.bot.salons) || canonChan(S.salonDraft.channels) !== canonChan(S.bot.channels);
  /** Affiche ou masque la mention « modifications non enregistrées » de l'onglet Salons. */
  function syncDirty() { $('#bot-salons-dirty', container).hidden = !draftDirty(); }
  /** Dessine la liste des salons connus : nom, ID et bouton Retirer. Le retrait demande confirmation sur place. */
  function renderSalons() {
    const list = $('#bot-salon-list', container), salons = S.salonDraft.salons;
    $('#bot-salon-none', container).hidden = salons.length > 0;
    list.innerHTML = salons.map((s) => {
      const ask = S.salonAsk === s.id, nom = esc(s.nom), id = esc(s.id);
      return `<li class="salon-row${ask ? ' is-ask' : ''}">
        ${ask ? `<div class="salon-ask" role="group" aria-label="Confirmer le retrait de ${nom}">
            <span>Retirer <strong>${nom}</strong> ? Il sera décoché partout.</span>
            <span class="btn-row"><button type="button" class="btn btn-ghost btn-sm" data-salon-no="${id}">Annuler</button><button type="button" class="btn btn-sm bot-danger" data-salon-yes="${id}">Retirer le salon</button></span>
          </div>`
    : `<span class="salon-main"><span class="salon-name">${nom}</span><code class="salon-id">${id}</code></span>
            <button type="button" class="btn btn-ghost btn-sm" data-salon-ask="${id}" aria-label="Retirer le salon ${nom}">Retirer</button>`}
      </li>`;
    }).join('');
    if (S.salonAsk) list.querySelector(`[data-salon-no="${S.salonAsk}"]`)?.focus();
    syncDirty();
  }
  // Retrait : premier clic = confirmation en ligne ; « Annuler » rend le focus au bouton Retirer.
  $('#bot-salon-list', container).addEventListener('click', (ev) => {
    const ask = ev.target.closest('[data-salon-ask]'), yes = ev.target.closest('[data-salon-yes]'), no = ev.target.closest('[data-salon-no]');
    if (ask) { S.salonAsk = ask.dataset.salonAsk; renderSalons(); }
    else if (no) { S.salonAsk = null; renderSalons(); $(`[data-salon-ask="${no.dataset.salonNo}"]`, container)?.focus(); }
    else if (yes) removeSalon(yes.dataset.salonYes);
  });
  /**
   * Enregistre tout de suite les salons connus et les salons par type (brouillon de l'onglet Salons) dans hg_settings.bot,
   * sans toucher aux autres réglages. Appelé à chaque ajout, retrait ou case cochée : rien ne se perd en changeant de page.
   * @param {string} okMsg message affiché après l'enregistrement
   * @returns {Promise<boolean>} vrai si l'enregistrement a réussi
   */
  async function persistSalons(okMsg) {
    try {
      assertLoaded();
      const d = S.salonDraft;
      const salons = d.salons.map((x) => ({ id: x.id, nom: x.nom }));
      const channels = {};
      for (const [k] of MENTION_TYPES) {
        const list = (d.channels[k] ?? []).filter((id) => salons.some((x) => x.id === id)).slice(0, CHAN_MAX);
        if (list.length) channels[k] = list;
      }
      const value = { ...S.bot, salons, channels, birthday_channel_id: channels.birthday?.[0] ?? null };
      check(await sb.from('hg_settings').upsert({ key: 'bot', value, updated_at: new Date().toISOString() }));
      S.bot = value;
      syncDirty();
      api.syncChannelOption();
      api.renderAnnChannels();
      if (okMsg) toast(okMsg, 'ok');
      return true;
    } catch (e) {
      toast(`Salons non enregistrés : ${e?.message || e}`, 'error');
      syncDirty();
      return false;
    }
  }
  /** Retire un salon du brouillon et le décoche partout (salons par type). Le retrait part avec « Enregistrer ». */
  function removeSalon(id) {
    const d = S.salonDraft;
    const idx = d.salons.findIndex((s) => s.id === id);
    d.salons = d.salons.filter((s) => s.id !== id);
    for (const k of Object.keys(d.channels)) {
      d.channels[k] = d.channels[k].filter((x) => x !== id);
      if (!d.channels[k].length) delete d.channels[k];
    }
    S.salonAsk = null;
    // Focus : le bouton « Retirer » de la ligne suivante (ou de la précédente), sinon le champ d'ajout de salon.
    const next = d.salons[idx] ?? d.salons[idx - 1];
    renderSalons(); renderChannelsUI(); api.syncMentionControls();
    (next ? $(`[data-salon-ask="${next.id}"]`, container) : $('#bot-salon-name', container))?.focus();
    persistSalons('Salon retiré et enregistré');
  }
  /**
   * Ajoute un salon au brouillon après contrôle : nom de 1 à 50 caractères, ID de 17 à 20 chiffres,
   * sans doublon d'ID ni de nom, 25 salons au plus. L'erreur s'affiche sous le formulaire.
   */
  function addSalon() {
    const nameEl = $('#bot-salon-name', container), idEl = $('#bot-salon-id', container), box = $('#bot-salon-err', container);
    const nom = nameEl.value.trim(), id = idEl.value.trim(), d = S.salonDraft;
    const [err, field] = !nom ? ['Donne un nom au salon.', nameEl]
      : nom.length > SALON_NAME_MAX ? [`Le nom fait au plus ${SALON_NAME_MAX} caractères.`, nameEl]
        : !DISCORD_ID.test(id) ? ['L\'ID du salon doit être un nombre de 17 à 20 chiffres.', idEl]
          : d.salons.some((s) => s.id === id) ? ['Ce salon est déjà dans la liste (même ID).', idEl]
            : d.salons.some((s) => norm(s.nom) === norm(nom)) ? ['Un salon porte déjà ce nom dans la liste.', nameEl]
              : d.salons.length >= SALONS_MAX ? [`${SALONS_MAX} salons maximum : retire-en un avant d'en ajouter.`, nameEl]
                : ['', null];
    nameEl.setAttribute('aria-invalid', String(field === nameEl));
    idEl.setAttribute('aria-invalid', String(field === idEl));
    box.textContent = err;
    box.hidden = !err;
    if (err) { field.focus(); return; }
    d.salons.push({ id, nom });
    nameEl.value = ''; idEl.value = '';
    renderSalons(); renderChannelsUI(); api.syncMentionControls();
    persistSalons('Salon ajouté et enregistré');
    nameEl.focus();
  }
  $('#bot-salon-add', container).addEventListener('click', addSalon);
  // Entrée dans un champ valide le salon sans envoyer le formulaire des réglages.
  for (const sel of ['#bot-salon-name', '#bot-salon-id']) {
    $(sel, container).addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addSalon(); } });
  }

  /* ---------- Salon par type d'annonce : matrice (une ligne par type, une colonne par salon connu) ---------- */
  /** Dessine la matrice : une ligne par type d'annonce, une case par salon connu (5 au plus par type), et la colonne « Par défaut ». */
  function renderChannelsUI() {
    const box = $('#bot-chan-list', container), salons = S.salonDraft.salons;
    if (!salons.length) {
      box.innerHTML = '<p class="small muted">Ajoute d\'abord un salon ci-dessus. Sans salon, les annonces partent dans le salon d\'annonces par défaut.</p>';
      return;
    }
    box.innerHTML = `<div class="chan-wrap"><table class="chan-table">
        <thead><tr><th scope="col">Type d'annonce</th>${salons.map((s) => `<th scope="col"><span title="${esc(s.nom)}">${esc(s.nom)}</span></th>`).join('')}<th scope="col" class="chan-def">Par défaut</th></tr></thead>
        <tbody>${MENTION_TYPES.map(([k, label]) => `<tr id="bot-chan-${k}">
          <th scope="row"><span class="chan-type-name">${esc(label)}</span> <span class="muted small chan-count" id="bot-chan-n-${k}"></span></th>
          ${salons.map((s) => `<td><input type="checkbox" name="chan_${k}" value="${esc(s.id)}" aria-label="${esc(label)} dans ${esc(s.nom)}"${chanOf(k).includes(s.id) ? ' checked' : ''}></td>`).join('')}
          <td class="chan-def"><span class="small muted chan-hint" id="bot-chan-h-${k}"></span></td>
        </tr>`).join('')}</tbody>
      </table></div>`;
    for (const [k] of MENTION_TYPES) chanCount(k);
  }
  /** Compteur « n / 5 » d'un type, et rappel du salon d'annonces quand aucune case n'est cochée. */
  function chanCount(k) {
    const n = chanOf(k).length;
    $(`#bot-chan-n-${k}`, container).textContent = `${n} / ${CHAN_MAX}`;
    $(`#bot-chan-h-${k}`, container).textContent = n ? '' : 'Aucun salon coché : salon d\'annonces par défaut.';
  }
  // Case cochée : 5 salons au plus par type ; décocher retire le salon de ce type.
  $('#bot-chan-list', container).addEventListener('change', (ev) => {
    const cb = ev.target;
    if (!(cb instanceof HTMLInputElement) || cb.type !== 'checkbox' || !cb.name.startsWith('chan_')) return;
    const k = cb.name.slice(5), d = S.salonDraft.channels, list = d[k] ?? [];
    if (cb.checked) {
      if (list.length >= CHAN_MAX) { cb.checked = false; toast(`${CHAN_MAX} salons maximum par type d'annonce`, 'error'); return; }
      d[k] = [...list, cb.value];
    } else {
      d[k] = list.filter((x) => x !== cb.value);
      if (!d[k].length) delete d[k];
    }
    chanCount(k); api.syncMentionControls(); syncDirty();
    persistSalons('');
  });


  Object.assign(api, { resetDraft });
}
