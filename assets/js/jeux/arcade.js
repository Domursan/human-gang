// ===== Humane Gang — page Jeux, onglet « Arcade » (idée J18 : l'arcade du jour) =====
/*
 * Rôle : UN mini-jeu par jour, le même pour tout le gang, tiré au sort par le serveur à partir de la date de Zurich
 * (hg_arcade_board) parmi « Paillettes », « Raclette » et « Domu-mobile ». Le tirage du jour est affiché (les deux autres
 * jeux « pas ce soir »), avec le temps restant avant le prochain tirage (minuit, heure de Zurich).
 * Partie ouverte et fermée par le serveur (hg_arcade_start, hg_arcade_finish : durée et score vérifiés), une partie
 * récompensée par jour (petit montant), record personnel (navigateur) et meilleurs scores du gang de la semaine (5 lignes).
 * Maquette : idees-design/project/J18.dc.html.
 * Dépendances : ctx = { sb, me, toast, esc } (jeux.js) ; eggs/arcade.js (moteur) ; eggs/jeu-*.js (mini-jeux) ;
 * core/util.js (avatarHtml).
 * Exporte : mount(panel, ctx), unmount().
 */
import { creeArcade } from '../eggs/arcade.js';
import { avatarHtml } from '../core/util.js';

/** Mini-jeux connus : identifiant du serveur → module, nom, icône en pixel art (SVG 16 × 16). */
const JEUX = {
  paillettes: { module: '../eggs/jeu-paillettes.js', nom: 'Paillettes',
    icone: (c) => `<rect x="7" y="1" width="2" height="14" fill="${c[0]}"/><rect x="1" y="7" width="14" height="2" fill="${c[0]}"/><rect x="5" y="5" width="6" height="6" fill="${c[1]}"/>`,
    couleurs: ['#FCA301', '#FBD32D'] },
  raclette: { module: '../eggs/jeu-raclette.js', nom: 'Raclette',
    icone: (c) => `<rect x="2" y="4" width="12" height="7" fill="${c[1]}"/><rect x="2" y="4" width="12" height="2" fill="${c[0]}"/><rect x="5" y="7" width="2" height="2" fill="${c[2]}"/><rect x="10" y="8" width="2" height="2" fill="${c[2]}"/><rect x="1" y="11" width="14" height="2" fill="${c[3]}"/>`,
    couleurs: ['#FCA301', '#FBD32D', '#e2a52c', '#6b3a12'] },
  domu: { module: '../eggs/jeu-domu.js', nom: 'Domu-mobile',
    icone: (c) => `<rect x="3" y="5" width="10" height="4" fill="${c[0]}"/><rect x="5" y="3" width="6" height="3" fill="${c[1]}"/><rect x="4" y="9" width="3" height="3" fill="${c[2]}"/><rect x="9" y="9" width="3" height="3" fill="${c[2]}"/>`,
    couleurs: ['#9E3543', '#7E93C9', '#121212'] },
};
const GRIS = ['#8A867F', '#ABA7A0', '#3A3A40', '#3A3A40'];
const jourFmt = new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', weekday: 'long', day: 'numeric', month: 'short' });
let borne = null, minuteur = 0;

/** Meilleur score personnel (navigateur) d'un mini-jeu ; lecture et écriture prudentes. */
const record = {
  lire: (g) => { try { return Number(localStorage.getItem(`hg_arcade_best_${g}`)) || 0; } catch { return 0; } },
  ecrire: (g, n) => { try { localStorage.setItem(`hg_arcade_best_${g}`, String(n)); } catch { /* stockage bloqué */ } },
};

/** Charge la feuille de style de l'onglet une seule fois. */
function css() {
  if (document.querySelector('link[data-jeux-css="arcade"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('../../css/jeux-arcade.css', import.meta.url).href;
  l.dataset.jeuxCss = 'arcade';
  document.head.append(l);
}

/** Temps restant avant minuit à Zurich (prochain tirage), « 7 h 12 » ou « 12 min ». */
function avantTirage() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  const reste = 24 * 60 - (Number(p.hour) * 60 + Number(p.minute));
  const h = Math.floor(reste / 60), m = reste % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

/** Numéro de semaine ISO d'une date « AAAA-MM-JJ ». */
function semaine(day) {
  const d = new Date(`${day}T12:00:00Z`);
  const j = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - j + 3);
  const premier = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - premier) / 864e5 - 3 + ((premier.getUTCDay() + 6) % 7)) / 7);
}

/**
 * Meilleurs scores du gang de la semaine (5 lignes au plus).
 * @param {Array} top lignes { user_id, pseudo, avatar_url, color, best }
 * @param {string} meId membre connecté
 * @param {Function} esc échappement HTML
 */
function topHtml(top, meId, esc) {
  if (!Array.isArray(top) || !top.length) return '<li class="arc-empty muted small">Personne n’a encore joué cette semaine : à toi l’honneur !</li>';
  return top.map((r, i) => `<li class="arc-row${r.user_id === meId ? ' is-me' : ''}"${r.user_id === meId ? ' aria-current="true"' : ''}>
      <span class="arc-rank">${i + 1}</span>
      ${avatarHtml({ pseudo: r.pseudo, avatar_url: r.avatar_url, color: r.color }, 24)}
      <span class="arc-name">${esc(r.pseudo)}</span>
      <span class="arc-best">${esc(String(r.best))}</span>
    </li>`).join('');
}

/**
 * Tirage du jour : les trois mini-jeux, celui du jour mis en avant.
 * @param {string} g mini-jeu du jour
 * @param {Function} esc échappement HTML
 */
function tirageHtml(g, esc) {
  return Object.entries(JEUX).map(([id, j]) => {
    const on = id === g;
    return `<li class="arc-tire${on ? ' is-on' : ''}"${on ? ' aria-current="true"' : ''}>
      ${on ? '<span class="arc-tire-badge">Tiré au sort</span>' : ''}
      <svg width="34" height="34" viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges">${j.icone(on ? j.couleurs : GRIS)}</svg>
      <span class="arc-tire-nom">${esc(j.nom)}</span>
      <span class="small ${on ? 'arc-sand' : 'muted'}">${on ? 'jeu du jour' : 'pas ce soir'}</span>
    </li>`;
  }).join('');
}

/**
 * Monte l'onglet : tirage du jour, borne d'arcade, record, récompense, meilleurs scores.
 * @param {HTMLElement} panel section role="tabpanel" vide
 * @param {{sb: object, me: object, toast: Function, esc: Function}} ctx contexte de la page Jeux
 */
export async function mount(panel, ctx) {
  const { sb, me, toast, esc } = ctx;
  css();
  panel.innerHTML = '<p class="card arc-wait">Chargement de la borne…</p>';
  let B;
  try {
    const { data, error } = await sb.rpc('hg_arcade_board');
    if (error) throw error;
    B = data;
  } catch (e) {
    panel.innerHTML = `<p class="card">Impossible de charger l’arcade (${esc(e?.message || String(e))}).</p>`;
    return;
  }
  const g = JEUX[B?.game] ? B.game : 'paillettes';
  const { JEU } = await import(JEUX[g].module);
  let recu = !!B.rewarded_today;
  const gain = Number(B.reward) || 0;
  const jour = B.day ? new Date(`${B.day}T12:00:00Z`) : new Date();

  panel.innerHTML = `
    <div class="arc">
      <div><p class="eyebrow">Borne d’arcade</p><h2 class="arc-titre">Arcade 404</h2></div>
      <section class="card arc-tirage" aria-labelledby="arc-tirage-h">
        <div class="arc-between"><h3 class="arc-h" id="arc-tirage-h">Tirage du jour</h3><span class="small muted">${esc(jourFmt.format(jour))}</span></div>
        <ul class="arc-tires">${tirageHtml(g, esc)}</ul>
        <p class="small muted">Un seul mini-jeu par jour, tiré au sort à minuit, le même pour tout le gang. Prochain tirage dans <strong class="arc-fort" id="arc-tirage">${esc(avantTirage())}</strong>.</p>
      </section>
      <div class="arc-ecran">
        <canvas id="arc-canvas" class="arc-canvas" width="360" height="420" tabindex="0" role="application"
          aria-label="${esc(`Jeu du jour : ${JEU.titre}. ${JEU.aide}`)}" aria-describedby="arc-aide"></canvas>
        <div class="arc-hud" aria-hidden="true"><span>SCORE <span id="arc-score">0</span></span><span><span id="arc-temps">–</span> s</span></div>
      </div>
      <p id="arc-aide" class="small muted">${esc(JEU.aide)}</p>
      <p id="arc-msg" class="arc-msg" role="status"></p>
      <div class="arc-boutons">
        <button id="arc-pause" class="btn btn-ghost" type="button" disabled>Pause</button>
        <button id="arc-jouer" class="btn btn-primary" type="button">Jouer</button>
      </div>
      <div class="arc-boites">
        <div class="arc-boite"><p class="small muted">Ton record ${esc(JEU.titre)}</p><p class="arc-chiffre" id="arc-record">${esc(String(Math.max(record.lire(g), Number(B.my_best) || 0)))}</p></div>
        <div class="arc-boite"><p class="small muted" id="arc-gain-l">Partie récompensée</p><p class="arc-chiffre arc-sand" id="arc-gain"></p></div>
      </div>
      <section class="card arc-scores" aria-labelledby="arc-scores-h">
        <div class="arc-between"><h3 class="arc-h" id="arc-scores-h">Meilleurs scores · ${esc(JEU.titre)}</h3><span class="small muted">semaine ${esc(String(semaine(B.day || new Date().toISOString().slice(0, 10))))}</span></div>
        <ol class="arc-list" id="arc-top">${topHtml(B.top, me?.id, esc)}</ol>
      </section>
    </div>`;

  const $ = (s) => panel.querySelector(s);
  const scoreEl = $('#arc-score'), tempsEl = $('#arc-temps'), msg = $('#arc-msg'), bouton = $('#arc-jouer'), pause = $('#arc-pause');
  /** Boîte de récompense : à gagner, ou déjà reçue aujourd'hui. */
  const peintGain = () => {
    $('#arc-gain').innerHTML = gain <= 0 ? '<span class="small muted">pour la gloire</span>'
      : `+${gain} ✦ <span class="small muted arc-unite">${recu ? 'reçue aujourd’hui' : '1 / jour'}</span>`;
  };
  peintGain();
  clearInterval(minuteur);
  minuteur = setInterval(() => { const el = panel.querySelector('#arc-tirage'); if (el) el.textContent = avantTirage(); }, 60000);

  let run = null;
  borne = creeArcade({
    canvas: $('#arc-canvas'),
    jeu: JEU,
    onHud: (sc, t) => {
      if (scoreEl.textContent !== String(sc)) scoreEl.textContent = String(sc);
      if (tempsEl.textContent !== String(t)) tempsEl.textContent = String(t);
    },
    onDebut: () => {
      msg.textContent = '';
      bouton.textContent = 'Rejouer';
      bouton.disabled = true;
      pause.disabled = false;
      pause.textContent = 'Pause';
      // Le serveur ouvre la partie (heure de départ et jeu du jour fixés par lui).
      run = sb.rpc('hg_arcade_start').then(({ data, error }) => (error ? null : data?.run || null)).catch(() => null);
    },
    onFin: async (sc) => {
      bouton.disabled = false;
      pause.disabled = true;
      pause.textContent = 'Pause';
      const best = record.lire(g);
      if (sc > best) { record.ecrire(g, sc); $('#arc-record').textContent = String(sc); }
      msg.textContent = sc > 0 ? `Score : ${sc} !` : 'Aucun point cette fois. Rejoue !';
      const id = await run;
      if (!id) { msg.textContent += ' Score non enregistré (connexion au serveur impossible).'; return; }
      try {
        const { data, error } = await sb.rpc('hg_arcade_finish', { p_run: id, p_score: sc });
        if (error) throw error;
        if (data?.ok === false) { msg.textContent += ` Score non retenu : ${data.error}.`; return; }
        if (data?.reward > 0) { recu = true; peintGain(); toast(`🕹️ Arcade : +${data.reward} ✦`, 'success'); msg.textContent += ` +${data.reward} ✦`; }
        if (data?.new_best) msg.textContent += ' Nouveau record de la semaine !';
        if (Array.isArray(data?.top)) $('#arc-top').innerHTML = topHtml(data.top, me?.id, esc);
        $('#arc-record').textContent = String(Math.max(record.lire(g), Number(data?.best) || 0));
      } catch (e) {
        msg.textContent += ` Score non enregistré (${e?.message || e}).`;
      }
    },
  });
  bouton.addEventListener('click', () => borne.demarre());
  pause.addEventListener('click', () => {
    const enPause = borne.pause();
    pause.textContent = enPause ? 'Reprendre' : 'Pause';
    msg.textContent = enPause ? 'Pause. Reprends quand tu veux.' : '';
  });
}

/** Quitte l'onglet : la boucle d'animation et le minuteur s'arrêtent. */
export function unmount() { borne?.arrete(); borne = null; clearInterval(minuteur); }
