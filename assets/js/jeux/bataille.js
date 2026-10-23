// ===== Humane Gang — page « Jeux », onglet Arène (idée J15, ex-« Bataille ») =====
// Adresse : jeux.html#bataille (identifiant inchangé ; le libellé affiché est « Arène », voir onglets.js).
/*
 * Rôle : mini-jeu asynchrone avec les cartes de sa collection. Chacun règle son deck de défense (5 cartes, dans
 * l'ordre) ; pour attaquer, on choisit un membre et on aligne 5 cartes : 5 duels face à face, résolus par le serveur.
 * Puissance = rareté (commune 1 → mythique 6 ; identité et unique 6) + 1 si brillante + 2 si la famille a l'avantage
 * (membre bat objet, objet bat lieu, lieu bat moment, moment bat membre). Aucune carte n'est perdue ni gagnée.
 * Une seule carte de puissance 6 par main. Textes neutres : « duel perdu », jamais de moquerie.
 * RPC : hg_battle_me, hg_battle_set_deck, hg_battle_attack, hg_battle_seen. Gains éventuels versés par le serveur.
 * Dépendances : cartes-ui.js (cardHtml, rarityLabel, familyLabel) et assets/css/cartes-card.css.
 * Exporte : mount(panel, ctx).
 */
import { cardHtml, rarityLabel, familyLabel } from '../cartes-ui.js';
import { loadCss } from './devine.js';

/** Raretés de puissance 6 : une seule par main. */
const TOP = ['mythique', 'identite', 'unique'];
const reduce = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
let P = null, C = null;
// view : accueil | deck (choix du deck) | attaque (choix de la main) | resultat
const S = { d: null, err: null, view: 'accueil', pick: [], target: null, result: null, busy: false, filter: '' };

/** Monte l'onglet. */
export async function mount(panel, ctx) {
  P = panel; C = ctx;
  loadCss('cartes-card'); loadCss('jeux-bataille');
  panel.innerHTML = '<p class="muted">Chargement de l’Arène…</p>';
  panel.addEventListener('click', onClick);
  panel.addEventListener('input', (e) => { if (e.target.id === 'jb-filter') { S.filter = e.target.value; paintPool(); } });
  await load();
  if (S.d?.unseen) C.sb.rpc('hg_battle_seen').then(() => {}, () => {});
}

/** Charge tout l'écran. */
async function load() {
  try {
    const { data, error } = await C.sb.rpc('hg_battle_me');
    if (error) throw error;
    S.d = data; S.err = null;
  } catch (e) { S.err = e?.message || String(e); }
  render();
}

/** Carte au format attendu par cardHtml. */
const asCard = (c) => ({ name: c.name, rarity: c.rarity, family: c.family, image_url: c.image_url, number: c.number });
/** Petite carte. */
const mini = (c, attrs = '') => cardHtml(asCard(c), { size: 'sm', shiny: c.shiny, attrs });
/** Texte d'avantage d'un duel. */
function advText(a, d, adv) {
  if (adv === 'a') return `avantage : ${familyLabel(a.family).toLowerCase()} bat ${familyLabel(d.family).toLowerCase()}`;
  if (adv === 'd') return `avantage : ${familyLabel(d.family).toLowerCase()} bat ${familyLabel(a.family).toLowerCase()}`;
  return 'pas d’avantage de famille';
}
/** Résultat lisible. */
const resTxt = (r, wa, wd) => (r === 'victoire' ? `Victoire ${wa} – ${wd}` : r === 'defaite' ? `Défaite ${wa} – ${wd}` : `Égalité ${wa} – ${wd}`);

/* ---------- Rendu ---------- */
function render() {
  const esc = C.esc;
  if (S.err) { P.innerHTML = `<p class="card">Arène indisponible : ${esc(S.err)}</p>`; return; }
  if (S.view === 'resultat' && S.result) { P.innerHTML = resultHtml(S.result); animate(); return; }
  if (S.view === 'deck' || S.view === 'attaque') { P.innerHTML = pickerHtml(); paintPool(); return; }
  P.innerHTML = homeHtml();
}

/** Écran d'accueil : règles, gains, deck de défense, adversaires, historique. */
function homeHtml() {
  const esc = C.esc, d = S.d, cfg = d.cfg;
  const gains = !cfg.actif ? '<p class="card jb-note">L’Arène est en pause pour le moment.</p>'
    : cfg.gains ? `<p class="muted small">+${esc(cfg.gain)} ✦ par victoire (${esc(Math.min(d.paid_today, cfg.cap_jour))}/${esc(cfg.cap_jour)} payées aujourd’hui) · +${esc(cfg.defense_gain)} ✦ quand ta défense tient (${esc(cfg.cap_defense)} par jour).</p>`
      : '<p class="muted small">Bêta : on joue pour la gloire, pas encore de Paillettes.</p>';
  const deck = d.deck
    ? `<div class="jb-row5">${d.deck.map((c) => mini(c)).join('')}</div>`
    : `<p class="muted">${d.deck_ids ? 'Une carte de ton deck n’est plus dans ta collection : refais-le.' : 'Tu n’as pas encore de deck de défense. Sans lui, personne ne peut t’attaquer.'}</p>`;
  const opps = d.opponents.map((o) => {
    const full = o.attacks_today >= cfg.meme_adversaire;
    return `<li class="jb-opp"><span class="jb-av" style="background:${esc(o.color || '#9E3543')}" aria-hidden="true">${esc(String(o.pseudo).slice(0, 2).toUpperCase())}</span>
      <span class="jb-opp-n">${esc(o.pseudo)}${o.has_deck ? '' : ' <span class="muted small">· pas de deck</span>'}</span>
      <button type="button" class="btn btn-primary" data-act="attaquer" data-id="${esc(o.id)}" ${!o.has_deck || full || !cfg.actif ? 'disabled' : ''}
        aria-label="Attaquer ${esc(o.pseudo)}${full ? ' (déjà attaqué aujourd’hui)' : ''}">${full ? 'Demain' : 'Attaquer'}</button></li>`;
  }).join('');
  const hist = d.history.length ? `<ul class="jb-hist">${d.history.map((b) => {
    const att = b.role === 'attaque';
    const other = att ? b.defender : b.attacker;
    const txt = att ? `Contre la défense de ${esc(other.pseudo)} : ${esc(resTxt(b.result, b.wins_a, b.wins_d)).toLowerCase()}`
      : `${esc(other.pseudo)} a attaqué ton deck : ${b.result === 'victoire' ? `duel perdu ${esc(b.wins_d)}-${esc(b.wins_a)}` : b.result === 'defaite' ? `défense tenue ${esc(b.wins_d)}-${esc(b.wins_a)}` : `égalité ${esc(b.wins_d)}-${esc(b.wins_a)}`}`;
    return `<li class="jb-h${!att && !b.seen ? ' is-new' : ''}"><span class="jb-h-t">${!att && !b.seen ? '<span class="pill pill-current">Nouveau</span> ' : ''}${txt}${b.paid ? ` · +${esc(b.paid)} ✦` : ''}</span>
      <span class="jb-h-a"><button type="button" class="btn btn-ghost" data-act="voir" data-id="${esc(b.id)}">Voir</button>
      ${!att ? `<button type="button" class="btn btn-ghost" data-act="attaquer" data-id="${esc(other.id)}">Revanche</button>` : ''}</span></li>`;
  }).join('')}</ul>` : '<p class="muted small">Aucune bataille pour l’instant.</p>';
  return `<div class="jb">
    <h2 class="jd-title jb-title">Arène de cartes</h2>
    <p class="muted small">Puissance = rareté (1 à 6) + 1 si brillante + 2 si la famille a l’avantage. Membre bat objet, objet bat lieu, lieu bat moment, moment bat membre. Aucune carte n’est perdue.</p>
    ${gains}
    <section class="card jb-sec" aria-labelledby="jb-deck-h"><div class="jb-sec-h"><h3 id="jb-deck-h">Mon deck de défense</h3>
      <button type="button" class="btn btn-ghost" data-act="deck">${d.deck ? 'Changer' : 'Créer mon deck'}</button></div>${deck}</section>
    <section class="card jb-sec" aria-labelledby="jb-opp-h"><h3 id="jb-opp-h">Attaquer un membre</h3>
      <p class="muted small">${esc(cfg.meme_adversaire)} attaque${cfg.meme_adversaire > 1 ? 's' : ''} par jour au plus contre un même membre.</p>
      <ul class="jb-opps">${opps}</ul></section>
    <section class="card jb-sec" aria-labelledby="jb-hist-h"><h3 id="jb-hist-h">Dernières batailles</h3>${hist}</section>
  </div>`;
}

/** Écran de choix des 5 cartes (deck de défense ou main d'attaque). */
function pickerHtml() {
  const esc = C.esc, att = S.view === 'attaque';
  const opp = att ? S.d.opponents.find((o) => o.id === S.target) : null;
  const slots = Array.from({ length: 5 }, (_, i) => {
    const c = S.pick[i] && S.d.copies.find((x) => x.copy_id === S.pick[i]);
    return c ? `<li class="jb-slot is-full">${mini(c)}<button type="button" class="btn btn-ghost jb-slot-x" data-act="retirer" data-i="${i}" aria-label="Retirer ${esc(c.name)} de la position ${i + 1}">Retirer</button></li>`
      : `<li class="jb-slot"><span class="jb-slot-n">${i + 1}</span><span class="visually-hidden">Position ${i + 1} vide</span></li>`;
  }).join('');
  return `<div class="jb">
    <button type="button" class="btn btn-ghost jb-back" data-act="retour">← Retour</button>
    <h2 class="jd-title jb-title">${att ? `Attaquer ${esc(opp?.pseudo || '')}` : 'Mon deck de défense'}</h2>
    <p class="muted small">Choisis 5 cartes dans l’ordre : la 1re affronte la 1re carte adverse, et ainsi de suite. Une seule carte mythique, identité ou unique.</p>
    <ol class="jb-slots" aria-label="Tes 5 cartes">${slots}</ol>
    <div class="jd-actions"><button type="button" class="btn btn-primary" data-act="${att ? 'lancer' : 'enregistrer'}" ${S.pick.length === 5 && !S.busy ? '' : 'disabled'}>${att ? 'Lancer la bataille' : 'Enregistrer mon deck'}</button>
      ${att && S.d.deck ? '<button type="button" class="btn btn-ghost" data-act="copier-deck">Reprendre mon deck</button>' : ''}</div>
    <div class="field"><label for="jb-filter">Chercher une carte</label><input class="input" id="jb-filter" value="${esc(S.filter)}" placeholder="Nom, rareté, famille…"></div>
    <p class="jb-pool-n muted small" id="jb-pool-n" role="status"></p>
    <div class="jb-pool" id="jb-pool"></div>
  </div>`;
}

/** Remplit la réserve de cartes (filtrée). */
function paintPool() {
  const box = P.querySelector('#jb-pool'); if (!box) return;
  const q = S.filter.trim().toLowerCase();
  const top = S.pick.some((id) => TOP.includes(S.d.copies.find((c) => c.copy_id === id)?.rarity));
  const list = S.d.copies.filter((c) => !S.pick.includes(c.copy_id)
    && (!q || `${c.name} ${rarityLabel(c.rarity)} ${familyLabel(c.family)}`.toLowerCase().includes(q)));
  P.querySelector('#jb-pool-n').textContent = `${list.length} carte${list.length > 1 ? 's' : ''} disponible${list.length > 1 ? 's' : ''}`;
  box.innerHTML = list.slice(0, 120).map((c) => {
    const blocked = S.pick.length >= 5 || (top && TOP.includes(c.rarity));
    return `<div class="jb-pick">${cardHtml(asCard(c), { size: 'sm', shiny: c.shiny, button: true, attrs: `data-act="choisir" data-copy="${C.esc(c.copy_id)}" ${blocked ? 'disabled' : ''}` })}
      <span class="jb-pow">Puissance ${C.esc(c.power)}</span></div>`;
  }).join('') || '<p class="muted">Aucune carte ne correspond.</p>';
}

/** Écran de résultat (maquette J15). */
function resultHtml(b) {
  const esc = C.esc, att = b.role === 'attaque';
  const mine = att ? b.attack : b.defense, theirs = att ? b.defense : b.attack;
  const rows = b.duels.map((x, i) => {
    const my = att ? x.a : x.d, th = att ? x.d : x.a;
    const win = x.win === 'nul' ? 'nul' : (x.win === 'a') === att ? 'gagne' : 'perdu';
    return `<li class="jb-duel is-${win}" style="--i:${i}">
      <div class="jb-duel-c">${mini(mine[i])}</div>
      <div class="jb-duel-m"><p class="jb-duel-p"><strong>${esc(my)}</strong> <span class="muted">contre</span> <strong>${esc(th)}</strong></p>
        <p class="jb-duel-r">${win === 'gagne' ? 'Gagné' : win === 'perdu' ? 'Duel perdu' : 'Nul'}</p>
        <p class="muted small">${x.adv ? '<span aria-hidden="true">➜ </span>' : ''}${esc(advText(b.attack[i], b.defense[i], x.adv))}</p></div>
      <div class="jb-duel-c">${mini(theirs[i])}</div></li>`;
  }).join('');
  const wMe = att ? b.wins_a : b.wins_d, wTh = att ? b.wins_d : b.wins_a;
  const big = wMe > wTh ? `Victoire ${wMe} – ${wTh}` : wMe < wTh ? `Défaite ${wMe} – ${wTh}` : `Égalité ${wMe} – ${wTh}`;
  const other = att ? b.defender : b.attacker;
  return `<div class="jb jb-res">
    <button type="button" class="btn btn-ghost jb-back" data-act="retour">← Retour</button>
    <p class="muted small">Arène · ${att ? `contre la défense de ${esc(other.pseudo)}` : `${esc(other.pseudo)} contre ta défense`}</p>
    <h2 class="jd-title" role="status">${esc(big)}</h2>
    ${b.paid ? `<p class="small">+${esc(b.paid)} ✦ crédités</p>` : ''}
    <div class="jb-res-h muted small"><span>${att ? 'Tes cartes' : 'Ta défense'}</span><span>${att ? 'Sa défense' : 'Ses cartes'}</span></div>
    <ol class="jb-duels">${rows}</ol>
    <p class="muted small">Puissance = rareté (1 à 6) + 1 si brillante + 2 si la famille a l’avantage. Membre bat objet, objet bat lieu, lieu bat moment, moment bat membre.</p>
    <div class="jd-actions"><button type="button" class="btn btn-ghost" data-act="${att ? 'attaquer' : 'deck'}" data-id="${esc(other.id)}">${att ? 'Changer mes cartes' : 'Changer ma défense'}</button>
      <button type="button" class="btn btn-primary" data-act="${att ? 'revanche' : 'attaquer'}" data-id="${esc(other.id)}">Revanche</button></div>
  </div>`;
}

/** Dévoile les duels l'un après l'autre (sauf mouvement réduit). */
function animate() {
  if (reduce()) return;
  P.querySelectorAll('.jb-duel').forEach((li, i) => { li.classList.add('is-hidden'); setTimeout(() => li.classList.remove('is-hidden'), 250 + i * 450); });
}

/* ---------- Actions ---------- */
async function onClick(e) {
  const b = e.target.closest('button');
  if (!b || !P.contains(b) || b.disabled) return;
  const a = b.dataset.act, d = S.d;
  if (a === 'retour') { S.view = 'accueil'; S.result = null; await load(); return; }
  if (a === 'deck') { S.view = 'deck'; S.pick = d.deck ? d.deck.map((c) => c.copy_id) : []; S.filter = ''; render(); return; }
  if (a === 'attaquer') { S.view = 'attaque'; S.target = b.dataset.id; S.pick = []; S.filter = ''; render(); P.querySelector('.jb-title')?.focus?.(); return; }
  if (a === 'copier-deck') { S.pick = d.deck.map((c) => c.copy_id); render(); return; }
  if (a === 'choisir') { if (S.pick.length < 5) S.pick.push(Number(b.dataset.copy)); render(); P.querySelector('#jb-pool button:not([disabled])')?.focus(); return; }
  if (a === 'retirer') { S.pick.splice(Number(b.dataset.i), 1); render(); return; }
  if (a === 'voir') { S.result = d.history.find((x) => x.id === b.dataset.id); S.view = 'resultat'; render(); return; }
  if (a === 'enregistrer') return save();
  if (a === 'lancer') return attack(S.target, S.pick);
  if (a === 'revanche') return attack(b.dataset.id, S.result.attack.map((c) => c.copy_id));
}

/** Enregistre le deck de défense. */
async function save() {
  S.busy = true; render();
  const { error } = await C.sb.rpc('hg_battle_set_deck', { p_copies: S.pick });
  S.busy = false;
  if (error) { C.toast(error.message, 'error'); render(); return; }
  C.toast('Deck de défense enregistré.', 'ok');
  S.view = 'accueil'; await load();
}

/** Lance une bataille et affiche le résultat. */
async function attack(target, copies) {
  S.busy = true; if (S.view !== 'resultat') render();
  const { data, error } = await C.sb.rpc('hg_battle_attack', { p_defender: target, p_copies: copies });
  S.busy = false;
  if (error) { C.toast(error.message, 'error'); render(); return; }
  S.result = data; S.view = 'resultat';
  render();
  // Données à jour (attaques du jour, historique) sans quitter le résultat.
  C.sb.rpc('hg_battle_me').then(({ data: x }) => { if (x) S.d = x; }, () => {});
}
