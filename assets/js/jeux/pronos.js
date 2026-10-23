// ===== Humane Gang — onglet « Pronostics » (J5) de la page Jeux =====
// Compétitions (Worlds, LEC, F1, JO, Eurovision…) en puces ; pour chaque match : choix et mise (0 à la mise maximale)
// jusqu'à l'heure de début, puis carte verrouillée avec la répartition du gang, puis résultat et gain.
// Les pronos des autres ne sont visibles qu'après le verrouillage (le serveur ne les renvoie pas avant).
// Paillettes seulement, mises plafonnées : c'est un jeu entre amis. Pas de logo : sigles en pastilles neutres.
// RPC : hg_pick_board(p_comp), hg_pick_bet(p_item, p_choice, p_stake) (migration 084).
// Exporte : mount(panel, ctx).
import { avatarHtml, errMsg } from '../core.js';

const nf = new Intl.NumberFormat('fr-CH');
const QUAND = new Intl.DateTimeFormat('fr-CH', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' });
/** Couleurs neutres des pastilles (aucune couleur d'équipe). */
const TEINTES = ['#7E93C9', '#ABA7A0', '#9A88C4', '#CF7055', '#6FA37F', '#E2C77E', '#E0909A', '#D8A75E'];
/** Mises proposées (bornées par la mise maximale du serveur). */
const MISES = [0, 10, 25, 50];
let minuteur = 0;

/** Charge la feuille de style une seule fois. */
function styles() {
  if (document.querySelector('link[data-jeux-css="pronos"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = new URL('../../css/jeux-pronos.css', import.meta.url).href; l.dataset.jeuxCss = 'pronos';
  document.head.append(l);
}

/** « 1 j 21 h », « 3 h 05 », « 12 min ». */
function reste(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'fermé';
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), j = Math.floor(h / 24);
  if (j >= 1) return `${j} j ${h % 24} h`;
  if (h >= 1) return `${h} h ${String(m % 60).padStart(2, '0')}`;
  return `${Math.max(1, m)} min`;
}

/**
 * Monte l'onglet.
 * @param {HTMLElement} panel Panneau vide.
 * @param {{sb: object, toast: Function, esc: Function}} ctx Contexte de la page Jeux.
 */
export async function mount(panel, { sb, me, toast, esc }) {
  styles();
  const S = { d: null, comp: null, brouillon: {}, busy: false };
  const root = document.createElement('div');
  root.className = 'pr';
  panel.append(root);

  /** Libellé d'une option. */
  const lib = (it, id) => it.options.find((o) => o.id === id)?.label ?? id;
  /** Pastille d'une option (sigle). */
  const pastille = (it, id) => {
    const i = Math.max(0, it.options.findIndex((o) => o.id === id));
    return `<span class="pr-chip" style="background:${TEINTES[i % TEINTES.length]}" aria-hidden="true">${esc(lib(it, id).slice(0, 4))}</span>`;
  };
  /** Choix et mise en cours d'édition d'un match (brouillon, sinon mon prono enregistré). */
  const brouillon = (it) => (S.brouillon[it.id] ||= { choice: it.mine?.choice ?? null, stake: it.mine?.stake ?? 0 });

  /** Carte d'un match ouvert. */
  function carteOuverte(it) {
    const b = brouillon(it);
    const max = S.d.cfg?.mise_max ?? 50;
    const deux = it.options.length === 2;
    const opts = it.options.map((o) => `<button type="button" class="pr-opt" data-item="${esc(it.id)}" data-choice="${esc(o.id)}" aria-pressed="${b.choice === o.id}">
        ${pastille(it, o.id)}<span class="small pr-optl">${b.choice === o.id ? 'Ton prono' : esc(o.label)}</span></button>`);
    const ligne = deux ? `${opts[0]}<span class="pr-vs" aria-hidden="true">contre</span>${opts[1]}` : opts.join('');
    const mises = MISES.filter((m) => m <= max).map((m) => `<button type="button" class="pr-stake" data-item="${esc(it.id)}" data-stake="${m}" aria-pressed="${b.stake === m}">${m}</button>`).join('');
    const choisi = b.choice ? `${esc(lib(it, b.choice))}, ${nf.format(b.stake)} Paillette${b.stake > 1 ? 's' : ''}` : '';
    const verbe = it.mine ? 'Modifier' : 'Valider';
    return `<article class="card pr-card" aria-labelledby="pr-t-${esc(it.id)}">
      <div class="pr-between"><span class="small muted" id="pr-t-${esc(it.id)}">${esc(it.label)}</span>
        <span class="pill small pr-clock" title="${esc(QUAND.format(new Date(it.locks_at)))}">ferme dans <span data-reste="${esc(it.locks_at)}">${esc(reste(it.locks_at))}</span></span></div>
      <div class="pr-opts${deux ? ' is-duel' : ''}" role="group" aria-label="Ton pronostic">${ligne}</div>
      <div><div class="pr-between small pr-mise-h"><span class="pr-b">Ta mise</span><span class="muted">solde ${esc(nf.format(S.d.balance ?? 0))} · ${esc(nf.format(S.d.cfg?.semaine ?? 300))} max / semaine</span></div>
        <div class="pr-stakes" role="group" aria-label="Ta mise en Paillettes">${mises}</div></div>
      <button type="button" class="btn btn-primary pr-send" data-send="${esc(it.id)}" ${b.choice ? '' : 'disabled'}>${b.choice ? `${verbe} : ${choisi}` : 'Choisis ton prono'}</button>
      <p class="small pr-error" role="alert" hidden></p>
      <p class="small muted pr-center">Les pronos des autres s’affichent après la fermeture.</p>
    </article>`;
  }

  /** Répartition du gang (barre et légende). */
  function repartition(it) {
    const d = it.dist || [];
    const tot = d.reduce((s, x) => s + x.n, 0);
    if (!tot) return '<p class="small muted">Personne n’a pronostiqué ce match.</p>';
    const parts = it.options.map((o, i) => ({ o, i, x: d.find((z) => z.choice === o.id) || { n: 0, stake: 0 } })).filter((p) => p.x.n);
    const aria = parts.map((p) => `${p.x.n} membre${p.x.n > 1 ? 's' : ''} sur ${p.o.label}`).join(', ');
    return `<div class="pr-bar" role="img" aria-label="${esc(aria)}">${parts.map((p) => `<span style="flex:${p.x.n};background:${TEINTES[p.i % TEINTES.length]}"></span>`).join('')}</div>
      <ul class="pr-legend small">${parts.map((p) => `<li><span class="pr-dot" style="background:${TEINTES[p.i % TEINTES.length]}" aria-hidden="true"></span>${esc(p.o.label)} : ${p.x.n} membre${p.x.n > 1 ? 's' : ''} · ${esc(nf.format(p.x.stake))} misées</li>`).join('')}</ul>`;
  }

  /** Carte d'un match verrouillé, terminé ou annulé. */
  function carteFermee(it) {
    const moi = it.mine ? `<p class="small">Ton prono : <b>${esc(lib(it, it.mine.choice))}</b>, ${esc(nf.format(it.mine.stake))} Paillette${it.mine.stake > 1 ? 's' : ''}</p>` : '<p class="small muted">Tu n’as pas pronostiqué ce match.</p>';
    if (it.cancelled) {
      return `<article class="card pr-card pr-cancel"><div class="pr-between"><span class="small muted">${esc(it.label)}</span><span class="pill small">annulé</span></div>
        <p class="small">Match annulé ou reporté : les mises sont rendues.</p>${moi}</article>`;
    }
    if (it.settled) {
      const gagne = it.mine && it.mine.choice === it.result;
      const gain = it.mine?.gain ? `<span class="pill pr-gain">+${esc(nf.format(it.mine.gain))} ✦</span>` : (it.mine ? '<span class="pill small">raté</span>' : '');
      return `<article class="card pr-card pr-done${gagne ? ' is-win' : ''}">
        <div class="pr-between"><div><div class="small pr-done-l">${esc(it.label)} · terminé</div>
          <div class="pr-disp">${esc(lib(it, it.result))} gagne</div></div>${gain}</div>
        ${repartition(it)}${moi}</article>`;
    }
    return `<article class="card pr-card">
      <div class="pr-between"><span class="small muted">${esc(it.label)} · en cours</span><span class="pill small">verrouillé</span></div>
      <div class="pr-between pr-disp">${it.options.slice(0, 2).map((o) => `<span>${esc(o.label)}</span>`).join('')}${it.options.length > 2 ? `<span class="small muted">+${it.options.length - 2}</span>` : ''}</div>
      ${repartition(it)}${moi}</article>`;
  }

  /** Dessine l'onglet. */
  function dessine() {
    const d = S.d;
    if (!d.comps?.length) {
      root.innerHTML = '<div class="card"><h2 class="pr-h">Pronostics</h2><p class="muted">Aucune compétition ouverte pour le moment. Le Staff ajoute les matchs des Worlds, de la LEC, de la F1, des JO ou de l’Eurovision au fil de l’année.</p></div>';
      return;
    }
    const mien = (d.board || []).find((r) => r.user_id === S.me);
    const puces = d.comps.map((c) => `<button type="button" class="pr-comp" data-comp="${esc(c.id)}" aria-pressed="${c.id === d.comp}">${esc(c.title)}</button>`).join('');
    const items = d.items || [];
    const cartes = items.length ? items.map((it) => (it.locked ? carteFermee(it) : carteOuverte(it))).join('') : '<p class="card muted">Pas encore de match dans cette compétition.</p>';
    const classement = (d.board || []).length ? `<section class="card pr-board" aria-labelledby="pr-board-h"><h3 class="pr-h3" id="pr-board-h">Classement</h3>
      <ol class="pr-rows">${d.board.slice(0, 10).map((r) => `<li class="pr-row${r.user_id === S.me ? ' is-me' : ''}"><span class="pr-rank">${esc(String(r.rank))}</span>${avatarHtml(r, 26)}<span class="pr-name">${esc(r.pseudo)}</span><span class="small muted">${esc(nf.format(r.points))} pt${r.points > 1 ? 's' : ''}</span></li>`).join('')}</ol></section>` : '';
    root.innerHTML = `<div class="pr-between pr-head"><h2 class="pr-h">Pronostics</h2>${mien ? `<span class="pill pill-current">${esc(String(mien.rank))}e · ${esc(nf.format(mien.points))} pt${mien.points > 1 ? 's' : ''}</span>` : ''}</div>
      <div class="pr-comps" role="group" aria-label="Compétitions">${puces}</div>
      <div class="pr-list">${cartes}</div>${classement}
      <p class="small muted pr-note">Paillettes seulement : mise de 0 à ${esc(nf.format(d.cfg?.mise_max ?? 50))} par match, ${esc(nf.format(d.cfg?.semaine ?? 300))} au plus par semaine. Bon prono : ta mise, ta part de la cagnotte des perdants et ${esc(nf.format(d.cfg?.bonus ?? 5))} Paillettes de bonus.</p>`;
  }

  /** Charge le tableau d'une compétition. */
  async function charge(comp = null) {
    const { data, error } = await sb.rpc('hg_pick_board', { p_comp: comp });
    if (error) throw error;
    S.d = data || {};
    S.brouillon = {};
    dessine();
  }

  /** Enregistre le prono d'un match. */
  async function envoie(id, bouton) {
    if (S.busy) return;
    const it = S.d.items.find((x) => x.id === id);
    const b = brouillon(it);
    const err = bouton.closest('.pr-card').querySelector('.pr-error');
    if (!b.choice) return;
    S.busy = true; bouton.disabled = true;
    try {
      const { data, error } = await sb.rpc('hg_pick_bet', { p_item: id, p_choice: b.choice, p_stake: b.stake });
      if (error) throw error;
      toast?.(`Prono enregistré : ${lib(it, b.choice)}, ${nf.format(b.stake)} Paillettes`, 'ok');
      if (typeof data?.balance === 'number') S.d.balance = data.balance;
      await charge(S.d.comp);
    } catch (e) {
      console.warn('[pronostics]', e);
      err.textContent = errMsg(e); err.hidden = false; bouton.disabled = false;
    } finally {
      S.busy = false;
    }
  }

  root.addEventListener('click', (e) => {
    const c = e.target.closest('[data-comp]');
    if (c) { charge(c.dataset.comp).catch((x) => toast?.(errMsg(x), 'error')); return; }
    const o = e.target.closest('[data-choice]');
    if (o) { brouillon(S.d.items.find((x) => x.id === o.dataset.item)).choice = o.dataset.choice; dessine(); root.querySelector(`[data-item="${CSS.escape(o.dataset.item)}"][data-choice="${CSS.escape(o.dataset.choice)}"]`)?.focus(); return; }
    const m = e.target.closest('[data-stake]');
    if (m) { brouillon(S.d.items.find((x) => x.id === m.dataset.item)).stake = Number(m.dataset.stake); dessine(); root.querySelector(`[data-item="${CSS.escape(m.dataset.item)}"][data-stake="${m.dataset.stake}"]`)?.focus(); return; }
    const s = e.target.closest('[data-send]');
    if (s) envoie(s.dataset.send, s);
  });

  root.innerHTML = '<p class="muted">Chargement des pronostics…</p>';
  try {
    S.me = me?.id ?? null;
    await charge();
  } catch (e) {
    console.warn('[pronostics]', e);
    root.innerHTML = `<p class="card muted">Pronostics indisponibles pour le moment (${esc(errMsg(e))}).</p>`;
  }
  // Compte à rebours : mis à jour chaque minute tant que l'onglet est monté.
  clearInterval(minuteur);
  minuteur = setInterval(() => { if (root.closest('[hidden]')) return; for (const s of root.querySelectorAll('[data-reste]')) s.textContent = reste(s.dataset.reste); }, 60000);
}
