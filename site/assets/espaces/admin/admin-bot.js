// ===== Humane Gang — administration : bot Discord (page et sous-onglets) =====
// Page « Bot Discord » (sept sous-onglets, dans l’ordre) : Connexion, Salons, Mentions, Annonces, Messages privés, Messages types,
// Règles (trois parties : Rappels et envois, Assistance, Planning). Chaque onglet est un module :
//   admin-bot-connexion.js, admin-bot-salons.js, admin-bot-mentions.js, admin-bot-annonces.js, admin-bot-mp.js,
//   admin-bot-modeles.js, admin-bot-regles.js ; les constantes et helpers communs sont dans admin-bot-commun.js.
// Ce fichier : squelette HTML de la page, sous-onglets (ARIA, clavier, mémorisation), contexte partagé, chargement des données.
// Réglages stockés dans hg_settings.bot : salons = liste d’objets { id, nom } ; channels[type] = tableau d’IDs de salons
// (5 au plus par type). Ancienne forme (une chaîne, ou birthday_channel_id) lue en repli.
// Dépendances : core.js (Supabase, toast, appel des fonctions edge, avatar, logo), icons.js, utils.js (pluriels),
// admin/list-tools.js (recherche, pagination), admin/ui/drawer.js (tiroir).
// Tables, RPC et stockage : hg_settings (bot, bot_templates, support, planning), hg_bot_log (historique), hg_profiles
// (destinataires), bucket hg-bot-media (pièces jointes), fonctions edge hg-notify et hg-bot-templates.
// Exporte : mountBotSection (montage de la page).

import { sb, toast, errMsg, esc, $ } from '../../commun/core.js';
import { PAGE_SIZE } from './list-tools.js';
import { DISCORD_ID, ICON, MANUAL_BODY_MAX, MANUAL_TITLE_MAX, MENTION_MODES, MENTION_TYPES, NOTIFY, SALONS_MAX, SALON_NAME_MAX, attachFieldHtml, check, fnError, normalizeBot } from './admin-bot-commun.js';
import { montageConnexion } from './admin-bot-connexion.js';
import { montageSalons } from './admin-bot-salons.js';
import { montageMentions } from './admin-bot-mentions.js';
import { montageRegles, RULE_SUBS, rulesCardHtml, supportCardHtml, planningCardHtml } from './admin-bot-regles.js';
import { montageModeles } from './admin-bot-modeles.js';
import { montageMp } from './admin-bot-mp.js';
import { montageAnnonces } from './admin-bot-annonces.js';

// Adresse du fichier de modèles partagé avec les fonctions edge (textes par défaut des messages types).
// Copié dans le site au moment de la publication (.github/workflows/publier-site.yml) depuis supabase/functions/_shared/.
const TEMPLATES_URL = new URL('./bot-templates.json', import.meta.url).href;

// Sous-onglets de la page : [identifiant, libellé]. L'ordre est celui de l'affichage et des flèches clavier.
const BOT_TABS = [['connexion', 'Connexion'], ['salons', 'Salons'], ['mentions', 'Mentions'], ['annonces', 'Annonces'], ['mp', 'Messages privés'], ['modeles', 'Messages types'], ['regles', 'Règles']];
// Sous-onglets dont les réglages sont dans le formulaire #bot-form (enregistrés ensemble).
const SETTINGS_TABS = ['connexion', 'salons', 'mentions'];
// Clé du dernier sous-onglet ouvert, dans le stockage du navigateur (la page fonctionne sans).
const TAB_KEY = 'hg-admin-bot-tab';

/** Ajoute la feuille de style de la page du bot, une seule fois. */
function loadStyles() {
  if (document.querySelector('link[data-admin-bot]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = new URL('./admin-bot.css', import.meta.url).href; l.dataset.adminBot = '';
  document.head.append(l);
}


/**
 * Affiche la page du bot dans le conteneur et branche ses sections (réglages, modèles, envoi manuel, historique).
 * Les réglages et les modèles sont chargés depuis la base au montage.
 * @param {HTMLElement} container Élément qui recevra la page.
 */
export function mountBotSection(container) {
  if (!container) return;
  loadStyles();
  // État de la page : réglages du bot, assistance et planning, filtres de l'historique, modèles (défauts, personnalisés, brouillons),
  // destinataires choisis et pièces jointes du message manuel.
  let settingsLoaded = false; // vrai une fois hg_settings lu : sans lecture, aucune écriture (sinon les réglages seraient écrasés)
  const S = {
    bot: { announce_channel_id: null, birthday_channel_id: null, channels: {}, salons: [], admin_discord_id: null, mention_role_id: null, mentions: {}, notify: {} },
    salonDraft: { salons: [], channels: {} }, // salons connus et salons par type en cours d'édition (enregistrés avec « Enregistrer »)
    salonAsk: null, // identifiant du salon dont le retrait attend une confirmation
    tab: 'connexion', // sous-onglet affiché
    annSel: new Set(), annInit: false, annSending: false, // annonce libre : salons cochés, premier passage, envoi en cours
    support: {}, planning: {},
    histFilter: 'all', histQ: '', histLimit: PAGE_SIZE, histMore: false,
    defs: null, custom: {}, drafts: new Map(), current: null, lastField: 'body',
    people: [], pseudo: new Map(), selected: new Set(), q: '', history: null, sending: false,
  };


  // Squelette HTML de la page : sous-onglets, puis un panneau par onglet. Les formulaires et champs gardent leurs identifiants.
  container.innerHTML = `
    <div class="bot-admin">
      <div class="bot-tabs" id="bot-tablist" role="tablist" aria-label="Sections du bot Discord">
        ${BOT_TABS.map(([id, label]) => `<button type="button" role="tab" class="bot-tab" id="bot-tab-${id}" data-tab="${id}" aria-controls="bot-p-${id}" aria-selected="false" tabindex="-1">${esc(label)}</button>`).join('')}
      </div>

      <form class="bot-settings" id="bot-form" novalidate>
        <section class="card stack bot-panel" role="tabpanel" id="bot-p-connexion" aria-labelledby="bot-tab-connexion">
          <div>
            <h3 class="card-title">Connexion</h3>
            <p class="muted small">Le jeton du bot n'est jamais stocké ici : il se règle dans les secrets Supabase. Toute la marche à suivre est dans le <a href="https://github.com/domursan/human-gang/blob/main/docs/BOT.md" target="_blank" rel="noopener">guide du bot</a>.</p>
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="bot-channel">ID du salon d'annonces</label>
              <input id="bot-channel" name="announce_channel_id" inputmode="numeric" autocomplete="off" placeholder="ex. 112233445566778899">
            </div>
            <div class="field">
              <label for="bot-admin">Ton ID Discord (MP assistance)</label>
              <input id="bot-admin" name="admin_discord_id" inputmode="numeric" autocomplete="off" placeholder="ex. 998877665544332211">
            </div>
          </div>
          <div class="field">
            <label for="bot-role">ID du rôle à mentionner <span class="muted small">(facultatif)</span></label>
            <input id="bot-role" name="mention_role_id" inputmode="numeric" autocomplete="off" placeholder="ex. 445566778899001122" aria-describedby="bot-role-hint">
            <p class="small muted" id="bot-role-hint">Dans Discord, active le <em>mode développeur</em> (Paramètres › Avancés), puis fais un clic droit sur le rôle › <em>Copier l'identifiant</em>.</p>
          </div>
          <fieldset class="toggles">
            <legend class="label">Notifications envoyées</legend>
            <div class="notif-grid">
              ${NOTIFY.map(([k, label, hint]) => `<label class="switch"><input type="checkbox" role="switch" name="${k}"><span class="switch-ui" aria-hidden="true"></span><span>${esc(label)} <span class="muted small">${esc(hint)}</span></span></label>`).join('')}
            </div>
          </fieldset>
          <div class="btn-row">
            <button class="btn btn-primary" type="submit">Enregistrer</button>
            <label class="small muted" for="bot-test-type">Tester le salon</label>
            <select id="bot-test-type" name="test_type">
              <option value="">Salon d'annonces</option>
              ${MENTION_TYPES.map(([k, label]) => `<option value="${k}">${esc(label)}</option>`).join('')}
            </select>
            <button class="btn btn-ghost" type="button" id="bot-test">Envoyer un message de test</button>
          </div>
        </section>

        <section class="card stack bot-panel" role="tabpanel" id="bot-p-salons" aria-labelledby="bot-tab-salons" hidden>
          <div>
            <h3 class="card-title">Salons</h3>
            <p class="muted small">Les salons où le bot publie. Ajoute-les ici (${SALONS_MAX} au plus), puis coche, pour chaque type d'annonce, les salons où elle part. Chaque changement est enregistré tout de suite.</p>
          </div>
          <div class="salon-block">
            <h4 class="label" id="bot-salons-h">Salons connus</h4>
            <ul class="salon-list" id="bot-salon-list" aria-labelledby="bot-salons-h"></ul>
            <p class="small muted" id="bot-salon-none" hidden>Aucun salon pour l'instant.</p>
            <div class="salon-add">
              <div class="field">
                <label for="bot-salon-name">Nom du salon</label>
                <input id="bot-salon-name" maxlength="${SALON_NAME_MAX}" autocomplete="off" placeholder="ex. annonces">
              </div>
              <div class="field">
                <label for="bot-salon-id">ID du salon</label>
                <input id="bot-salon-id" inputmode="numeric" autocomplete="off" placeholder="ex. 112233445566778899" aria-describedby="bot-salon-hint">
              </div>
              <p class="small muted salon-add-help" id="bot-salon-hint">Dans Discord, active le <em>mode développeur</em>, puis fais un clic droit sur le salon › <em>Copier l'identifiant</em>.</p>
              <button type="button" class="btn btn-ghost" id="bot-salon-add">${ICON.plus}Ajouter un salon</button>
            </div>
            <p class="bot-salon-err" id="bot-salon-err" role="alert" hidden></p>
          </div>
          <fieldset class="channels" id="bot-channels">
            <legend class="label">Où part chaque type d'annonce</legend>
            <p class="small muted">Coche les salons où part chaque annonce (<strong>5 au plus par type</strong>). <strong>Aucune case cochée = salon d'annonces par défaut.</strong> Les messages privés ne sont pas concernés.</p>
            <div id="bot-chan-list"></div>
          </fieldset>
          <p class="small muted" id="bot-salons-dirty" role="status" hidden>Modifications non enregistrées : pense à enregistrer.</p>
          <div class="btn-row"><button class="btn btn-primary" type="submit">Enregistrer</button></div>
        </section>

        <section class="card stack bot-panel" role="tabpanel" id="bot-p-mentions" aria-labelledby="bot-tab-mentions" hidden>
          <fieldset class="mentions" id="bot-mentions">
            <legend class="label">Mention dans le salon de l'annonce</legend>
            <p class="small muted">« Le rôle » notifie les membres de ce rôle. <strong>« @everyone » notifie tout le serveur</strong> : à réserver aux annonces vraiment importantes. Par défaut, aucune mention.</p>
            <p class="small muted" id="bot-mentions-off" hidden>Renseigne d'abord un salon (d'annonces ou par type) pour choisir une mention.</p>
            <div class="mention-list">
              ${MENTION_TYPES.map(([k, label]) => `<div class="mention-row">
                <label for="bot-mention-${k}">${esc(label)}</label>
                <select id="bot-mention-${k}" name="mention_${k}">${MENTION_MODES.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select>
              </div>`).join('')}
            </div>
          </fieldset>
          <div class="btn-row"><button class="btn btn-primary" type="submit">Enregistrer</button></div>
        </section>
      </form>

      <section class="bot-panel" role="tabpanel" id="bot-p-annonces" aria-labelledby="bot-tab-annonces" hidden>
        <div class="card stack ann-card" id="ann-card">
          <div>
            <h3 class="card-title">Annonce libre</h3>
            <p class="muted small">Un message publié dans les salons choisis, sans MP. Les salons se règlent dans l'onglet Salons. Pour écrire à des membres, voir Messages privés.</p>
          </div>
          <div class="bm-layout">
            <fieldset class="bm-recipients" id="ann-channels">
              <legend class="label">Salons</legend>
              <p class="small muted bm-count" id="ann-chan-count" aria-live="polite"></p>
              <div class="bm-list" id="ann-chan-list"></div>
              <p class="small muted" id="ann-chan-none" hidden>Aucun salon disponible. Ajoute-en dans l'onglet Salons, ou renseigne le salon d'annonces par défaut dans Connexion.</p>
            </fieldset>
            <form class="bm-compose stack" id="ann-form" novalidate>
              <div class="field bm-mention-field">
                <label for="ann-mention">Mention dans le salon</label>
                <select id="ann-mention" name="ann_mention" aria-describedby="ann-mention-hint">
                  ${MENTION_MODES.map(([v, t]) => `<option value="${v}">${esc(v === 'everyone' ? '@everyone (tout le serveur)' : t)}</option>`).join('')}
                </select>
                <p class="small muted" id="ann-mention-hint"></p>
              </div>
              <div class="field">
                <div class="bt-label-row"><label for="ann-title">Titre <span class="muted small">(facultatif)</span></label><span class="muted small bt-count" id="ann-title-count"></span></div>
                <input id="ann-title" maxlength="${MANUAL_TITLE_MAX}" autocomplete="off" placeholder="ex. Info importante">
              </div>
              <div class="field">
                <div class="bt-label-row"><label for="ann-text">Message</label><span class="muted small bt-count" id="ann-text-count"></span></div>
                <textarea id="ann-text" rows="6" maxlength="${MANUAL_BODY_MAX}" aria-describedby="ann-text-hint" placeholder="Bonjour à tous !"></textarea>
                <p class="small muted" id="ann-text-hint">Dans le salon, <code>{pseudo}</code> devient « tout le monde ». Mise en forme Discord possible : <code>**gras**</code>.</p>
              </div>
              ${attachFieldHtml('ann-')}
              <div class="bt-preview">
                <div class="bt-preview-head"><span class="label">Aperçu</span><span class="muted small" id="ann-preview-for"></span></div>
                <div id="ann-preview" aria-live="polite"></div>
              </div>
              <div class="btn-row">
                <button type="submit" class="btn btn-primary" id="ann-send">${ICON.send}Publier</button>
              </div>
              <div id="ann-result" class="bm-result" aria-live="polite"></div>
            </form>
          </div>
        </div>
      </section>

      <section class="bot-panel" role="tabpanel" id="bot-p-mp" aria-labelledby="bot-tab-mp" hidden>
        <div class="card stack bm-card" id="bm-card">
          <div>
            <h3 class="card-title">Envoyer un message</h3>
            <p class="muted small">Message privé du bot aux comptes choisis. Les membres qui ont refusé les MP du bot ou sans ID Discord ne peuvent pas être sélectionnés.</p>
          </div>
          <div id="bm-body"><div class="empty">Chargement des comptes…</div></div>
          <details class="bm-history" id="bm-history">
            <summary>Historique des envois</summary>
            <div class="filters bm-hist-filters" role="group" aria-label="Filtrer l'historique" id="bm-hist-filters">
              <button class="chip" type="button" data-hf="all" aria-pressed="true">Toutes</button>
              <button class="chip" type="button" data-hf="failed" aria-pressed="false">Échecs</button>
            </div>
            <div id="bm-history-list" class="bm-history-list"><div class="empty">Chargement…</div></div>
            <p class="small muted">Chaque publication dans un salon est enregistrée avec son résultat (✓ ou ✗, et l'erreur). Les envois anciens n'ont que la mention « Salon ».</p>
          </details>
        </div>
      </section>

      <section class="bot-panel" role="tabpanel" id="bot-p-modeles" aria-labelledby="bot-tab-modeles" hidden>
        <div class="card stack bt-card" id="bt-card">
          <div>
            <h3 class="card-title">Messages types</h3>
            <p class="muted small bt-intro">Personnalise le texte de chaque message automatique. Les <strong>variables</strong> entre accolades (ex. <code>{pseudo}</code>) sont remplacées à l'envoi ; une variable non prévue pour ce message reste vide. Les champs fixes (budget, lieu…) ne sont pas modifiables.</p>
          </div>
          <div id="bt-body"><div class="empty">Chargement des modèles…</div></div>
        </div>
      </section>

      <section class="bot-panel" role="tabpanel" id="bot-p-regles" aria-labelledby="bot-tab-regles" hidden>
        <div class="bot-seg" role="group" aria-label="Partie des règles" id="bot-rsub">
          ${RULE_SUBS.map(([id, label]) => `<button type="button" class="chip" data-rsub="${id}" aria-pressed="false">${esc(label)}</button>`).join('')}
        </div>
        <div id="bot-r-rappels">${rulesCardHtml()}</div>
        <div id="bot-r-assistance" hidden>${supportCardHtml()}</div>
        <div id="bot-r-planning" hidden>${planningCardHtml()}</div>
      </section>
    </div>
    <dialog class="hg-dialog" id="bm-dlg" aria-labelledby="bm-dlg-t">
      <form method="dialog" class="stack">
        <h2 id="bm-dlg-t" class="dialog-title">Envoyer ce message ?</h2>
        <p id="bm-dlg-p" class="muted"></p>
        <div class="btn-row dialog-actions">
          <button class="btn btn-ghost" value="cancel" type="submit">Annuler</button>
          <button class="btn btn-primary" value="ok" type="submit">Envoyer</button>
        </div>
      </form>
    </dialog>`;


  // Formulaire des réglages généraux, et fenêtre de confirmation d'envoi (#bm-dlg).
  const form = $('#bot-form', container);
  const dlg = $('#bm-dlg', container);

  /** Réglages non chargés (lecture échouée) : aucune écriture, pour ne pas effacer les valeurs enregistrées. */
  function assertLoaded() { if (!settingsLoaded) throw new Error('Réglages non chargés : recharge la page avant de modifier.'); }
  /**
   * Action en cours : bouton désactivé avec indicateur, pas de second envoi. Reçoit un bouton, ou un formulaire
   * (soumission sans bouton connu) ; les boutons d'envoi du formulaire sont alors désactivés pendant l'action.
   */
  async function busy(btn, fn) {
    const isForm = btn instanceof HTMLFormElement;
    const el = isForm ? null : btn;
    const host = isForm ? btn : (el?.form ?? null);
    if (el?.dataset.busy || host?.dataset.busy) return undefined;
    const subs = host ? [...host.querySelectorAll('button:not([type]), button[type="submit"]')] : [];
    if (host) { host.dataset.busy = '1'; for (const b of subs) b.disabled = true; }
    if (el) { el.disabled = true; el.dataset.busy = '1'; el.classList.add('is-busy'); el.setAttribute('aria-busy', 'true'); }
    try { return await fn(); } catch (e) { toast(await fnError(e), 'error'); return undefined; } finally {
      if (el) { delete el.dataset.busy; el.classList.remove('is-busy'); el.removeAttribute('aria-busy'); if (el.isConnected) el.disabled = false; }
      if (host) { delete host.dataset.busy; for (const b of subs) if (b.isConnected) b.disabled = false; }
    }
  }
  /**
   * Ouvre la fenêtre de confirmation avec le texte donné.
   * @param {string} text Phrase qui résume l'envoi.
   * @returns {Promise<boolean>} true si l'admin clique « Envoyer ».
   */
  function confirmSend(text) {
    $('#bm-dlg-p', container).textContent = text;
    dlg.returnValue = '';
    dlg.showModal();
    return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }));
  }


  /* ======================= Sous-onglets ======================= */
  const tablist = $('#bot-tablist', container), botForm = form;
  /**
   * Affiche un sous-onglet : son panneau, l'état ARIA (aria-selected, tabindex) et le choix mémorisé dans ce navigateur.
   * @param {string} id Identifiant du sous-onglet (voir BOT_TABS).
   * @param {boolean} [focus] Vrai pour placer le focus sur l'onglet (navigation au clavier).
   */
  function showTab(id, focus = false) {
    S.tab = BOT_TABS.some(([t]) => t === id) ? id : 'connexion';
    for (const [t] of BOT_TABS) {
      const on = t === S.tab, btn = $(`#bot-tab-${t}`, container);
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
      $(`#bot-p-${t}`, container).hidden = !on;
    }
    botForm.hidden = !SETTINGS_TABS.includes(S.tab); // le formulaire des réglages n'enveloppe que ses trois panneaux
    try { localStorage.setItem(TAB_KEY, S.tab); } catch { /* stockage bloqué : le choix n'est pas gardé */ }
    if (focus) $(`#bot-tab-${S.tab}`, container).focus();
  }
  tablist.addEventListener('click', (ev) => { const b = ev.target.closest('[role="tab"]'); if (b) showTab(b.dataset.tab); });
  // Flèches gauche et droite (en boucle), Début et Fin : même comportement que les onglets de la page Cartes.
  tablist.addEventListener('keydown', (ev) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) return;
    const ids = BOT_TABS.map(([t]) => t), i = ids.indexOf(S.tab);
    const n = ev.key === 'ArrowRight' ? (i + 1) % ids.length
      : ev.key === 'ArrowLeft' ? (i - 1 + ids.length) % ids.length
        : ev.key === 'Home' ? 0 : ids.length - 1;
    ev.preventDefault();
    showTab(ids[n], true);
  });
  // Dernier sous-onglet ouvert, mémorisé dans ce navigateur (sans effet si le stockage est bloqué).
  let remembered = null;
  try { remembered = localStorage.getItem(TAB_KEY); } catch { /* stockage bloqué */ }
  showTab(remembered || 'connexion');

  /** Salons enregistrés pour un type, en cours d'édition (liste vide si aucun). */
  const chanOf = (k) => S.salonDraft.channels[k] ?? [];
  /** Mention d'un type (réglage) : « none » par défaut. */
  const mentionOf = (k) => (MENTION_MODES.some(([v]) => v === S.bot.mentions?.[k]) ? S.bot.mentions[k] : 'none');

  /** Nom d'un salon pour l'affichage : nom enregistré, ou « Salon d'annonces » / « Salon <id> ». */
  const salonName = (id) => S.bot.salons?.find((s) => s.id === id)?.nom ?? (id === S.bot.announce_channel_id ? 'Salon d\'annonces' : `Salon ${id}`);

  // Partagé entre les onglets (modules admin-bot-*.js) : l'état, le formulaire et les helpers de cette page.
  // api : fonctions d'un onglet appelées par un autre (renseignées au montage, appelées ensuite).
  const api = {};
  const c = { container, S, api, form, dlg, assertLoaded, busy, confirmSend, chanOf, mentionOf, salonName };
  montageConnexion(c);
  montageMentions(c);
  montageSalons(c);
  montageRegles(c);
  montageModeles(c);
  montageMp(c);
  montageAnnonces(c);

  /* ======================= Chargement ======================= */
  /** Lecture des réglages échouée : bandeau « recharge la page » et boutons d'enregistrement désactivés. */
  function lockUnloadedSettings(why) {
    container.querySelector('.bot-admin').insertAdjacentHTML('afterbegin', `<div class="bot-unloaded" role="alert">
        <span>Réglages non chargés : recharge la page avant de modifier.${why ? ` <span class="muted small">(${esc(why)})</span>` : ''}</span>
        <button type="button" class="btn btn-ghost btn-sm" id="bot-reload">Recharger</button></div>`);
    $('#bot-reload', container).addEventListener('click', () => location.reload());
    container.querySelectorAll('#bot-form button[type="submit"], #rules-form button[type="submit"], #support-cfg-form button[type="submit"], #planning-form button[type="submit"], [data-reset-group], #bot-salon-add')
      .forEach((b) => { b.disabled = true; });
  }
  (async () => {
    // Chargement : réglages, modèles, comptes et profils en parallèle. Chaque lot peut échouer sans bloquer les autres.
    const [settings, defs, accounts, profiles] = await Promise.allSettled([
      sb.from('hg_settings').select('key, value').in('key', ['bot', 'bot_templates', 'support', 'planning']).then(check),
      fetch(TEMPLATES_URL, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
      sb.rpc('hg_admin_accounts').then(check),
      sb.from('hg_profiles').select('id, pseudo, discord_id, bot_optin, avatar_url, color, is_admin, is_ghost').then(check),
    ]);

    // Réglages
    if (settings.status === 'fulfilled') {
      /** Valeur d'un réglage parmi les lignes chargées (undefined si absent). */
      const get = (k) => (settings.value ?? []).find((r) => r.key === k)?.value;
      S.bot = normalizeBot(get('bot') ?? S.bot);
      // Notifications activées par défaut ; l'échange conclu reste coupé par défaut. Les choix enregistrés priment.
      S.bot.notify = { draw: true, gift: true, irl: true, birthday: true, support: true, messages: true, card_pull: true, card_wish: true, card_trade: false, trade_offer: true, card_gift_admin: true, card_drop: true, quiz_daily: true, unwrap: false, ...(S.bot.notify || {}) };
      S.support = get('support') ?? {};
      S.planning = get('planning') ?? {};
      const modeles = get('bot_templates');
      S.custom = modeles && typeof modeles === 'object' && !Array.isArray(modeles) ? modeles : {};
      settingsLoaded = true;
    } else {
      toast(`Réglages du bot : ${errMsg(settings.reason)}`, 'error');
      lockUnloadedSettings(errMsg(settings.reason));
    }
    api.renderSettings();
    api.renderAnnChannels();
    api.fillRules(); api.fillSupport(); api.fillPlanning();

    // Modèles
    if (defs.status === 'fulfilled' && defs.value?.templates) {
      S.defs = defs.value;
      api.renderTemplatesShell();
    } else {
      $('#bt-body', container).innerHTML = `<div class="empty">Impossible de charger les textes par défaut (<code>supabase/functions/_shared/bot-templates.json</code>)${defs.status === 'rejected' ? ` : ${esc(errMsg(defs.reason))}` : ''}. La publication du site (workflow publier-site.yml) doit le copier dans site/assets/espaces/admin/.</div>`;
    }

    // Comptes
    const profs = profiles.status === 'fulfilled' ? profiles.value ?? [] : [];
    const byId = new Map(profs.map((p) => [p.id, p]));
    // Repli sans hg_admin_accounts : comptes actifs seulement (pas les fantômes).
    const accs = accounts.status === 'fulfilled' && Array.isArray(accounts.value) ? accounts.value : profs.filter((p) => !p.is_ghost).map((p) => ({ id: p.id, pseudo: p.pseudo }));
    if (accounts.status === 'rejected' && profiles.status === 'rejected') {
      $('#bm-body', container).innerHTML = `<div class="empty">Impossible de charger les comptes : ${esc(errMsg(accounts.reason))}</div>`;
      return;
    }
    S.people = accs.map((a) => {
      const p = byId.get(a.id);
      // Pastille d'état du compte : sans profil, sans ID Discord, MP refusés, ou joignable (ok).
      const status = !p ? 'noprofile' : !DISCORD_ID.test(String(p.discord_id ?? '')) ? 'nodiscord' : !p.bot_optin ? 'optout' : 'ok';
      return {
        id: a.id, name: p?.pseudo ?? a.pseudo ?? a.email ?? 'Compte sans pseudo', email: a.email ?? '',
        avatar_url: p?.avatar_url ?? null, color: p?.color ?? null, is_admin: !!(p?.is_admin ?? a.is_admin), status,
      };
    }).sort((a, b) => (a.status !== 'ok') - (b.status !== 'ok') || a.name.localeCompare(b.name, 'fr'));
    for (const p of profs) S.pseudo.set(p.id, p.pseudo);
    for (const p of S.people) if (!S.pseudo.has(p.id)) S.pseudo.set(p.id, p.name);
    api.renderManualShell();
  })();

}
