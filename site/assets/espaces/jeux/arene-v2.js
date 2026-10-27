// ===== Humane Gang — page « Jeux », Arène v2 (cotes, ligues, saisons ; règles dans docs/ARENE.md) =====
// Page : /pages/cartes/cartes.html#arene (onglet « Arène » de la page Cartes, monté par cartes.js). Visible des administrateurs seulement
// tant que hg_settings.arena.v2_public n'est pas vrai (bandeau « Aperçu admin »). Sinon, ou si la v2 est refusée, on
// affiche l'Arène actuelle (jeux/bataille.js), inchangée.
/*
 * Rôle : accueil (ligue, cote, combats restants, deck de défense, adversaires proposés), combat (5 cartes, comme
 * l'Arène actuelle), résultat (duels réutilisés), historique, classement de saison, règles (chiffres du réglage).
 * RPC : hg_arena_me, hg_arena_attack, hg_arena_seen, hg_arena_board ; deck de défense : hg_battle_set_deck (partagé).
 * Dépendances : cartes-ui.js (cardHtml, rarityLabel, familyLabel), jeux/bataille.js (mini, resultHtml, animate),
 * jeux/devine.js (loadCss), assets/css/jeux-arene.css.
 * Exporte : mount(panel, ctx).
 */
import { cardHtml, rarityLabel, familyLabel } from '../cartes/cartes-ui.js';
import { loadCss } from './devine.js';
import { mini, resultHtml, animate } from './bataille.js';

/** Raretés limitées : une seule carte de ces raretés par main (règle fondée sur la rareté, non sur la puissance). */
const TOP = ['mythique', 'identite', 'unique'];
const LIGUES = { bronze: 'Bronze', argent: 'Argent', or: 'Or', diamant: 'Diamant', legende: 'Légende' };
const ORDRE = ['bronze', 'argent', 'or', 'diamant', 'legende'];
const reduce = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
let P = null, C = null;
// view : accueil | historique | classement | regles (onglets) ; combat | deck (choix des 5 cartes) ; resultat
const S = { d: null, err: null, view: 'accueil', pick: [], target: null, targetName: '', result: null, busy: false, filter: '',
  board: null, boardErr: null, boardId: null };

/** Monte l'Arène v2 ; si le serveur refuse (membre, v2 fermée) ou ne répond pas, montre l'Arène actuelle. */
export async function mount(panel, ctx) {
  P = panel; C = ctx;
  loadCss('cartes-card'); loadCss('jeux-bataille'); loadCss('jeux-arene');
  panel.innerHTML = '<p class="muted">Chargement de l’Arène…</p>';
  let r = null;
  try { r = await C.sb.rpc('hg_arena_me'); } catch { r = null; }
  if (!r || r.error || !r.data) {
    const m = await import('./bataille.js');
    return m.mount(panel, ctx);
  }
  S.d = r.data; S.err = null;
  panel.addEventListener('click', onClick);
  panel.addEventListener('input', (e) => { if (e.target.id === 'jb-filter') { S.filter = e.target.value; paintPool(); } });
  panel.addEventListener('change', (e) => { if (e.target.id === 'ar-season') { S.boardId = e.target.value ? Number(e.target.value) : null; loadBoard(); } });
  render();
}

/** Relit l'écran (sans changer de vue). quiet : pas de redessin (ex. pendant l'affichage d'un résultat). */
async function load(quiet = false) {
  try {
    const { data, error } = await C.sb.rpc('hg_arena_me');
    if (error) throw error;
    S.d = data; S.err = null;
  } catch (e) { S.err = e?.message || String(e); }
  if (!quiet) render();
}

/** Charge le classement (saison en cours par défaut, ou saison choisie). */
async function loadBoard() {
  S.board = null; S.boardErr = null; render();
  try {
    const { data, error } = await C.sb.rpc('hg_arena_board', { p_season: S.boardId });
    if (error) throw error;
    S.board = data;
  } catch (e) { S.boardErr = e?.message || String(e); }
  render();
}

/* ---------- Outils d'affichage ---------- */
const sg = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');
const pl = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;
const jour = (iso) => { try { return new Date(iso).toLocaleDateString('fr-CH', { day: 'numeric', month: 'long' }); } catch { return ''; } };
/** Carte au format attendu par cardHtml. */
const asCard = (c) => ({ name: c.name, rarity: c.rarity, family: c.family, image_url: c.image_url, number: c.number });
/** Ligue suivante et son seuil, ou null en Légende. */
function ligueSuivante(lg, cfg) { const i = ORDRE.indexOf(lg); return i < 0 || i >= ORDRE.length - 1 ? null : { id: ORDRE[i + 1], at: cfg.seuils[ORDRE[i + 1]] }; }
/** Pourcentage de progression vers la ligue suivante. */
function progression(rating, lg, cfg) {
  const nx = ligueSuivante(lg, cfg); if (!nx) return 100;
  const lo = lg === 'bronze' ? 0 : cfg.seuils[lg];
  return Math.max(0, Math.min(100, Math.round(((rating - lo) / (nx.at - lo)) * 100)));
}
/** Pastille de ligue. */
const pastille = (lg) => `<span class="ar-pill ar-${lg}">${LIGUES[lg] || lg}</span>`;
/** Raison pour laquelle on ne peut pas attaquer ce membre aujourd'hui (vide si on peut). */
function raisonRefus(o) {
  const cfg = S.d.cfg, m = S.d.me;
  if (m.attacks_left <= 0) return 'plus de combat aujourd’hui';
  if (!o.has_deck) return 'pas de deck de défense';
  if (o.attacks_today >= cfg.meme_adversaire) return 'déjà attaqué aujourd’hui';
  if (o.received_today >= cfg.defenses_recues_jour) return 'a reçu assez d’attaques aujourd’hui';
  return '';
}

/* ---------- Rendu ---------- */
function render() {
  if (S.err) { P.innerHTML = `<p class="card">Arène indisponible : ${C.esc(S.err)}</p>`; return; }
  if (!S.d) return;
  if (S.view === 'resultat' && S.result) { P.innerHTML = shell(resultHtml(S.result, C.esc) + ligneCote(S.result), null); animate(P); return; }
  if (S.view === 'combat' || S.view === 'deck') { P.innerHTML = shell(pickerHtml(), null); paintPool(); return; }
  if (S.view === 'historique') { P.innerHTML = shell(historiqueHtml(), 'historique'); marquerVus(); return; }
  if (S.view === 'classement') { P.innerHTML = shell(classementHtml(), 'classement'); return; }
  if (S.view === 'regles') { P.innerHTML = shell(reglesHtml(), 'regles'); return; }
  P.innerHTML = shell(accueilHtml(), 'accueil');
}

/** Cadre commun : bandeau d'aperçu admin et onglets (sauf sur les écrans de combat). */
function shell(body, tab) {
  const d = S.d, esc = C.esc;
  const banner = d.preview ? '<p class="ar-banner" role="status"><strong>Aperçu admin : invisible pour les membres.</strong> Les membres gardent l’Arène actuelle tant que l’Arène v2 n’est pas ouverte dans le panel (section Arène).</p>' : '';
  const nouveaux = d.me.unseen > 0 ? ` (${esc(d.me.unseen)})` : '';
  const onglets = [['accueil', 'Accueil'], ['historique', `Historique${nouveaux}`], ['classement', 'Classement'], ['regles', 'Règles']];
  const nav = tab ? `<nav class="ar-tabs" aria-label="Sections de l’Arène">${onglets.map(([id, l]) => `<button type="button" class="btn btn-ghost ar-tab" data-act="onglet" data-tab="${id}"${tab === id ? ' aria-current="page"' : ''}>${l}</button>`).join('')}</nav>` : '';
  return `<div class="jb ar">${banner}${nav}${body}</div>`;
}

/** Ligne de cote sous le résultat d'un combat. */
function ligneCote(b) {
  const delta = b.delta ?? 0, avant = b.rating ?? 0;
  return `<p class="ar-cote small" aria-label="Cote après le combat">Cote : ${avant} → ${avant + delta} (${sg(delta)})</p>`;
}

/** Accueil : saison, ligue et cote, combats du jour, deck de défense, adversaires proposés. */
function accueilHtml() {
  const esc = C.esc, d = S.d, m = d.me, cfg = d.cfg;
  const nx = ligueSuivante(m.league, cfg);
  const reste = nx ? `${Math.max(0, nx.at - m.rating)} point${nx.at - m.rating > 1 ? 's' : ''} avant la ligue ${LIGUES[nx.id]}` : 'Tu es en Légende.';
  const pct = progression(m.rating, m.league, cfg);
  const nouvelles = m.unseen > 0 ? `<p class="card ar-new" role="status"><strong>${pl(m.unseen, 'attaque')} non vue${m.unseen > 1 ? 's' : ''}</strong> sur ta défense. <button type="button" class="btn btn-ghost" data-act="onglet" data-tab="historique">Voir</button></p>` : '';
  const deck = d.deck
    ? `<div class="jb-row5">${d.deck.map((c) => mini(c)).join('')}</div>`
    : `<p class="muted">${d.deck_ids ? 'Une carte de ton deck n’est plus dans ta collection : refais-le.' : 'Tu n’as pas encore de deck de défense. Sans lui, personne ne peut t’attaquer.'}</p>`;
  const opps = d.opponents.map((o) => {
    const why = raisonRefus(o);
    return `<li class="jb-opp"><span class="jb-av" style="background:${esc(o.color || '#9E3543')}" aria-hidden="true">${esc(String(o.pseudo).slice(0, 2).toUpperCase())}</span>
      <span class="jb-opp-n">${esc(o.pseudo)} <span class="small muted">· ${esc(o.rating)} pts</span> ${pastille(o.league)}${why ? `<br><span class="small muted">${esc(why)}</span>` : ''}</span>
      <button type="button" class="btn btn-primary" data-act="attaquer" data-id="${esc(o.id)}" data-nom="${esc(o.pseudo)}" ${why ? 'disabled' : ''}
        aria-label="Attaquer ${esc(o.pseudo)}${why ? ' (' + esc(why) + ')' : ''}">Attaquer</button></li>`;
  }).join('') || '<li class="muted small">Aucun adversaire pour l’instant.</li>';
  return `${nouvelles}
    <p class="muted small">${esc(d.season.label)} · jusqu’au ${esc(jour(d.season.ends_at))}</p>
    <section class="card jb-sec ar-ligue" aria-labelledby="ar-ligue-h"><h3 id="ar-ligue-h" class="visually-hidden">Ta ligue</h3>
      <div class="ar-ligue-h">${pastille(m.league)}<strong class="ar-cote-n">${esc(m.rating)} pts</strong></div>
      <div class="ar-bar" role="img" aria-label="Progression vers la ligue suivante : ${pct} %"><span style="width:${pct}%"></span></div>
      <p class="small muted">${esc(reste)}</p>
      <p class="small">${esc(pl(m.wins, 'victoire'))} · ${esc(m.losses)} défaite${m.losses > 1 ? 's' : ''} · ${esc(m.draws)} nul${m.draws > 1 ? 's' : ''}${m.rank ? ` · ${esc(m.rank)}ᵉ du classement` : ''}</p>
      ${m.qualified ? '' : `<p class="small muted">Encore ${esc(Math.max(0, cfg.min_combats - m.matches))} combat${cfg.min_combats - m.matches > 1 ? 's' : ''} pour être classé en fin de saison.</p>`}
    </section>
    <section class="card jb-sec" aria-labelledby="ar-jour-h"><h3 id="ar-jour-h">Aujourd’hui</h3>
      <p>${esc(m.attacks_left)} attaque${m.attacks_left > 1 ? 's' : ''} restante${m.attacks_left > 1 ? 's' : ''} sur ${esc(cfg.attaques_jour)}</p>
      <p class="small muted">Paillettes d’Arène : ${esc(m.paid_today)} ✦ sur ${esc(cfg.plafond_jour)} ✦ au plus. Défense reçue : ${esc(m.received_today)} sur ${esc(cfg.defenses_recues_jour)}.</p>
    </section>
    <section class="card jb-sec" aria-labelledby="ar-deck-h"><div class="jb-sec-h"><h3 id="ar-deck-h">Mon deck de défense</h3>
      <button type="button" class="btn btn-ghost" data-act="deck">${d.deck ? 'Changer' : 'Créer mon deck'}</button></div>${deck}</section>
    <section class="card jb-sec" aria-labelledby="ar-opp-h"><h3 id="ar-opp-h">Attaquer un membre</h3>
      <p class="muted small">Les 8 membres les plus proches de ta cote. ${esc(cfg.meme_adversaire)} attaque${cfg.meme_adversaire > 1 ? 's' : ''} par jour au plus contre un même membre.</p>
      <ul class="jb-opps">${opps}</ul></section>`;
}

/** Écran de choix des 5 cartes (deck de défense ou main d'attaque). */
function pickerHtml() {
  const esc = C.esc, att = S.view === 'combat';
  const slots = Array.from({ length: 5 }, (_, i) => {
    const c = S.pick[i] && S.d.copies.find((x) => x.copy_id === S.pick[i]);
    return c ? `<li class="jb-slot is-full">${mini(c)}<button type="button" class="btn btn-ghost jb-slot-x" data-act="retirer" data-i="${i}" aria-label="Retirer ${esc(c.name)} de la position ${i + 1}">Retirer</button></li>`
      : `<li class="jb-slot"><span class="jb-slot-n">${i + 1}</span><span class="visually-hidden">Position ${i + 1} vide</span></li>`;
  }).join('');
  return `<button type="button" class="btn btn-ghost jb-back" data-act="retour">← Retour</button>
    <h2 class="jd-title jb-title">${att ? `Attaquer ${esc(S.targetName)}` : 'Mon deck de défense'}</h2>
    <p class="muted small">Choisis 5 cartes dans l’ordre : la 1re affronte la 1re carte adverse, et ainsi de suite. Une seule carte mythique, identité ou unique.</p>
    <ol class="jb-slots" aria-label="Tes 5 cartes">${slots}</ol>
    <div class="jd-actions"><button type="button" class="btn btn-primary" data-act="${att ? 'lancer' : 'enregistrer'}" ${S.pick.length === 5 && !S.busy ? '' : 'disabled'}>${att ? 'Lancer le combat' : 'Enregistrer mon deck'}</button>
      ${att && S.d.deck ? '<button type="button" class="btn btn-ghost" data-act="copier-deck">Reprendre mon deck</button>' : ''}</div>
    <div class="field"><label for="jb-filter">Chercher une carte</label><input class="input" id="jb-filter" value="${esc(S.filter)}" placeholder="Nom, rareté, famille…"></div>
    <p class="jb-pool-n muted small" id="jb-pool-n" role="status"></p>
    <div class="jb-pool" id="jb-pool"></div>`;
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

/** Historique : attaques et défenses, cote et Paillettes de chaque combat. */
function historiqueHtml() {
  const esc = C.esc, liste = S.d.history;
  if (!liste.length) return '<h2 class="jd-title jb-title">Historique</h2><p class="muted small">Aucun combat pour l’instant.</p>';
  return `<h2 class="jd-title jb-title">Historique</h2>
    <ul class="jb-hist">${liste.map((b) => {
      const att = b.role === 'attaque';
      const autre = att ? b.defender : b.attacker;
      const txt = att ? `Contre la défense de ${esc(autre.pseudo)} : ${esc(b.result === 'victoire' ? 'victoire' : b.result === 'defaite' ? 'défaite' : 'égalité')} ${esc(b.wins_a)} – ${esc(b.wins_d)}`
        : `${esc(autre.pseudo)} a attaqué ta défense : ${b.result === 'victoire' ? `duel perdu ${esc(b.wins_d)}–${esc(b.wins_a)}` : b.result === 'defaite' ? `défense tenue ${esc(b.wins_d)}–${esc(b.wins_a)}` : `égalité ${esc(b.wins_d)}–${esc(b.wins_a)}`}`;
      const gains = [`${sg(b.delta)} pts`, b.paid ? `+${esc(b.paid)} ✦` : ''].filter(Boolean).join(' · ');
      return `<li class="jb-h${!att && !b.seen ? ' is-new' : ''}"><span class="jb-h-t">${!att && !b.seen ? '<span class="pill pill-current">Nouveau</span> ' : ''}${txt}<br><span class="small muted">${esc(gains)} · ${esc(jour(b.created_at))}</span></span>
        <span class="jb-h-a"><button type="button" class="btn btn-ghost" data-act="voir" data-id="${esc(b.id)}">Voir</button>
        ${att ? `<button type="button" class="btn btn-ghost" data-act="attaquer" data-id="${esc(autre.id)}" data-nom="${esc(autre.pseudo)}">Revanche</button>` : ''}</span></li>`;
    }).join('')}</ul>`;
}

/** Marque les défenses reçues comme vues, après affichage de l'historique. */
async function marquerVus() {
  if (!S.d.me.unseen) return;
  try { await C.sb.rpc('hg_arena_seen'); } catch { /* sans gravité : relancé à la prochaine ouverture */ }
  S.d.me.unseen = 0;
  S.d.history.forEach((b) => { b.seen = true; });
  // Ne redessine que le libellé de l'onglet et les marques « Nouveau ».
  const tab = P.querySelector('.ar-tab[data-tab="historique"]');
  if (tab) tab.textContent = 'Historique';
  P.querySelectorAll('.jb-h.is-new').forEach((li) => { li.classList.remove('is-new'); li.querySelector('.pill')?.remove(); });
}

/** Classement de la saison (choix de la saison : en cours ou passée). */
function classementHtml() {
  const esc = C.esc, d = S.d;
  const saisons = [`<option value="">${esc(d.season.label)} (en cours)</option>`]
    .concat(d.past.map((p) => `<option value="${esc(p.id)}"${S.boardId === p.id ? ' selected' : ''}>${esc(p.season)}</option>`)).join('');
  let corps;
  if (S.boardErr) corps = `<p class="card">Classement indisponible : ${esc(S.boardErr)}</p>`;
  else if (!S.board) corps = '<p class="muted">Chargement du classement…</p>';
  else {
    const b = S.board;
    const lignes = b.top.map((x) => `<li class="ar-row${x.user_id === d.me_id ? ' is-me' : ''}"><span class="ar-rk">${esc(x.rank)}</span>
      <span class="ar-nom">${esc(x.pseudo)}</span>${pastille(x.league)}<span class="ar-pts">${esc(x.rating)} pts</span>
      <span class="small muted">${esc(x.wins)} victoire${x.wins > 1 ? 's' : ''} · ${esc(x.matches)} combat${x.matches > 1 ? 's' : ''}${x.paid ? ` · +${esc(x.paid)} ✦` : ''}</span></li>`).join('');
    corps = `<p class="muted small">${esc(pl(b.participants, 'membre'))} classé${b.participants > 1 ? 's' : ''}${b.season.status === 'close' ? ' · saison terminée' : ''}</p>
      ${b.top.length ? `<ol class="ar-top" aria-label="Classement de la saison">${lignes}</ol>` : '<p class="muted">Personne n’est encore classé.</p>'}
      ${b.me ? `<p class="small">Toi : ${esc(b.me.rank ? `${b.me.rank}ᵉ` : 'non classé')} · ${esc(b.me.rating)} pts · ${pastille(b.me.league)}</p>` : ''}`;
  }
  return `<h2 class="jd-title jb-title">Classement</h2>
    <div class="field"><label for="ar-season">Saison</label><select class="input" id="ar-season">${saisons}</select></div>
    ${corps}
    <p class="muted small">Fin de saison : récompenses selon la ligue finale et le podium (voir Règles).</p>`;
}

/** Règles : résumé de docs/ARENE.md, avec les chiffres réglés dans le panel. */
function reglesHtml() {
  const c = S.d.cfg, esc = C.esc;
  return `<h2 class="jd-title jb-title">Règles de l’Arène</h2>
    <section class="card jb-sec"><h3>Points et ligues</h3>
      <p>Chacun part à ${esc(c.depart)} points. Battre un membre plus fort rapporte davantage. Une victoire à cote égale vaut ${esc(Math.round(c.k / 2))} points, une égalité ne change rien, une défaite fait perdre autant. Le plancher est ${esc(c.plancher)} points.</p>
      <ul class="ar-rules">
        <li>${pastille('bronze')} moins de ${esc(c.seuils.argent)} pts</li>
        <li>${pastille('argent')} ${esc(c.seuils.argent)} à ${esc(c.seuils.or - 1)} pts</li>
        <li>${pastille('or')} ${esc(c.seuils.or)} à ${esc(c.seuils.diamant - 1)} pts</li>
        <li>${pastille('diamant')} ${esc(c.seuils.diamant)} à ${esc(c.seuils.legende - 1)} pts</li>
        <li>${pastille('legende')} ${esc(c.seuils.legende)} pts et plus</li>
      </ul></section>
    <section class="card jb-sec"><h3>Combats</h3>
      <p>Un combat = 5 duels, comme l’Arène actuelle (puissance, avantages de famille). Plus de duels gagnés = victoire.</p>
      <ul class="ar-rules">
        <li>${esc(c.attaques_jour)} attaques par jour, au plus ${esc(c.meme_adversaire)} contre un même membre.</li>
        <li>Un membre ne reçoit pas plus de ${esc(c.defenses_recues_jour)} attaques par jour.</li>
        <li>Les adversaires proposés sont les membres les plus proches de ta cote.</li>
      </ul></section>
    <section class="card jb-sec"><h3>Paillettes</h3>
      <ul class="ar-rules">
        <li>1re victoire du jour : ${esc(c.gain_jour)} ✦.</li>
        <li>Défense tenue : ${esc(c.gain_defense)} ✦, ${esc(c.defenses_jour)} par jour au plus.</li>
        <li>Plafond Arène : ${esc(c.plafond_jour)} ✦ par jour.</li>
      </ul></section>
    <section class="card jb-sec"><h3>Saisons</h3>
      <p>Une saison dure ${esc(c.duree_jours)} jours. Au début de la suivante, ${esc(c.reset_pct)} % de l’écart avec ${esc(c.depart)} points est gardé. Il faut ${esc(c.min_combats)} combats pour être classé.</p>
      <ul class="ar-rules">
        <li>Argent : ${esc(c.recompenses.argent)} ✦ · Or : ${esc(c.recompenses.or)} ✦</li>
        <li>Diamant : ${esc(c.recompenses.diamant)} ✦ et ${esc(c.boosters.diamant)} booster Classique</li>
        <li>Légende : ${esc(c.recompenses.legende)} ✦ et ${esc(c.boosters.legende)} boosters Classique</li>
        <li>Podium : 1er ${esc(c.podium['1'])} ✦, 2e ${esc(c.podium['2'])} ✦, 3e ${esc(c.podium['3'])} ✦. Plafond : ${esc(c.plafond_saison)} ✦ par saison.</li>
      </ul></section>`;
}

/* ---------- Actions ---------- */
async function onClick(e) {
  const b = e.target.closest('button');
  if (!b || !P.contains(b) || b.disabled) return;
  const a = b.dataset.act, d = S.d;
  if (a === 'onglet') {
    S.view = b.dataset.tab; S.result = null;
    if (S.view === 'classement') { loadBoard(); return; }
    render(); return;
  }
  if (a === 'retour') { S.view = 'accueil'; S.result = null; await load(); return; }
  if (a === 'deck') { S.view = 'deck'; S.pick = d.deck ? d.deck.map((c) => c.copy_id) : []; S.filter = ''; render(); return; }
  if (a === 'attaquer') {
    S.view = 'combat'; S.target = b.dataset.id; S.targetName = b.dataset.nom || S.result?.attacker?.pseudo || ''; S.pick = []; S.filter = '';
    render(); P.querySelector('.jb-title')?.focus?.(); return;
  }
  if (a === 'copier-deck') { S.pick = d.deck.map((c) => c.copy_id); render(); return; }
  if (a === 'choisir') { if (S.pick.length < 5) S.pick.push(Number(b.dataset.copy)); render(); P.querySelector('#jb-pool button:not([disabled])')?.focus(); return; }
  if (a === 'retirer') { S.pick.splice(Number(b.dataset.i), 1); render(); return; }
  if (a === 'voir') { S.result = d.history.find((x) => x.id === b.dataset.id); S.view = 'resultat'; render(); return; }
  if (a === 'enregistrer') return save();
  if (a === 'lancer') return attack(S.target, S.pick);
  if (a === 'revanche') {
    const h = S.result;
    const cible = h.role === 'attaque' ? h.defender.id : h.attacker.id;
    return attack(cible, h.attack.map((c) => c.copy_id));
  }
}

/** Enregistre le deck de défense (RPC de l'Arène actuelle, partagée). */
async function save() {
  S.busy = true; render();
  const { error } = await C.sb.rpc('hg_battle_set_deck', { p_copies: S.pick });
  S.busy = false;
  if (error) { C.toast(error.message, 'error'); render(); return; }
  C.toast('Deck de défense enregistré.', 'ok');
  S.view = 'accueil'; await load();
}

/** Lance un combat et affiche le résultat. */
async function attack(cible, copies) {
  S.busy = true; if (S.view !== 'resultat') render();
  const { data, error } = await C.sb.rpc('hg_arena_attack', { p_defender: cible, p_copies: copies });
  S.busy = false;
  if (error) { C.toast(error.message, 'error'); render(); return; }
  S.result = data; S.view = 'resultat';
  render();
  // Cotes, compteurs et historique à jour sans quitter le résultat.
  load(true);
}
