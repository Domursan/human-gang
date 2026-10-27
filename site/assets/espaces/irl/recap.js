// ===== Humane Gang — récap annuel au format « story » (/pages/irl/recap.html) =====
// Lecteur plein écran des chiffres de l'année (sorties, photos, Secret Santa, moments, badges, messages) et
// image verticale 1080 × 1920 téléchargeable. Données : RPC hg_year_recap (année) et hg_members (première année).
// Dépendances : core.js, ss-card.js (chargement d'image et téléchargement), icons.js, utils.js (pluralWord).
// Le récap est réservé aux membres. N'exporte que renderRecapImage (image du récap).
import { sb, initPage, esc, $, $$, errMsg, toast, currentLogo } from '../../commun/core.js';
import { loadImage, downloadCanvas } from './ss-card.js';
import { svg } from '../../commun/icons.js';
import { pluralWord } from '../../commun/utils.js';
import { cardHtml, rarityLabel } from '../cartes/cartes-ui.js';

const me = await initPage({ auth: 'member' });
const app = $('#app');

/** Vrai si l'utilisateur demande moins d'animations : les diapos restent alors plus longtemps, sans mouvement. */
const reduced = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } })();
/** Couleurs du logo (arc-en-ciel), pour les bandes et les barres du récap. */
const RAINBOW = ['#FE3104', '#FCA301', '#FBD32D', '#159946', '#2B5AE2', '#4E2398'];
/** Couleur d'accent de chaque diapo, qui revient en boucle. */
const SLIDE_COLORS = ['#9E3543', '#CF7055', '#D8A75E', '#6FA37F', '#7E93C9', '#9A88C4', '#E0909A', '#5FA3A3'];
/** Durée d'une diapo, en millisecondes, avant le passage automatique à la suivante. */
const DURATION = reduced ? 9000 : 6500;
/** Mois abrégés pour les dates affichées dans le récap. */
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
/** Format des nombres (locale fr-CH). */
const nf = new Intl.NumberFormat('fr-CH');

/* ---------- Année ---------- */
// Année du récap : l'année écoulée, sauf en décembre où l'année en cours est presque complète.
const now = new Date();
const defaultYear = now.getMonth() === 11 ? now.getFullYear() : now.getFullYear() - 1;
// Année demandée dans l'adresse (?year=…). Acceptée seulement si elle est plausible.
const qYear = Number(new URLSearchParams(location.search).get('year'));
let year = Number.isInteger(qYear) && qYear >= 2000 && qYear <= now.getFullYear() ? qYear : defaultYear;

const ICON = {
  pause: svg('pause', { size: 20, stroke: 2 }),
  play: svg('play2', { size: 20, stroke: 2 }),
  close: svg('close2', { size: 20, stroke: 2 }),
  prev: svg('back', { size: 24, stroke: 2 }),
  next: svg('next', { size: 24, stroke: 2 }),
  download: svg('download', { size: 20, stroke: 2 }),
  replay: svg('replay', { size: 20, stroke: 2 }),
};
/** Nombre animé : la valeur finale est gardée dans data-count, animateCounters la fait défiler (sauf mouvement réduit). */
const count = (n) => `<span class="rc-num" data-count="${Number(n) || 0}">${reduced ? nf.format(Number(n) || 0) : '0'}</span>`;
/** Date courte « 12 mars » à partir d'une date ISO ; chaîne vide si absente. */
const dateShort = (d) => { if (!d) return ''; const x = new Date(d); return `${x.getDate()} ${MONTHS[x.getMonth()]}`; };

/* =========================================================
   Construction des diapos
   ========================================================= */
/**
 * Vrai si l'année ne contient rien à raconter : pas de sortie, photo, Secret Santa, message, badge ni nouveau membre.
 * @param {object|null} g données « gang » du récap
 * @returns {boolean}
 */
function isEmptyYear(g) {
  if (!g) return true;
  return !(g.sorties?.length || g.photos || (g.secret_santa && g.secret_santa.participants) || g.moments?.length
    || g.badges_debloques || g.messages || g.nouveaux_membres?.length);
}

/**
 * Construit la liste des diapos du récap, à partir des données de hg_year_recap.
 * Chaque diapo ne s'ajoute que si elle a quelque chose à montrer. Une année vide donne une seule diapo de réconfort.
 * @param {object} r réponse de hg_year_recap : { gang, moi }
 * @returns {Array<{key: string, emoji: string, html: string, final?: boolean}>}
 */
function buildSlides(r) {
  const g = r?.gang || {}, moi = r?.moi || {};
  const S = [];
  S.push({
    key: 'intro', emoji: '✨',
    html: `<img class="rc-logo" src="${esc(currentLogo())}" alt="" data-on-error="remove">
      <p class="rc-eyebrow">Humane Gang</p>
      <h2 class="rc-title">Ton récap<br><span class="rc-year">${esc(year)}</span></h2>
      <p class="rc-sub">Une année de gang en quelques chiffres.<br><span class="rc-hint">Touche à droite pour avancer, maintiens pour mettre en pause.</span></p>`,
  });

  if (isEmptyYear(g)) {
    S.push({
      key: 'empty', emoji: '🌙', final: true,
      html: `<p class="rc-eyebrow">${esc(year)}</p>
        <h2 class="rc-title rc-title-sm">Une année toute calme</h2>
        <p class="rc-sub">Aucune sortie, photo ni Secret Santa enregistrés pour ${esc(year)}. Pas grave : les plus belles histoires du gang restent à écrire.</p>
        <div class="rc-actions">
          ${year > minYear ? `<button class="btn btn-light" type="button" data-year="${year - 1}">Voir ${year - 1}</button>` : ''}
          <a class="btn btn-ghost rc-btn-ghost" href="/pages/irl/irl.html">Proposer une sortie</a>
        </div>`,
    });
    return S;
  }

  const total = Number(g.membres_total) || 0, news = g.nouveaux_membres || [];
  S.push({
    key: 'membres', emoji: '🫂',
    html: `<p class="rc-eyebrow">Le gang</p>
      <p class="rc-lead">À la fin de ${esc(year)}, on était</p>
      <p class="rc-big">${count(total)}</p>
      <p class="rc-unit">${pluralWord(total, 'membre', 'membres')}</p>
      ${news.length ? `<p class="rc-sub">dont ${news.length} ${pluralWord(news.length, 'petit nouveau', 'petits nouveaux')} :</p>
        <ul class="rc-chips">${news.slice(0, 12).map((p) => `<li>${esc(p)}</li>`).join('')}${news.length > 12 ? `<li>+${news.length - 12}</li>` : ''}</ul>` : ''}`,
  });

  const sorties = g.sorties || [];
  if (sorties.length) {
    const top = sorties.slice().sort((a, b) => (b.presents || 0) - (a.presents || 0)).slice(0, 3);
    S.push({
      key: 'sorties', emoji: '📍',
      html: `<p class="rc-eyebrow">IRL</p>
        <p class="rc-big">${count(sorties.length)}</p>
        <p class="rc-unit">${pluralWord(sorties.length, 'sortie ensemble', 'sorties ensemble')}</p>
        <ol class="rc-list">${top.map((s) => `<li><strong>${esc(s.title)}</strong>
          <span>${esc([dateShort(s.starts_at), s.location].filter(Boolean).join(' · '))}</span>
          <em>${Number(s.presents) || 0} ${pluralWord(Number(s.presents) || 0, 'présent', 'présents')}</em></li>`).join('')}</ol>`,
    });
  }

  const pp = g.plus_presents || [];
  if (pp.length) {
    S.push({
      key: 'presents', emoji: '🏆',
      html: `<p class="rc-eyebrow">Toujours là</p>
        <h2 class="rc-title rc-title-sm">Les plus présents</h2>
        <ol class="rc-podium">${pp.slice(0, 3).map((p, i) => `<li class="rc-pod-${i + 1}"><span class="rc-pod-rank">${i + 1}</span>
          <strong>${esc(p.pseudo)}</strong><span>${count(p.n)} ${pluralWord(p.n, 'sortie', 'sorties')}</span></li>`).join('')}</ol>`,
    });
  }

  if (g.photos) {
    const tp = g.top_photographes || [];
    S.push({
      key: 'photos', emoji: '📸',
      html: `<p class="rc-eyebrow">Les albums</p>
        <p class="rc-big">${count(g.photos)}</p>
        <p class="rc-unit">${pluralWord(g.photos, 'photo partagée', 'photos partagées')}</p>
        ${tp.length ? `<p class="rc-sub">Paparazzis de l'année</p>
          <ol class="rc-list rc-list-compact">${tp.map((p) => `<li><strong>${esc(p.pseudo)}</strong><em>${nf.format(p.n)} ${pluralWord(p.n, 'photo', 'photos')}</em></li>`).join('')}</ol>` : ''}`,
    });
  }

  const ss = g.secret_santa;
  if (ss && ss.participants) {
    const pct = Math.round(((Number(ss.envoyes) || 0) / ss.participants) * 100);
    S.push({
      key: 'ss', emoji: '🎁',
      html: `<p class="rc-eyebrow">Secret Santa ${esc(year)}</p>
        <p class="rc-big">${count(ss.participants)}</p>
        <p class="rc-unit">${pluralWord(ss.participants, 'participant', 'participants')}</p>
        <p class="rc-sub">${count(ss.envoyes || 0)} ${pluralWord(ss.envoyes || 0, 'cadeau envoyé', 'cadeaux envoyés')}</p>
        <div class="rc-bar" role="img" aria-label="${pct} % des cadeaux envoyés"><span style="--p:${pct}%"></span></div>`,
    });
  }

  const moments = g.moments || [];
  if (moments.length) {
    S.push({
      key: 'moments', emoji: '🌟',
      html: `<p class="rc-eyebrow">Historique</p>
        <p class="rc-big">${count(moments.length)}</p>
        <p class="rc-unit">${pluralWord(moments.length, 'moment culte', 'moments cultes')}</p>
        <ul class="rc-list rc-list-compact">${moments.slice(-4).reverse().map((m) => `<li><strong>${esc(m.title)}</strong><em>${esc(dateShort(m.happened_on))}</em></li>`).join('')}</ul>`,
    });
  }

  if (g.messages || g.badges_debloques) {
    S.push({
      key: 'extras', emoji: '💬',
      html: `<p class="rc-eyebrow">Et aussi</p>
        <div class="rc-duo">
          <div><p class="rc-big rc-big-sm">${count(g.messages || 0)}</p><p class="rc-unit">${pluralWord(g.messages || 0, 'message échangé', 'messages échangés')}</p></div>
          <div><p class="rc-big rc-big-sm">${count(g.badges_debloques || 0)}</p><p class="rc-unit">${pluralWord(g.badges_debloques || 0, 'badge débloqué', 'badges débloqués')}</p></div>
        </div>`,
    });
  }

  // ----- Diapos ajoutées par l'idée S11 (chacune seulement si sa source existe et n'est pas vide) -----
  const rare = g.carte_plus_rare;
  if (rare) {
    S.push({
      key: 'carte', emoji: '🃏',
      html: `<p class="rc-eyebrow">Le gang · cartes</p>
        <h2 class="rc-title rc-title-sm">La carte la plus rare tirée par le gang</h2>
        <div class="rc-card">${cardHtml(rare, { shiny: !!rare.shiny, serial: rare.serial, size: 'md' })}</div>
        <p class="rc-sub">${esc(rare.name)} · ${esc(rarityLabel(rare.rarity))}${rare.obtained_at ? ` · tirée le ${esc(dateShort(rare.obtained_at))}` : ''}</p>`,
    });
  }
  const morceaux = g.morceaux;
  if (morceaux && Number(morceaux.n) >= 3) {
    S.push({
      key: 'morceaux', emoji: '🎵',
      html: `<p class="rc-eyebrow">Playlist du gang</p>
        <p class="rc-big">${count(morceaux.n)}</p>
        <p class="rc-unit">${pluralWord(Number(morceaux.n), 'morceau de la semaine', 'morceaux de la semaine')}</p>
        <ul class="rc-list rc-list-compact">${(morceaux.titres || []).slice(0, 4).map((t) => `<li><strong>${esc(t.title)}</strong>${t.artist ? `<em>${esc(t.artist)}</em>` : ''}</li>`).join('')}</ul>`,
    });
  }
  const cit = g.citations;
  if (cit && Number(cit.n) >= 3) {
    S.push({
      key: 'citations', emoji: '💬',
      html: `<p class="rc-eyebrow">Mur des citations</p>
        <p class="rc-big">${count(cit.n)}</p>
        <p class="rc-unit">${pluralWord(Number(cit.n), 'citation culte', 'citations cultes')}</p>
        <ul class="rc-quotes">${(cit.extraits || []).slice(0, 3).map((t) => `<li>« ${esc(t)} »</li>`).join('')}</ul>`,
    });
  }
  const maRare = moi.carte_plus_rare;
  const moiCartes = [
    [moi.boosters_ouverts, 'booster ouvert', 'boosters ouverts'],
  ].filter(([n]) => n != null);
  if (maRare || moiCartes.some(([n]) => Number(n) > 0)) {
    S.push({
      key: 'ma_carte', emoji: '✨',
      html: `<p class="rc-eyebrow">Ton année · cartes</p>
        ${maRare ? `<h2 class="rc-title rc-title-sm">Ta carte la plus rare</h2>
          <div class="rc-card">${cardHtml(maRare, { shiny: !!maRare.shiny, serial: maRare.serial, size: 'md' })}</div>
          <p class="rc-sub">${maRare.obtained_at ? `Tirée le <strong>${esc(dateShort(maRare.obtained_at))}</strong>` : esc(maRare.name)}</p>` : '<h2 class="rc-title rc-title-sm">Tes cartes</h2>'}
        <div class="rc-grid3">${moiCartes.map(([n, one, many]) => `<div><strong>${count(n || 0)}</strong><span>${pluralWord(Number(n) || 0, one, many)}</span></div>`).join('')}</div>`,
    });
  }

  const mine = [
    ['📍', moi.sorties, 'sortie', 'sorties'],
    ['📸', moi.photos, 'photo', 'photos'],
    ['💬', moi.messages_envoyes, 'message envoyé', 'messages envoyés'],
    ['🏅', (moi.badges || []).length, 'badge gagné', 'badges gagnés'],
  ];
  const quiet = !moi.sorties && !moi.photos && !moi.messages_envoyes && !(moi.badges || []).length && !moi.secret_santa;
  S.push({
    key: 'moi', emoji: '❤️', final: true,
    html: `<p class="rc-eyebrow">Ton année</p>
      <h2 class="rc-title rc-title-sm">${esc(me.pseudo)}</h2>
      ${quiet ? '<p class="rc-sub">Tu as été discret·e cette année… L\'an prochain, on compte sur toi !</p>' : ''}
      <ul class="rc-mine">
        ${mine.map(([e, n, one, many]) => `<li><span class="rc-mine-e" aria-hidden="true">${e}</span><strong>${count(n || 0)}</strong><span>${pluralWord(n || 0, one, many)}</span></li>`).join('')}
        <li class="rc-mine-wide"><span class="rc-mine-e" aria-hidden="true">🎁</span><span>${moi.secret_santa ? 'Tu as participé au Secret Santa' : 'Pas de Secret Santa pour toi cette fois'}</span></li>
      </ul>
      ${(moi.badges || []).length ? `<ul class="rc-chips">${moi.badges.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
      <div class="rc-actions">
        <button class="btn btn-light" type="button" data-act="download">${ICON.download} Télécharger mon récap</button>
        <button class="btn btn-ghost rc-btn-ghost" type="button" data-act="replay">${ICON.replay} Revoir</button>
      </div>`,
  });
  // Diapos masquées par le Staff (réglage recap.diapos_masquees) ; l'intro et « Ton année » restent toujours.
  const hidden = new Set(Array.isArray(r?.masquees) ? r.masquees : []);
  return S.filter((s) => !hidden.has(s.key));
}

/* =========================================================
   Rétrospective de l'anniversaire du gang (/pages/irl/recap.html?retro=1, migration 096)
   ========================================================= */
/** Mode rétrospective : toute la vie du serveur (RPC hg_gang_retro) au lieu d'une année. */
const RETRO = new URLSearchParams(location.search).get('retro') === '1';

/**
 * Diapos de la rétrospective : intro (âge du gang), une diapo par année (chiffres et moments retenus par le Staff),
 * chiffres cumulés, photo de famille (si le Staff l'a choisie). Aucun membre n'est nommé.
 * @param {object} r réponse de hg_gang_retro : { age, annee, years, totals, photo_famille }
 * @param {string|null} familyUrl adresse signée de la photo de famille
 * @returns {Array<{key: string, emoji: string, html: string, final?: boolean}>}
 */
function buildRetroSlides(r, familyUrl) {
  const S = [];
  const age = Number(r?.age) || 0, y0 = Number(r?.annee) || 2022;
  S.push({
    key: 'intro', emoji: '🎂',
    html: `<img class="rc-logo" src="${esc(currentLogo())}" alt="" data-on-error="remove">
      <p class="rc-eyebrow">Humane Gang · ${esc(y0)} → ${esc(y0 + age)}</p>
      <h2 class="rc-title">Le gang a<br><span class="rc-year">${esc(age)} ans</span></h2>
      <p class="rc-sub">Toutes ces années en quelques écrans.<br><span class="rc-hint">Touche à droite pour avancer, maintiens pour mettre en pause.</span></p>`,
  });
  for (const y of r?.years || []) {
    const ms = y.moments || [];
    const stats = [[y.sorties, 'sortie', 'sorties'], [y.photos, 'photo', 'photos'], [y.souvenirs, 'souvenir', 'souvenirs'], [y.secret_santa, 'lutin', 'lutins']]
      .filter(([n]) => Number(n) > 0);
    S.push({
      key: `y${y.year}`, emoji: '📅',
      html: `<p class="rc-eyebrow">${esc(y.year)}</p>
        ${ms.length ? `<h2 class="rc-title rc-title-sm">${esc(ms[0].title)}</h2>` : `<h2 class="rc-title rc-title-sm">L’année ${esc(y.year)}</h2>`}
        ${stats.length ? `<ul class="rc-chips">${stats.map(([n, one, many]) => `<li>${nf.format(Number(n))} ${pluralWord(Number(n), one, many)}</li>`).join('')}</ul>` : '<p class="rc-sub">Une année discrète, mais on était là.</p>'}
        ${ms.length > 1 ? `<ul class="rc-list rc-list-compact">${ms.slice(1).map((m) => `<li><strong>${esc(m.title)}</strong><em>${esc(dateShort(m.happened_on))}</em></li>`).join('')}</ul>` : ''}`,
    });
  }
  const t = r?.totals || {};
  S.push({
    key: 'totaux', emoji: '✨',
    html: `<p class="rc-eyebrow">En tout</p>
      <div class="rc-duo">
        <div><p class="rc-big rc-big-sm">${count(t.sorties || 0)}</p><p class="rc-unit">${pluralWord(t.sorties || 0, 'sortie', 'sorties')}</p></div>
        <div><p class="rc-big rc-big-sm">${count(t.photos || 0)}</p><p class="rc-unit">${pluralWord(t.photos || 0, 'photo', 'photos')}</p></div>
        <div><p class="rc-big rc-big-sm">${count(t.souvenirs || 0)}</p><p class="rc-unit">${pluralWord(t.souvenirs || 0, 'souvenir', 'souvenirs')}</p></div>
        <div><p class="rc-big rc-big-sm">${count(t.secret_santa || 0)}</p><p class="rc-unit">Secret Santa</p></div>
      </div>
      <p class="rc-sub">${nf.format(Number(t.cartes) || 0)} cartes ouvertes, ${nf.format(Number(t.membres) || 0)} membres aujourd’hui.</p>`,
  });
  S.push({
    key: 'fin', emoji: '❤️', final: true,
    html: `<p class="rc-eyebrow">Merci d’être là</p>
      ${familyUrl ? `<img class="rc-family" src="${esc(familyUrl)}" alt="Photo de famille du dernier rendez-vous" style="max-width:100%;max-height:42vh;border-radius:16px;object-fit:cover" data-on-error="remove">` : ''}
      <h2 class="rc-title rc-title-sm">Joyeux anniversaire au gang</h2>
      <div class="rc-actions">
        <button class="btn btn-light" type="button" data-act="replay">${ICON.replay} Revoir</button>
        <a class="btn btn-ghost rc-btn-ghost" href="/pages/compte/accueil.html">Retour à l’accueil</a>
      </div>`,
  });
  return S;
}

/* =========================================================
   Lecteur de story
   ========================================================= */
/** État du lecteur : diapos, index courant, temps écoulé, pause, appui maintenu, animation en cours et données du récap. */
const P = { slides: [], i: 0, elapsed: 0, last: 0, paused: false, held: false, raf: 0, recap: null, counterRaf: new Map() };

/**
 * Options du sélecteur d'année, de l'année en cours jusqu'à la première année disponible.
 * @param {number} minYear première année disponible
 * @returns {string} HTML des options
 */
function yearOptions(minYear) {
  const ys = [];
  for (let y = now.getFullYear(); y >= Math.min(minYear, year); y--) ys.push(y);
  return ys.map((y) => `<option value="${y}"${y === year ? ' selected' : ''}>${y}</option>`).join('');
}

/**
 * Dessine le lecteur plein écran (barre de progression, sélecteur d'année, pause, diapos, flèches).
 * Remplace le lecteur précédent s'il existe. Met aussi la page en mode « story ».
 * @param {number} minYear première année disponible, pour le sélecteur
 */
function renderStage(minYear) {
  document.querySelector('.rc-stage')?.remove();
  const stage = document.createElement('div');
  stage.className = 'rc-stage';
  stage.setAttribute('role', 'region');
  stage.setAttribute('aria-roledescription', 'story');
  stage.setAttribute('aria-label', `Récap ${year} du Humane Gang`);
  stage.innerHTML = `
    <div class="rc-backdrop" aria-hidden="true"></div>
    <div class="rc-story" id="rc-story">
      <div class="rc-stars" aria-hidden="true"></div>
      <div class="rc-top">
        <div class="rc-progress" aria-hidden="true">${P.slides.map(() => '<span><i></i></span>').join('')}</div>
        <div class="rc-toolbar">
          <label class="rc-year-pick"><span class="visually-hidden">Année du récap</span>
            <select id="rc-year">${yearOptions(minYear)}</select></label>
          <span class="rc-counter" id="rc-counter" aria-live="polite"></span>
          <button class="rc-icon-btn" type="button" id="rc-pause" aria-pressed="false" aria-label="Mettre en pause">${ICON.pause}</button>
          <a class="rc-icon-btn" href="/pages/compte/accueil.html" aria-label="Fermer le récap">${ICON.close}</a>
        </div>
      </div>
      <div class="rc-slides" id="rc-slides">
        ${P.slides.map((s, i) => `<section class="rc-slide rc-slide-${esc(s.key)}" style="--c:${SLIDE_COLORS[i % SLIDE_COLORS.length]}" aria-roledescription="diapositive" aria-label="${i + 1} sur ${P.slides.length}" hidden>
          <div class="rc-slide-inner"><span class="rc-emoji" aria-hidden="true">${s.emoji}</span>${s.html}</div></section>`).join('')}
      </div>
      <button class="rc-nav rc-nav-prev" type="button" id="rc-prev" aria-label="Diapositive précédente">${ICON.prev}</button>
      <button class="rc-nav rc-nav-next" type="button" id="rc-next" aria-label="Diapositive suivante">${ICON.next}</button>
    </div>`;
  document.body.append(stage);
  document.body.classList.add('rc-open');
  bindStage(stage);
}

/**
 * Affiche la diapo d'index i (bornée au premier et au dernier), remet son minuteur à zéro et lance ses compteurs.
 * @param {number} i index de la diapo
 * @param {{focus?: boolean}} [opts] focus : placer le curseur sur le premier bouton de la diapo
 */
function show(i, { focus = false } = {}) {
  const n = P.slides.length;
  P.i = Math.max(0, Math.min(n - 1, i));
  P.elapsed = 0; P.last = performance.now();
  $$('.rc-slide').forEach((el, k) => {
    const on = k === P.i;
    el.hidden = !on;
    el.classList.toggle('is-in', on);
  });
  $$('.rc-progress > span').forEach((el, k) => {
    el.classList.toggle('is-done', k < P.i);
    el.querySelector('i').style.transform = `scaleX(${k < P.i ? 1 : 0})`;
  });
  $('#rc-counter').textContent = `${P.i + 1} / ${n}`;
  $('#rc-prev').disabled = P.i === 0;
  $('#rc-next').disabled = P.i === n - 1;
  const cur = $$('.rc-slide')[P.i];
  animateCounters(cur);
  if (focus) cur.querySelector('.rc-actions .btn')?.focus();
  if (P.slides[P.i].final) { setBar(1); }
}
/** Remplit la barre de progression de la diapo courante à la fraction f (0 à 1). */
function setBar(f) { const bar = $$('.rc-progress > span i')[P.i]; if (bar) bar.style.transform = `scaleX(${Math.min(1, f)})`; }

/**
 * Boucle d'animation du lecteur : fait avancer le temps de la diapo et passe à la suivante quand la durée est atteinte.
 * Ne fait rien en pause, pendant un appui maintenu, ou quand l'onglet est caché. Les diapos finales (« final ») ne passent pas toutes seules.
 * @param {number} t horodatage fourni par requestAnimationFrame
 */
function tick(t) {
  P.raf = requestAnimationFrame(tick);
  const dt = t - P.last; P.last = t;
  if (P.paused || P.held || document.hidden) return;
  if (P.slides[P.i]?.final) return;
  P.elapsed += dt;
  setBar(P.elapsed / DURATION);
  if (P.elapsed >= DURATION) show(P.i + 1);
}

/**
 * Fait défiler les nombres d'une diapo de 0 jusqu'à leur valeur finale (ease-out). Immédiat si mouvement réduit ou valeur nulle.
 * @param {HTMLElement} root diapo dont on anime les nombres
 */
function animateCounters(root) {
  $$('[data-count]', root).forEach((el) => {
    const target = Number(el.dataset.count) || 0;
    cancelAnimationFrame(P.counterRaf.get(el));
    if (reduced || target === 0) { el.textContent = nf.format(target); return; }
    const t0 = performance.now(), dur = Math.min(1600, 700 + target * 12);
    /** Une image du compteur : fait monter le nombre jusqu'à sa valeur finale. */
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - (1 - k) ** 3;
      el.textContent = nf.format(Math.round(target * e));
      if (k < 1) P.counterRaf.set(el, requestAnimationFrame(step));
    };
    el.textContent = '0';
    P.counterRaf.set(el, requestAnimationFrame(step));
  });
}

/**
 * Met la lecture en pause ou la reprend, et met à jour le bouton et son libellé.
 * @param {boolean} on true pour mettre en pause
 */
function setPaused(on) {
  P.paused = on;
  const b = $('#rc-pause');
  b.setAttribute('aria-pressed', String(on));
  b.setAttribute('aria-label', on ? 'Reprendre la lecture' : 'Mettre en pause');
  b.innerHTML = on ? ICON.play : ICON.pause;
  $('#rc-story').classList.toggle('is-paused', on);
}

/**
 * Branche les interactions du lecteur : toucher gauche ou droite pour changer de diapo, glisser horizontal,
 * appui maintenu pour pause, boutons de la barre, changement d'année. Les boutons ne déclenchent pas de changement de diapo.
 * @param {HTMLElement} stage lecteur créé par renderStage
 */
function bindStage(stage) {
  const area = $('#rc-slides', stage);
  let down = null, holdT = 0, suppress = false;
  area.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, a, select, input, label')) return;
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
    suppress = false;
    holdT = setTimeout(() => { P.held = true; suppress = true; $('#rc-story').classList.add('is-held'); }, 220);
  });
  /** Fin d'un toucher ou d'un clic : arrête l'appui maintenu, et change de diapo si le geste était un glissement horizontal. */
  const release = (e) => {
    clearTimeout(holdT);
    if (P.held) { P.held = false; $('#rc-story').classList.remove('is-held'); P.last = performance.now(); }
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { suppress = true; show(P.i + (dx < 0 ? 1 : -1)); }
    down = null;
  };
  area.addEventListener('pointerup', release);
  area.addEventListener('pointercancel', () => { clearTimeout(holdT); P.held = false; down = null; $('#rc-story').classList.remove('is-held'); });
  area.addEventListener('click', (e) => {
    const btn = e.target.closest('button, a');
    if (btn) {
      if (btn.dataset.act === 'download') onDownload(btn);
      else if (btn.dataset.act === 'replay') { show(0); setPaused(false); }
      else if (btn.dataset.year) changeYear(Number(btn.dataset.year));
      return;
    }
    if (e.target.closest('select, input, label')) return;
    if (suppress) { suppress = false; return; }
    const r = area.getBoundingClientRect();
    show(P.i + (e.clientX - r.left < r.width / 3 ? -1 : 1));
  });
  $('#rc-prev', stage).addEventListener('click', () => show(P.i - 1));
  $('#rc-next', stage).addEventListener('click', () => show(P.i + 1));
  $('#rc-pause', stage).addEventListener('click', () => setPaused(!P.paused));
  $('#rc-year', stage).addEventListener('change', (e) => changeYear(Number(e.target.value)));
}
// Clavier : flèches pour changer de diapo, espace pour pause, Échap pour revenir à l'accueil.
document.addEventListener('keydown', (e) => {
  if (!document.querySelector('.rc-stage') || e.target.closest?.('select, input, textarea')) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); show(P.i + 1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); show(P.i - 1); }
  else if (e.key === ' ' && !e.target.closest?.('button, a')) { e.preventDefault(); setPaused(!P.paused); }
  else if (e.key === 'Escape') location.href = '/pages/compte/accueil.html';
});

/**
 * Passe à une autre année : met l'adresse à jour (?year=…) puis recharge le récap.
 * @param {number} y nouvelle année
 */
async function changeYear(y) {
  if (!y || y === year) return;
  year = y;
  const u = new URL(location.href); u.searchParams.set('year', String(y));
  history.replaceState(null, '', u);
  await load();
}

/* =========================================================
   Image téléchargeable 1080 × 1920
   ========================================================= */
/* Polices de l'image téléchargeable (les mêmes que celles du site). */
const PIXEL = '"Silkscreen", ui-monospace, monospace';
const DISPLAY = '"Archivo Black", system-ui, sans-serif';
const BODY = 'Inter, system-ui, sans-serif';
/** Attend les polices de l'image (au plus quatre secondes) pour que le téléchargement ne sorte pas en police de secours. */
async function waitFonts() {
  if (!document.fonts?.load) return;
  const all = Promise.all([
    document.fonts.load(`400 100px ${DISPLAY}`, '2025'), document.fonts.load(`700 40px ${PIXEL}`, 'AB'),
    document.fonts.load(`400 40px ${PIXEL}`, 'AB'), document.fonts.load(`500 40px ${BODY}`, 'Aa'), document.fonts.load(`700 40px ${BODY}`, 'Aa'),
  ]).catch(() => {});
  await Promise.race([all, new Promise((r) => setTimeout(r, 4000))]);
}
/** Espacement entre lettres pour le texte suivant. Ignoré si le navigateur ne le gère pas. */
const sp = (ctx, px) => { if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`; };

/**
 * Dessine l'image verticale du récap (1080 × 1920, format story) : fond étoilé, année, pseudo, chiffres personnels, et chiffres du gang.
 * Les étoiles sont tirées au sort à partir de l'année : la même année donne toujours le même fond.
 * @param {HTMLCanvasElement} canvas canvas à remplir
 * @param {object} r données du récap ({ gang, moi })
 * @param {string} pseudo pseudo affiché
 * @returns {Promise<void>}
 */
export async function renderRecapImage(canvas, r, pseudo) {
  const W = 1080, H = 1920;
  const [, logo] = await Promise.all([waitFonts(), loadImage(currentLogo(), { cors: true })]);
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, W * 0.3, H);
  g.addColorStop(0, '#2A1A22'); g.addColorStop(0.5, '#121216'); g.addColorStop(1, '#0B0B0E');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // étoiles déterministes
  let seed = year * 97;
  /** Nombre pseudo-aléatoire déterministe (suite à partir de la graine), entre 0 et 1. */
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 140; i++) {
    const s = rnd() < 0.85 ? 3 : 6;
    ctx.fillStyle = `rgba(242,239,234,${(0.15 + rnd() * 0.45).toFixed(2)})`;
    ctx.fillRect(Math.floor(rnd() * W), Math.floor(rnd() * H), s, s);
  }
  const halo = ctx.createRadialGradient(W / 2, 430, 20, W / 2, 430, 620);
  halo.addColorStop(0, 'rgba(224,144,154,0.22)'); halo.addColorStop(1, 'rgba(224,144,154,0)');
  ctx.fillStyle = halo; ctx.fillRect(0, 0, W, H);
  /** Bande arc-en-ciel pleine largeur, de hauteur h à partir de y. */
  const band = (y, h) => { const w = W / RAINBOW.length; RAINBOW.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(Math.floor(i * w), y, Math.ceil(w) + 1, h); }); };
  band(0, 22); band(H - 22, 22);

  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  if (logo) { ctx.imageSmoothingEnabled = false; const s = 220, k = Math.min(s / logo.width, s / logo.height); ctx.drawImage(logo, (W - logo.width * k) / 2, 110, logo.width * k, logo.height * k); ctx.imageSmoothingEnabled = true; }
  ctx.fillStyle = '#E2C77E'; ctx.font = `700 40px ${PIXEL}`; sp(ctx, 10);
  ctx.fillText('MON ANNÉE AU', W / 2, 420); ctx.fillText('HUMANE GANG', W / 2, 474); sp(ctx, 0);
  ctx.fillStyle = '#F2EFEA'; ctx.font = `400 300px ${DISPLAY}`;
  ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 8;
  ctx.fillText(String(year), W / 2, 770); ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#E0909A'; ctx.font = `400 64px ${DISPLAY}`;
  let p = String(pseudo || '').toUpperCase();
  while (p.length > 1 && ctx.measureText(p).width > W - 160) p = p.slice(0, -1);
  ctx.fillText(p, W / 2, 880);

  const moi = r?.moi || {}, gang = r?.gang || {};
  const rows = [
    [moi.sorties || 0, 'sortie', 'sorties'],
    [moi.photos || 0, 'photo partagée', 'photos partagées'],
    [moi.messages_envoyes || 0, 'message envoyé', 'messages envoyés'],
    [(moi.badges || []).length, 'badge gagné', 'badges gagnés'],
  ];
  const top = 960, rh = 132;
  rows.forEach(([n, one, many], i) => {
    const y = top + i * rh;
    ctx.fillStyle = 'rgba(242,239,234,0.06)'; ctx.fillRect(110, y, W - 220, rh - 20);
    ctx.fillStyle = RAINBOW[i]; ctx.fillRect(110, y, 14, rh - 20);
    ctx.textAlign = 'left'; ctx.fillStyle = '#F2EFEA'; ctx.font = `700 70px ${PIXEL}`;
    ctx.fillText(nf.format(n), 160, y + 82);
    const nw = ctx.measureText(nf.format(n)).width;
    ctx.fillStyle = '#C9C4BC'; ctx.font = `500 40px ${BODY}`;
    ctx.fillText(n > 1 ? many : one, 160 + nw + 28, y + 76);
  });
  const ssY = top + rows.length * rh;
  ctx.fillStyle = 'rgba(242,239,234,0.06)'; ctx.fillRect(110, ssY, W - 220, rh - 20);
  ctx.fillStyle = RAINBOW[4]; ctx.fillRect(110, ssY, 14, rh - 20);
  ctx.textAlign = 'left'; ctx.fillStyle = '#F2EFEA'; ctx.font = `500 40px ${BODY}`;
  ctx.fillText(moi.secret_santa ? 'Secret Santa : présent·e !' : 'Secret Santa : la prochaine fois', 160, ssY + 76);

  // Le gang en bref
  const gy = 1700;
  ctx.textAlign = 'center'; ctx.fillStyle = '#ABA7A0'; ctx.font = `400 28px ${PIXEL}`; sp(ctx, 6);
  ctx.fillText(`LE GANG EN ${year}`, W / 2, gy); sp(ctx, 0);
  const facts = [
    [gang.membres_total || 0, 'membres'], [(gang.sorties || []).length, 'sorties'], [gang.photos || 0, 'photos'], [(gang.moments || []).length, 'moments'],
  ];
  const cw = (W - 220) / facts.length;
  facts.forEach(([n, l], i) => {
    const cx = 110 + cw * i + cw / 2;
    ctx.fillStyle = '#F2EFEA'; ctx.font = `700 54px ${PIXEL}`; ctx.fillText(nf.format(n), cx, gy + 80);
    ctx.fillStyle = '#ABA7A0'; ctx.font = `500 28px ${BODY}`; ctx.fillText(l, cx, gy + 122);
  });
}

/**
 * Crée l'image du récap puis la télécharge. Met la lecture en pause pendant la préparation, puis la reprend si elle tournait.
 * @param {HTMLButtonElement} btn bouton « Télécharger mon récap »
 */
async function onDownload(btn) {
  // On ne reprend la lecture à la fin que si elle tournait avant le téléchargement.
  const wasPlaying = !P.paused;
  setPaused(true);
  btn.disabled = true;
  const label = btn.innerHTML;
  btn.textContent = 'Préparation…';
  try {
    const canvas = document.createElement('canvas');
    await renderRecapImage(canvas, P.recap, me.pseudo);
    const slug = String(me.pseudo || 'moi').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'moi';
    await downloadCanvas(canvas, `recap-hg-${year}-${slug}.png`);
    toast('Récap téléchargé', 'ok');
    import('../../commun/sound.js').then((m) => m.playSound?.('success')).catch(() => {});
  } catch (e) {
    toast(`Téléchargement impossible : ${errMsg(e)}`, 'error');
  } finally {
    btn.disabled = false; btn.innerHTML = label;
    if (wasPlaying) setPaused(false);
  }
}

/* =========================================================
   Chargement
   ========================================================= */
/** Première année disponible : l'année d'arrivée du plus ancien membre, mise à jour quand l'annuaire arrive. */
let minYear = now.getFullYear() - 1;
// Charge l'annuaire en arrière-plan pour connaître la première année. En cas d'échec, on garde la valeur par défaut.
const membersP = sb.rpc('hg_members').then(({ data }) => {
  const ys = (data || []).map((m) => new Date(m.member_since).getFullYear()).filter(Number.isFinite);
  if (ys.length) minYear = Math.min(...ys);
}, () => {});

/**
 * Charge le récap de l'année courante, construit les diapos, affiche le lecteur et démarre la lecture.
 * En cas d'erreur, un message avec un lien vers l'accueil remplace le lecteur.
 */
async function load() {
  cancelAnimationFrame(P.raf);
  $('#rc-fallback').textContent = 'Chargement du récap…';
  try {
    if (RETRO) {
      const { data, error } = await sb.rpc('hg_gang_retro');
      if (error) throw error;
      let fam = null;
      if (data?.photo_famille?.path) { try { fam = await (await import('./photos.js')).signedUrl(data.photo_famille.path); } catch { fam = null; } }
      P.recap = data || {};
      P.slides = buildRetroSlides(P.recap, fam);
      document.title = `Le gang a ${Number(data?.age) || ''} ans · Humane Gang`;
    } else {
      const [{ data, error }] = await Promise.all([sb.rpc('hg_year_recap', { p_year: year }), membersP]);
      if (error) throw error;
      P.recap = data || {};
      P.slides = buildSlides(P.recap);
      document.title = `Récap ${year} · Humane Gang`;
    }
    $('#rc-fallback').innerHTML = `Le récap ${esc(year)} s'affiche en plein écran. <a href="/pages/compte/accueil.html">Retour à l'accueil</a>`;
    renderStage(minYear);
    if (RETRO) { // rétrospective : pas de choix d'année
      document.querySelector('.rc-year-pick')?.remove();
      document.querySelector('.rc-stage')?.setAttribute('aria-label', 'Rétrospective du Humane Gang');
      $('#rc-fallback').innerHTML = 'La rétrospective s’affiche en plein écran. <a href="/pages/compte/accueil.html">Retour à l’accueil</a>';
    }
    setPaused(false);
    show(0);
    P.last = performance.now();
    P.raf = requestAnimationFrame(tick);
    $('#rc-next')?.focus({ preventScroll: true });
  } catch (e) {
    document.querySelector('.rc-stage')?.remove();
    document.body.classList.remove('rc-open');
    $('#rc-fallback').innerHTML = `Impossible de charger le récap ${esc(year)} (${esc(errMsg(e))}). <a href="/pages/compte/accueil.html">Retour à l'accueil</a>`;
  }
  app.removeAttribute('aria-busy');
}
await load();
