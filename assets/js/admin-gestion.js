// =====================================================================
// Admin : Le jeu de cartes › Gestion globale (route #cartes/gestion, section #cartes-gestion, racine #gestion-root).
// Trois blocs : « Give » (don groupé : même confirmation et même RPC que le tiroir d’Économie), « Résumé de l’économie »
// (hg_eco_health via admin/eco-health.js, hg_booster_type_stats, hg_auctions_admin : seulement ce que la base renvoie)
// et « Derniers gives » (hg_admin_log, action « don_groupe »).
// Droit : « cartes ». Écritures : RPC uniquement (hg_cards_admin_bulk_give). Lectures : hg_staff_directory, hg_cards,
// hg_card_sets, hg_admin_log (lecture seule). Dépendances : core.js (sb, toast, errMsg, esc, $), cartes-ui.js (rarityLabel),
// admin-cards/bulk.js (KIND, MAX_MEMBRES, recapText, donnerGroupe), admin-cards/helpers.js (check, fetchAll, nf, fmtWhen),
// admin/eco-health.js (loadEco, alertesEco). Exporte : mountGestionSection.
// =====================================================================
import { sb, toast, errMsg, esc, $ } from './core.js';
import { rarityLabel } from './cartes-ui.js';
import { KIND, MAX_MEMBRES, recapText, donnerGroupe } from './admin-cards/bulk.js';
import { check, fetchAll, nf, fmtWhen } from './admin-cards/helpers.js';
import { loadEco, alertesEco } from './admin/eco-health.js';

const nf1 = new Intl.NumberFormat('fr-CH', { maximumFractionDigits: 1 });
/* Texte normalisé pour la recherche : minuscules et sans accents. */
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/* Nombre suivi du mot au singulier ou au pluriel. */
const plur = (n, one, many) => `${nf(n)} ${Number(n) > 1 ? many : one}`;
/* Libellé de la sorte de don dans le journal (valeur de p_kind). */
const QUOI = { paillettes: 'Paillettes', boosters: 'Boosters offerts', carte: 'Carte' };

/* État du bloc Give : une seule copie, mise à jour par les gestionnaires d’événements. */
const G = { kind: 'paillettes', ids: new Set(), all: false, q: '', card: '', cardq: '', shiny: false, announce: true, motif: '',
  amt: { paillettes: KIND.paillettes.defaut, boosters: KIND.boosters.defaut, carte: KIND.carte.defaut } };
/* Données lues : membres actifs, cartes et séries (index par identifiant). */
const D = { root: null, membres: [], membresById: new Map(), cartes: [], cartesById: new Map(), sets: [] };

/** Membres actifs (hors fantômes), triés par pseudo, puis catalogue des cartes et des séries. */
async function chargerDonnees() {
  const [staff, cartes, sets] = await Promise.all([
    sb.rpc('hg_staff_directory'),
    fetchAll(() => sb.from('hg_cards').select('id, name, rarity, number, set_id, active, can_shiny').order('id')),
    fetchAll(() => sb.from('hg_card_sets').select('id, name, code, sort').order('id')),
  ]);
  D.membres = (check(staff) ?? []).filter((p) => !p.is_ghost).sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr'));
  D.membresById = new Map(D.membres.map((p) => [p.id, p]));
  D.cartes = cartes;
  D.cartesById = new Map(cartes.map((k) => [k.id, k]));
  D.sets = sets.sort((a, b) => (a.sort - b.sort) || a.code.localeCompare(b.code));
}

/* ---------- Bloc « Give » ---------- */

/** Destinataires choisis : tout le gang (tous les membres actifs) ou la sélection. */
const destinataires = () => (G.all ? D.membres.map((p) => p.id) : [...G.ids]);

/** Valeurs lues du bloc, au format attendu par recapText et donnerGroupe. */
function lire() {
  const ids = destinataires();
  const cfg = KIND[G.kind];
  return {
    kind: G.kind, cfg, amount: Number(String(G.amt[G.kind]).trim()),
    card: G.kind === 'carte' ? G.card : '', shiny: G.kind === 'carte' && G.shiny,
    all: G.all, ids, n: ids.length, announce: G.announce, note: G.motif.trim(),
    carteNom: D.cartesById.get(G.card)?.name || '',
  };
}

/** Options des cartes actives, groupées par série, filtrées par le texte de recherche. */
function optionsCartes() {
  const needle = norm(G.cardq.trim());
  const groupes = D.sets.map((s) => {
    const liste = D.cartes.filter((k) => k.set_id === s.id && k.active && (!needle || norm(k.name).includes(needle)))
      .sort((a, b) => a.number - b.number);
    return liste.length ? `<optgroup label="${esc(s.name)}">${liste.map((k) => `<option value="${esc(k.id)}"${k.id === G.card ? ' selected' : ''}>#${esc(k.number)} · ${esc(k.name)} (${esc(rarityLabel(k.rarity))})</option>`).join('')}</optgroup>` : '';
  }).join('');
  return groupes || '<option value="">Aucune carte trouvée</option>';
}

/** Liste des membres à cocher (filtrée par la recherche). Les cases reflètent la sélection. */
function listeMembres() {
  const needle = norm(G.q.trim());
  const rows = D.membres.filter((p) => !needle || norm(p.pseudo).includes(needle))
    .map((p) => `<label class="acd-bulk-row"><input type="checkbox" name="gest-who" value="${esc(p.id)}"${G.ids.has(p.id) ? ' checked' : ''}${G.all ? ' disabled' : ''}>
      <span>${esc(p.pseudo)}</span></label>`).join('');
  return rows || '<p class="small muted">Aucun membre ne correspond.</p>';
}

/** Pastilles des membres choisis (retirables) ; « Tout le gang » remplace la liste. */
function pastilles() {
  if (G.all) return `<p class="small muted">Tout le gang : ${plur(D.membres.length, 'membre actif', 'membres actifs')}.</p>`;
  if (!G.ids.size) return '<p class="small muted">Aucun membre choisi.</p>';
  return [...G.ids].map((id) => ({ id, pseudo: D.membresById.get(id)?.pseudo ?? 'Ancien membre' }))
    .sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr'))
    .map((m) => `<button type="button" class="chip gest-chip" data-gest-remove="${esc(m.id)}" aria-label="Retirer ${esc(m.pseudo)}">${esc(m.pseudo)} <span aria-hidden="true">×</span></button>`).join('');
}

/**
 * Met à jour l’affichage dépendant de la sélection : pastilles, cases, récapitulatif.
 * liste = false : les cases existantes sont mises à jour sans être redessinées (le focus clavier reste sur la case).
 */
function majMembres({ liste = true } = {}) {
  const root = D.root;
  const zone = $('#gest-list', root);
  $('#gest-chips', root).innerHTML = pastilles();
  zone.classList.toggle('is-off', G.all);
  if (liste) zone.innerHTML = listeMembres();
  else zone.querySelectorAll('input[name="gest-who"]').forEach((i) => { i.checked = G.ids.has(i.value); i.disabled = G.all; });
  $('#gest-all', root).checked = G.all;
  majRecap();
}

/** Type de don : onglets, libellé et valeur du montant, bloc carte. */
function majType() {
  const root = D.root;
  const cfg = KIND[G.kind];
  root.querySelectorAll('[data-gest-kind]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.gestKind === G.kind)));
  $('#gest-amount-l', root).textContent = cfg.champ;
  const amount = $('#gest-amount', root);
  amount.min = cfg.min; amount.max = cfg.max; amount.value = G.amt[G.kind];
  $('#gest-cardbox', root).hidden = G.kind !== 'carte';
  majRecap();
}

/** Récapitulatif en direct (même phrase que dans la confirmation). */
function majRecap() {
  const v = lire();
  const out = $('#gest-recap', D.root);
  out.textContent = recapText(v);
  out.classList.toggle('is-warn', v.n > MAX_MEMBRES || !v.n);
}

/** Affiche ou efface l’erreur du bloc Give. */
function montrerErreur(m) {
  const el = $('#gest-err', D.root);
  el.textContent = m;
  el.hidden = !m;
  if (m) el.scrollIntoView({ block: 'nearest' });
}

/** Envoi : contrôle, confirmation (donnerGroupe), appel de la RPC, puis rafraîchissement du journal et de l’économie. */
async function donner(bouton) {
  montrerErreur('');
  const v = lire();
  const texte = recapText(v);
  if (!v.n || v.n > MAX_MEMBRES || !Number.isInteger(v.amount) || v.amount < v.cfg.min || v.amount > v.cfg.max || (v.kind === 'carte' && !v.card)) {
    montrerErreur(texte);
    return;
  }
  bouton.disabled = true;
  try {
    const res = await donnerGroupe(v);
    if (!res) return; // annulé dans la confirmation
    toast(`Don envoyé à ${plur(Number(res.membres) || v.n, 'membre', 'membres')}`, 'ok');
    G.ids.clear(); G.all = false;
    majMembres();
    await Promise.all([rendreEco(), rendreJournal()]);
  } catch (e) {
    montrerErreur(errMsg(e));
    toast(errMsg(e), 'error');
  } finally {
    bouton.disabled = false;
  }
}

/** Gestionnaires du bloc Give (délégation sur la racine : les listes sont redessinées). */
function brancher(root) {
  root.addEventListener('click', (e) => {
    const kind = e.target.closest('[data-gest-kind]');
    if (kind) { G.kind = kind.dataset.gestKind; majType(); return; }
    const retirer = e.target.closest('[data-gest-remove]');
    if (retirer) { G.ids.delete(retirer.dataset.gestRemove); majMembres({ liste: false }); $('#gest-q', root).focus(); return; }
    if (e.target.closest('#gest-go')) donner(e.target.closest('#gest-go'));
  });
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'gest-all') { G.all = t.checked; majMembres({ liste: false }); }
    else if (t.name === 'gest-who') { if (t.checked) G.ids.add(t.value); else G.ids.delete(t.value); majMembres({ liste: false }); }
    else if (t.id === 'gest-card') { G.card = t.value; majRecap(); }
    else if (t.id === 'gest-shiny') { G.shiny = t.checked; majRecap(); }
    else if (t.id === 'gest-announce') { G.announce = t.checked; majRecap(); }
    else if (t.id === 'gest-amount') { G.amt[G.kind] = t.value; majRecap(); }
  });
  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'gest-q') { G.q = t.value; $('#gest-list', root).innerHTML = listeMembres(); }
    else if (t.id === 'gest-cardq') {
      G.cardq = t.value;
      const sel = $('#gest-card', root);
      sel.innerHTML = optionsCartes();
      G.card = sel.value;
      majRecap();
    }
    else if (t.id === 'gest-motif') { G.motif = t.value; majRecap(); }
    else if (t.id === 'gest-amount') { G.amt[G.kind] = t.value; majRecap(); }
  });
}

/** HTML du bloc Give. */
function giveHtml() {
  return `<section class="card gest-give" aria-labelledby="gest-give-h">
    <div>
      <h2 class="card-title" id="gest-give-h">Give</h2>
      <p class="small muted">Donner à un ou plusieurs membres, puis inscrire le geste au journal.</p>
    </div>
    <fieldset class="acd-fs">
      <legend>Membres</legend>
      <label class="switch acd-switch"><input type="checkbox" id="gest-all"><span class="switch-ui" aria-hidden="true"></span><span>Tout le gang (tous les membres actifs)</span></label>
      <div class="gest-chips" id="gest-chips" aria-live="polite"></div>
      <div class="field"><label for="gest-q">Rechercher un membre</label>
        <input id="gest-q" type="search" autocomplete="off" placeholder="Pseudo"></div>
      <div class="acd-bulk-list" id="gest-list"></div>
    </fieldset>
    <div class="filters gest-tabs" role="group" aria-label="Ce qui est donné">
      <button class="chip" type="button" data-gest-kind="paillettes" aria-pressed="true">Paillettes</button>
      <button class="chip" type="button" data-gest-kind="carte" aria-pressed="false">Cartes</button>
      <button class="chip" type="button" data-gest-kind="boosters" aria-pressed="false">Booster</button>
    </div>
    <div class="acd-form">
      <div class="field"><label for="gest-amount" id="gest-amount-l">${esc(KIND.paillettes.champ)}</label>
        <input id="gest-amount" name="amount" type="number" inputmode="numeric" step="1"></div>
      <div class="acd-bulk-card" id="gest-cardbox" hidden>
        <div class="field"><label for="gest-cardq">Rechercher une carte</label>
          <input id="gest-cardq" type="search" autocomplete="off" placeholder="Nom de la carte"></div>
        <div class="field"><label for="gest-card">Carte</label><select id="gest-card"></select></div>
        <label class="switch acd-switch"><input type="checkbox" id="gest-shiny"><span class="switch-ui" aria-hidden="true"></span><span>Brillante</span></label>
      </div>
      <div class="field"><label for="gest-motif">Motif <span class="muted small">(facultatif, inscrit au journal)</span></label>
        <input id="gest-motif" maxlength="200" autocomplete="off" placeholder="Ex. récompense de quête"></div>
      <label class="switch acd-switch"><input type="checkbox" id="gest-announce" checked><span class="switch-ui" aria-hidden="true"></span><span>Annoncer au membre</span></label>
      <p class="small muted">Publie une seule ligne groupée dans le fil d’actualité. Aucun message privé n’est envoyé.</p>
    </div>
    <p class="acd-sum" id="gest-recap" aria-live="polite"></p>
    <p class="form-error" id="gest-err" role="alert" hidden></p>
    <div class="gest-go">
      <button class="btn btn-primary" type="button" id="gest-go">Donner</button>
      <p class="small muted">Inscrit au journal · visible dans Pilotage › Journal</p>
    </div>
  </section>`;
}

/* ---------- Bloc « Résumé de l’économie » ---------- */

/** Lecture d’une réponse Supabase : la donnée, ou l’erreur levée. */
const reponse = async (p) => { const r = await p; if (r.error) throw r.error; return r.data; };

/** Dessine le résumé : Paillettes en circulation, boosters ouverts sur 7 jours, enchère en cours, alertes, liens. Le sous-texte de chaque tuile est déjà échappé. */
async function rendreEco() {
  const el = $('#gest-eco', D.root);
  el.innerHTML = '<p class="small muted">Chargement…</p>';
  const [eco, stats, encheres] = await Promise.allSettled([
    loadEco().then(() => alertesEco()),
    reponse(sb.rpc('hg_booster_type_stats')),
    reponse(sb.rpc('hg_auctions_admin')),
  ]);
  const chiffres = [];
  // Paillettes en circulation et variation sur 7 jours (hg_eco_health)
  const donnees = eco.status === 'fulfilled' ? eco.value.donnees : null;
  if (donnees?.paillettes) {
    const p = donnees.paillettes;
    const pct = p.pct == null ? 'pas de référence' : `${p.pct >= 0 ? '+' : ''}${nf1.format(p.pct)} % sur 7 jours`;
    chiffres.push(['Paillettes en circulation', `${nf(p.total ?? 0)} ✦`, esc(pct)]);
  } else {
    chiffres.push(['Paillettes en circulation', '–', esc(eco.status === 'rejected' ? errMsg(eco.reason) : 'indisponible')]);
  }
  // Boosters ouverts sur les 7 derniers jours (hg_booster_type_stats, somme des types)
  if (stats.status === 'fulfilled') {
    const ouverts = (stats.value?.types ?? []).reduce((s, t) => s + (Number(t.opens?.d7) || 0), 0);
    chiffres.push(['Boosters ouverts', nf(ouverts), 'sur les 7 derniers jours']);
  } else {
    chiffres.push(['Boosters ouverts', '–', esc(errMsg(stats.reason))]);
  }
  // Enchères ouvertes (hg_auctions_admin, statut « ouverte »)
  if (encheres.status === 'fulfilled') {
    const ouvertes = (encheres.value ?? []).filter((a) => a.status === 'ouverte');
    const premiere = ouvertes[0];
    chiffres.push(['Enchères en cours', nf(ouvertes.length),
      premiere ? `${esc(premiere.card_name)}, fin ${esc(fmtWhen(premiere.ends_at))}` : 'aucune enchère ouverte']);
  } else {
    chiffres.push(['Enchères en cours', '–', esc(errMsg(encheres.reason))]);
  }
  // Alertes rouges expliquées (eco-health), avec le lien vers le réglage
  const alertes = eco.status === 'fulfilled' ? eco.value : { liste: [], suspendues: false, erreur: errMsg(eco.reason) };
  const erreurEco = alertes.erreur ? `<p class="form-error" role="alert">Alertes indisponibles : ${esc(alertes.erreur)}</p>` : '';
  el.innerHTML = `<h2 class="card-title" id="gest-eco-h">Résumé de l’économie</h2>
    <div class="acd-tiles">
      ${chiffres.map(([label, valeur, sous]) => `<div class="acd-tile"><strong>${esc(valeur)}</strong><span>${esc(label)}</span><span class="small muted">${sous}</span></div>`).join('')}
    </div>
    ${erreurEco}
    <div>
      <p class="gest-titre-petit">À surveiller</p>
      ${alertes.liste.length ? alertes.liste.map((a) => `<div class="eco-alert" data-tone="${alertes.suspendues ? 'off' : 'bad'}">
          <div class="eco-alert-txt"><strong>${esc(a.title)}</strong><span class="small">${esc(a.text)}</span></div>
          <div class="eco-alert-act"><a class="btn btn-sand btn-sm" href="${esc(a.href)}">${esc(a.act)}</a></div></div>`).join('')
        : `<p class="small muted">${alertes.suspendues ? 'Alertes suspendues pour le moment.' : 'Aucune alerte rouge pour le moment.'}</p>`}
    </div>
    <div class="btn-row">
      <a class="btn btn-ghost btn-sm" href="#cartes/limites">Économie › Limites</a>
      <a class="btn btn-ghost btn-sm" href="#cartes/stats">Suivi › Statistiques</a>
    </div>`;
}

/* ---------- Bloc « Derniers gives » ---------- */

/** Noms des destinataires : trois au plus, puis le nombre restant. */
function nomsDestinataires(ids) {
  const noms = ids.map((id) => D.membresById.get(id)?.pseudo ?? 'Ancien membre');
  if (noms.length <= 3) return noms.length > 1 ? `${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}` : noms.join('');
  return `${noms[0]}, ${noms[1]} et ${noms.length - 2} autres`;
}

/** Une ligne du journal : qui, quoi (par membre et total), quand, motif. */
function ligneDon(r) {
  const d = r.details || {};
  const ids = Array.isArray(d.destinataires) ? d.destinataires : [];
  const membres = Number(d.membres) || ids.length;
  const par = Number(d.montant) || 0;
  const quoi = r.target_ref === 'paillettes' ? `${nf(par)} Paillettes par membre`
    : r.target_ref === 'boosters' ? `${plur(par, 'booster offert', 'boosters offerts')} par membre`
    : `${plur(par, 'exemplaire', 'exemplaires')} de « ${D.cartesById.get(d.carte)?.name ?? 'carte'} »${d.brillante ? ' (brillante)' : ''} par membre`;
  const qui = d.tout_le_gang ? `Tout le gang (${plur(membres, 'membre', 'membres')})` : nomsDestinataires(ids);
  const total = membres * par;
  const totalTxt = membres > 1 ? ` · ${r.target_ref === 'paillettes' ? `${nf(total)} Paillettes`
    : r.target_ref === 'boosters' ? plur(total, 'booster', 'boosters') : plur(total, 'exemplaire', 'exemplaires')} au total` : '';
  return `<li class="acd-item acd-item-tight">
      <div class="acd-item-main">
        <p><strong>${esc(qui)}</strong> <span class="small muted">${esc(QUOI[r.target_ref] ?? r.target_ref)}</span></p>
        <p class="small">${esc(quoi)}${esc(totalTxt)}</p>
        ${d.note ? `<p class="small muted">Motif : ${esc(d.note)}</p>` : ''}
      </div>
      <span class="small muted">${esc(fmtWhen(r.created_at))}</span>
    </li>`;
}

/** Dessine les 10 derniers dons groupés (hg_admin_log, action « don_groupe »). */
async function rendreJournal() {
  const el = $('#gest-journal', D.root);
  el.innerHTML = '<p class="small muted">Chargement…</p>';
  try {
    const { data, error } = await sb.from('hg_admin_log').select('id, admin_id, action, target_user, target_ref, details, created_at')
      .eq('action', 'don_groupe').order('created_at', { ascending: false }).limit(10);
    if (error) throw error;
    const lignes = (data ?? []).slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 10);
    el.innerHTML = `<div class="gest-entete"><h2 class="card-title" id="gest-journal-h">Derniers gives</h2>
        <a class="small" href="#pilotage/journal">Voir le journal</a></div>
      ${lignes.length ? `<ul class="acd-list">${lignes.map(ligneDon).join('')}</ul>` : '<p class="small muted">Aucun don groupé pour l’instant.</p>'}`;
  } catch (e) {
    el.innerHTML = `<div class="gest-entete"><h2 class="card-title" id="gest-journal-h">Derniers gives</h2></div>
      <p class="form-error" role="alert">Journal indisponible : ${esc(errMsg(e))}</p>`;
  }
}

/* ---------- Montage ---------- */

/**
 * Monte la section Gestion globale.
 * @param {HTMLElement} root Conteneur #gestion-root.
 */
export async function mountGestionSection(root) {
  D.root = root;
  root.innerHTML = `<div class="gest">
      <div id="gest-give-zone">${giveHtml()}</div>
      <section class="card gest-eco" id="gest-eco" aria-labelledby="gest-eco-h"><p class="small muted">Chargement…</p></section>
    </div>
    <section class="card gest-journal" id="gest-journal" aria-labelledby="gest-journal-h"><p class="small muted">Chargement…</p></section>`;
  brancher(root);
  try {
    await chargerDonnees();
  } catch (e) {
    $('#gest-give-zone', root).innerHTML = `<div class="empty">Impossible de charger les membres et les cartes : ${esc(errMsg(e))}</div>`;
    toast(errMsg(e), 'error');
    return;
  }
  $('#gest-card', root).innerHTML = optionsCartes();
  G.card = $('#gest-card', root).value; // première carte active de la liste (le choix suit le sélecteur)
  majMembres();
  majType();
  await Promise.all([rendreEco(), rendreJournal()]);
}
