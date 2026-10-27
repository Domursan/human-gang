// =====================================================================
// Admin : puissance des cartes dans l'Arène (Arène actuelle et bataille). Deux blocs, dans Fabrique › Arène :
//  - Puissance par catégorie : hg_settings.cards.puissances (commune à légendaire, brillante, puis mythique, identité,
//    unique en repli). Enregistrée par fusion : seul ce sous-objet change, les autres réglages de « cards » restent.
//  - Puissance par carte : hg_cards.power pour les mythiques, les uniques, la série « Les OG » et « Hors série »,
//    réglée une à une par la RPC hg_card_power_set (Staff « cartes », journalisée). Vide = valeur de la catégorie.
// Dépendances : core.js (sb, toast, errMsg, esc), admin/reglages-merge.js (lireReglage, ecrireReglage),
// cartes-ui.js (cardHtml, rarityLabel, rarityRank).
// Exporte : blocPuissances (élément de la section Arène, chargé à l'affichage).
// =====================================================================
import { sb, toast, errMsg, esc } from '../core.js';
import { lireReglage, ecrireReglage } from './reglages-merge.js';
import { cardHtml, rarityLabel, rarityRank } from '../cartes-ui.js';

/* Valeurs par défaut (celles du serveur, migration 115) et bornes saisies dans le panel. */
const DEFAUT = { commune: 1, peu_commune: 2, rare: 3, epique: 4, legendaire: 5, mythique: 6, identite: 6, unique: 6, brillante: 1 };
const MIN = 0, MAX = 20;
const CATEGORIES = [['commune', 'Commune'], ['peu_commune', 'Peu commune'], ['rare', 'Rare'], ['epique', 'Épique'], ['legendaire', 'Légendaire']];
const LIMITEES = [['mythique', 'Mythique'], ['identite', 'Identité'], ['unique', 'Unique']];
const CLES = [...CATEGORIES, ...LIMITEES].map(([k]) => k).concat('brillante');
/* Filtres de la liste par carte. Les OG = série « gang-membres » ; Hors série = série « hors-serie ». */
const FILTRES = [['mythique', 'Mythiques'], ['unique', 'Uniques'], ['og', 'Les OG'], ['hors', 'Hors série'], ['tous', 'Tous']];
const SERIE_OG = 'gang-membres', SERIE_HS = 'hors-serie';
const EXPLICATION = 'Puissance en duel = puissance de la carte + bonus si brillante + 2 si la famille a l’avantage.';

/** Texte pour la recherche : sans accents, en minuscules. */
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Lit une saisie : vide = null (valeur par défaut), entier de 0 à 20 = valeur, sinon ok à false.
 * @param {string} raw texte du champ.
 * @returns {{ok: boolean, val: number|null}}
 */
function lireSaisie(raw) {
  const t = String(raw ?? '').trim();
  if (t === '') return { ok: true, val: null };
  if (!/^\d+$/.test(t) || Number(t) < MIN || Number(t) > MAX) return { ok: false, val: null };
  return { ok: true, val: Number(t) };
}

/** Champ numérique d'une catégorie : valeur enregistrée (ou vide), défaut en placeholder, bouton « Valeur par défaut ». */
function champCategorie(k, label, enregistree) {
  return `<div class="field puiss-champ">
    <label for="pu-f-${k}">${esc(label)}</label>
    <div class="puiss-saisie">
      <input id="pu-f-${k}" class="input" type="number" inputmode="numeric" step="1" min="${MIN}" max="${MAX}" placeholder="${DEFAUT[k]}"
        value="${enregistree == null ? '' : esc(String(enregistree))}" aria-describedby="pu-f-${k}-h">
      <button type="button" class="btn btn-ghost btn-sm" data-defaut="${k}">Valeur par défaut</button>
    </div>
    <span class="small muted" id="pu-f-${k}-h">Par défaut : ${DEFAUT[k]} (vide = défaut)</span>
  </div>`;
}

/**
 * Monte le bloc « Puissance des cartes ». Charge les réglages et les cartes concernées, puis renvoie l'élément.
 * En cas d'erreur de lecture, le bloc affiche le message et les autres blocs de la section restent utilisables.
 * @returns {Promise<HTMLElement>}
 */
export async function blocPuissances() {
  const bloc = document.createElement('section');
  bloc.className = 'card jm-form puiss';
  bloc.setAttribute('aria-labelledby', 'pu-h');
  bloc.innerHTML = '<h3 id="pu-h">Puissance des cartes</h3><div class="empty">Chargement…</div>';
  let st;
  try { st = await charger(); } catch (e) {
    bloc.querySelector('.empty').textContent = `Puissances indisponibles : ${errMsg(e)}`;
    return bloc;
  }
  dessiner(bloc, st);
  return bloc;
}

/** Lit les réglages « cards » (fraîchement, pour ne pas écraser une autre modification), les séries et les cartes concernées. */
async function charger() {
  const cfg = await lireReglage('cards');
  const sets = await sb.from('hg_card_sets').select('id, code, name');
  if (sets.error) throw sets.error;
  const series = new Map((sets.data || []).map((s) => [s.id, s]));
  const idsSerie = [...series.values()].filter((s) => s.code === SERIE_OG || s.code === SERIE_HS).map((s) => s.id);
  const [parRarete, parSerie] = await Promise.all([
    sb.from('hg_cards').select('id, name, rarity, set_id, power, image_url, family, number, max_copies, active').in('rarity', ['mythique', 'unique']),
    idsSerie.length ? sb.from('hg_cards').select('id, name, rarity, set_id, power, image_url, family, number, max_copies, active').in('set_id', idsSerie) : { data: [], error: null },
  ]);
  if (parRarete.error) throw parRarete.error;
  if (parSerie.error) throw parSerie.error;
  const vus = new Map();
  for (const c of [...(parRarete.data || []), ...(parSerie.data || [])]) vus.set(c.id, c);
  return {
    puissances: cfg.puissances && typeof cfg.puissances === 'object' && !Array.isArray(cfg.puissances) ? cfg.puissances : {},
    series, cartes: [...vus.values()], filtre: 'tous', recherche: '',
  };
}

/** Valeur d'une catégorie : la valeur enregistrée, sinon le défaut. */
function valeurCategorie(st, rarete) {
  const v = st.puissances[rarete];
  return Number.isInteger(v) ? v : (DEFAUT[rarete] ?? 1);
}

/** Valeur lue dans un champ de catégorie pour l'aperçu : saisie valide, sinon défaut. */
function valeurChamp(bloc, k) {
  const r = lireSaisie(bloc.querySelector(`#pu-f-${k}`)?.value);
  return r.ok && r.val != null ? r.val : DEFAUT[k];
}

/** Dessine le bloc : formulaire des catégories, puis liste des cartes. */
function dessiner(bloc, st) {
  const champs = (liste) => liste.map(([k, l]) => champCategorie(k, l, st.puissances[k])).join('');
  bloc.innerHTML = `<h3 id="pu-h">Puissance des cartes</h3>
    <p class="small muted">Réglée par le Staff « cartes ». Une carte prend la valeur de sa rareté, sauf si elle en a une à elle (liste plus bas).</p>
    <section class="puiss-bloc" aria-labelledby="pu-cat-h">
      <h4 id="pu-cat-h">Puissance par catégorie</h4>
      <form class="jm-form" id="pu-cat-form" novalidate>
        <div class="jm-grid">${champs(CATEGORIES)}${champCategorie('brillante', 'Bonus d’une brillante', st.puissances.brillante)}</div>
        <details class="puiss-plus"><summary>Mythique, Identité et Unique (valeur par défaut, utilisée si la carte n’a pas sa valeur)</summary>
          <div class="jm-grid">${champs(LIMITEES)}</div></details>
        <p class="puiss-explic" id="pu-explic" aria-live="polite"></p>
        <p class="form-error" id="pu-err" role="alert" hidden></p>
        <div class="jm-actions"><button type="submit" class="btn btn-primary">Enregistrer les puissances</button></div>
      </form>
    </section>
    <section class="puiss-bloc" aria-labelledby="pu-carte-h">
      <h4 id="pu-carte-h">Puissance par carte</h4>
      <p class="small muted">Mythiques, uniques, série « Les OG » et « Hors série ». Une valeur propre remplace celle de la catégorie ; vide ou « Revenir à la catégorie » la retire.</p>
      <div class="puiss-filtres" role="group" aria-label="Filtrer les cartes">${FILTRES.map(([id, l]) => `<button type="button" class="puiss-chip" data-f="${id}" aria-pressed="${st.filtre === id}">${esc(l)}</button>`).join('')}</div>
      <div class="field"><label for="pu-recherche">Chercher une carte</label>
        <input id="pu-recherche" class="input" type="search" autocomplete="off" placeholder="Nom de la carte" value="${esc(st.recherche)}"></div>
      <p class="small muted" id="pu-compte" aria-live="polite"></p>
      <p class="empty" id="pu-vide" hidden>Aucune carte dans ce filtre.</p>
      <ul class="puiss-liste" id="pu-liste"></ul>
    </section>`;

  const form = bloc.querySelector('#pu-cat-form');
  const maj = () => {
    const l = valeurChamp(bloc, 'legendaire'), b = valeurChamp(bloc, 'brillante');
    bloc.querySelector('#pu-explic').textContent = `${EXPLICATION} Exemple : une Légendaire (${l}) brillante, avec l’avantage de sa famille : ${l} + ${b} + 2 = ${l + b + 2}.`;
  };
  form.addEventListener('input', maj);
  form.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-defaut]');
    if (!b) return;
    bloc.querySelector(`#pu-f-${b.dataset.defaut}`).value = '';
    maj();
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); enregistrerCategories(bloc, st, form); });
  maj();

  bloc.querySelector('.puiss-filtres').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-f]');
    if (!b) return;
    st.filtre = b.dataset.f;
    bloc.querySelectorAll('.puiss-chip').forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
    rafraichirListe(bloc, st);
  });
  bloc.querySelector('#pu-recherche').addEventListener('input', (e) => { st.recherche = e.target.value; rafraichirListe(bloc, st); });
  const liste = bloc.querySelector('#pu-liste');
  liste.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const li = b.closest('.puiss-ligne');
    const carte = st.cartes.find((c) => c.id === li.dataset.id);
    if (!carte) return;
    if (b.dataset.act === 'enregistrer-carte') {
      const r = lireSaisie(li.querySelector('input').value);
      if (!r.ok) { toast(`Puissance de « ${carte.name} » : un nombre entier de ${MIN} à ${MAX}, ou vide.`, 'error'); return; }
      enregistrerCarte(bloc, st, carte, r.val, b);
    } else if (b.dataset.act === 'categorie-carte') {
      enregistrerCarte(bloc, st, carte, null, b);
    }
  });
  rafraichirListe(bloc, st);
}

/**
 * Enregistre les puissances par catégorie : fusion dans hg_settings.cards.puissances (les autres sous-clés de « cards »
 * et les clés inconnues de puissances restent). Un champ vide retire la clé : le défaut s'applique.
 */
async function enregistrerCategories(bloc, st, form) {
  const err = bloc.querySelector('#pu-err');
  const saisies = {};
  const bad = [];
  for (const k of CLES) {
    const r = lireSaisie(form.querySelector(`#pu-f-${k}`).value);
    if (!r.ok) bad.push(k);
    else saisies[k] = r.val;
  }
  if (bad.length) {
    const noms = Object.fromEntries([...CATEGORIES, ...LIMITEES, ['brillante', 'Bonus d’une brillante']]);
    err.textContent = `Valeur attendue de ${MIN} à ${MAX} (ou vide, pour la valeur par défaut) : ${bad.map((k) => noms[k]).join(', ')}.`;
    err.hidden = false;
    return;
  }
  err.hidden = true;
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const enregistre = await ecrireReglage('cards', (c) => {
      const ancien = c.puissances && typeof c.puissances === 'object' && !Array.isArray(c.puissances) ? c.puissances : {};
      const next = { ...ancien };
      for (const k of CLES) { if (saisies[k] == null) delete next[k]; else next[k] = saisies[k]; }
      c.puissances = next;
    });
    st.puissances = enregistre.puissances;
    toast('Puissances des catégories enregistrées.', 'ok');
    rafraichirListe(bloc, st);
  } catch (e) {
    toast(errMsg(e), 'error');
  } finally {
    btn.disabled = false;
  }
}

/** Puissance d'une carte : sa valeur propre, sinon celle de sa rareté. */
const effective = (st, c) => (c.power != null ? c.power : valeurCategorie(st, c.rarity));

/** Une carte correspond-elle au filtre courant et à la recherche ? */
function correspond(st, c) {
  const serie = st.series.get(c.set_id)?.code;
  const ok = st.filtre === 'tous' || (st.filtre === 'mythique' && c.rarity === 'mythique') || (st.filtre === 'unique' && c.rarity === 'unique')
    || (st.filtre === 'og' && serie === SERIE_OG) || (st.filtre === 'hors' && serie === SERIE_HS);
  return ok && (!st.recherche.trim() || norm(c.name).includes(norm(st.recherche.trim())));
}

/** Redessine la liste (filtre, recherche) et le compteur. */
function rafraichirListe(bloc, st) {
  const liste = bloc.querySelector('#pu-liste');
  const cartes = st.cartes.filter((c) => correspond(st, c))
    .sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity) || norm(a.name).localeCompare(norm(b.name), 'fr'));
  liste.innerHTML = cartes.map((c) => ligneHtml(st, c)).join('');
  bloc.querySelector('#pu-vide').hidden = cartes.length > 0;
  majCompte(bloc, st);
}

/** Compteur sous la recherche : cartes affichées et cartes qui ont leur propre valeur. */
function majCompte(bloc, st) {
  const cartes = st.cartes.filter((c) => correspond(st, c));
  const propres = cartes.filter((c) => c.power != null).length;
  bloc.querySelector('#pu-compte').textContent = `${cartes.length} carte${cartes.length > 1 ? 's' : ''} affichée${cartes.length > 1 ? 's' : ''}`
    + ` · ${propres} avec une valeur propre`;
}

/** HTML d'une ligne : vignette, nom, rareté, série, puissance effective, saisie et boutons. */
function ligneHtml(st, c) {
  const cat = valeurCategorie(st, c.rarity);
  const propre = c.power != null;
  const serie = st.series.get(c.set_id)?.name || 'Sans série';
  return `<li class="puiss-ligne" data-id="${esc(c.id)}">
    <div class="puiss-vignette">${cardHtml(c, { size: 'sm' })}</div>
    <div class="puiss-infos">
      <p class="puiss-nom"><strong>${esc(c.name)}</strong>
        ${propre ? '<span class="pill pill-current">Valeur propre</span>' : '<span class="pill">Valeur de la catégorie</span>'}</p>
      <p class="small muted">${esc(rarityLabel(c.rarity))} · ${esc(serie)} · puissance en duel : <strong>${esc(effective(st, c))}</strong></p>
      <div class="puiss-saisie">
        <label class="small" for="pu-c-${esc(c.id)}">Puissance propre</label>
        <input id="pu-c-${esc(c.id)}" class="input puiss-num" type="number" inputmode="numeric" step="1" min="${MIN}" max="${MAX}"
          placeholder="${cat}" value="${propre ? esc(String(c.power)) : ''}">
        <button type="button" class="btn btn-primary btn-sm" data-act="enregistrer-carte">Enregistrer</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="categorie-carte" ${propre ? '' : 'disabled'}>Revenir à la catégorie</button>
      </div>
    </div>
  </li>`;
}

/**
 * Enregistre la puissance propre d'une carte (null = retour à la catégorie) par la RPC hg_card_power_set.
 * Met à jour la carte et sa ligne, sans redessiner la liste.
 */
async function enregistrerCarte(bloc, st, carte, val, bouton) {
  bouton.disabled = true;
  const r = await sb.rpc('hg_card_power_set', { p_card: carte.id, p_power: val });
  if (r.error) { bouton.disabled = false; toast(errMsg(r.error), 'error'); return; }
  carte.power = r.data?.power ?? null;
  toast(carte.power == null ? `« ${carte.name} » revient à la valeur de sa catégorie.` : `Puissance de « ${carte.name} » : ${carte.power}.`, 'ok');
  const li = bloc.querySelector(`#pu-liste .puiss-ligne[data-id="${CSS.escape(carte.id)}"]`);
  if (li) li.outerHTML = ligneHtml(st, carte);
  majCompte(bloc, st);
}
