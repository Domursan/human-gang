// ===== Humane Gang — page « Jeux » : moteur des jeux du jour « devine en 6 essais » (Carte, Jeu vidéo, Pochette, Réplique, Pays, Plat) =====
/*
 * Rôle : un seul moteur pour les six jeux du jour à deviner en 6 essais. Chaque jeu a sa présentation (carte floutée,
 * capture très zoomée, pochette pixelisée, réplique, silhouette de pays, photo de plat) ; la partie suit les mêmes règles :
 * 6 essais, un indice à chaque erreur ou « Passer », la réponse seulement en fin de partie. Pays et plat donnent la
 * distance et la direction à chaque essai. Barème : essai 1 = 6 points … essai 6 = 1 point.
 * Réponses : seulement celles de la liste « choix » de l'état (le serveur refuse les autres) ; le champ propose des
 * suggestions sans accents ni majuscules et « Valider » reste désactivé tant que la saisie n'est pas une réponse de la liste.
 * RPC : hg_nj_etat(p_jeu), hg_nj_essai(p_jeu, p_texte) (p_texte null = passer). Les modules d'onglet sont dans jeux/nj-*.js.
 * Exporte : monter(panel, ctx, jeu), resumer(ctx, jeu).
 */
import { loadCss, boardHtml, copyText, normalize } from './devine.js';
import { boutonReponses } from '../core/admin-reponses.js';

/** Présentation des six jeux : titre, consignes et libellé du champ de réponse. */
const JEUX = {
  carte: { titre: 'Carte mystère', champ: 'Nom de la carte', regles: [
    'Une carte du jeu de cartes du site, floutée.',
    'Chaque erreur ou « Passer » la rend plus nette et débloque un indice.',
    'Choisis le nom dans la liste des suggestions.'] },
  jv: { titre: 'Jeu vidéo du jour', champ: 'Nom du jeu', regles: [
    'Une capture d’écran très zoomée d’un jeu vidéo.',
    'Le zoom se relâche à chaque erreur ou « Passer ».',
    'Choisis le jeu dans la liste des suggestions.'] },
  pochette: { titre: 'Pochette du jour', champ: 'Album', regles: [
    'La pochette d’un album, pixelisée.',
    'Elle se précise à chaque erreur ou « Passer ».',
    'Choisis l’album dans la liste des suggestions.'] },
  replique: { titre: 'Réplique du jour', champ: 'Titre du film', regles: [
    'Une réplique de film culte.',
    'Chaque erreur ou « Passer » débloque un indice.',
    'Choisis le titre dans la liste des suggestions.'] },
  pays: { titre: 'Pays du jour', champ: 'Nom du pays', regles: [
    'La silhouette d’un pays, à l’échelle.',
    'Chaque essai donne la distance et la direction depuis sa capitale.',
    'La photo du pays arrive à la 3e erreur.'] },
  plat: { titre: 'Plat du jour', champ: 'Pays d’origine', regles: [
    'La photo d’un plat : devine le pays dont il vient.',
    'Chaque essai donne la distance et la direction depuis la capitale du pays.',
    'Choisis le pays dans la liste des suggestions.'] },
};
/** Points par essai (essai 1 = 6 points … essai 6 = 1 point). */
const BAREME = [6, 5, 4, 3, 2, 1];
/** Flou de la carte selon le nombre d'erreurs (0 à 5 et plus). */
const FLOU = [14, 10, 7, 4, 2, 1];
/** Zoom de la capture selon le nombre d'erreurs (0 à 5 et plus). */
const ZOOM = [5, 4, 3, 2.2, 1.6, 1.2];
/** Côté (pixels) de la pochette selon le nombre d'erreurs (0 à 5 et plus). */
const PIXELS = [6, 10, 16, 28, 48, 96];
/** Raretés des cartes (libellés) : sert aussi à la classe de la bordure. */
const RARETES = { commune: 'Commune', peu_commune: 'Peu commune', rare: 'Rare', epique: 'Épique', legendaire: 'Légendaire', mythique: 'Mythique' };
/** Libellés des détails de fin de partie (les autres clés gardent leur nom). */
const LIBELLES = { serie: 'Série', numero: 'Numéro', texte: 'Texte', capitale: 'Capitale', continent: 'Continent', population: 'Population',
  langue: 'Langue', annee: 'Année', editeur: 'Éditeur', plateforme: 'Plateforme', artiste: 'Artiste', pays: 'Pays' };

/** Nombre entre deux bornes ; valeur par défaut si ce n'est pas un nombre. */
const borne = (v, min, max, def) => { const x = Number(v); return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : def; };
/** « 1 essai », « 2 essais », « 1 membre »… */
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;
/** Distance : « 1 120 km ». */
const km = (n) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} km`;
/** Vrai si l'essai est un « passer » (texte absent ou caractère de contrôle). */
const estPasse = (x) => x.t == null || String(x.t).trim() === '' || String(x.t) === '\u0001';
/** Viewbox sûre d'une silhouette (quatre nombres), sinon un carré. */
const viewBox = (v) => (/^-?[\d.]+( -?[\d.]+){3}$/.test(String(v || '').trim()) ? String(v).trim() : '0 0 100 100');
/** Images déjà chargées pour la pixelisation (url -> Image). */
const IMAGES = new Map();

/**
 * Monte un jeu du jour dans son onglet.
 * @param {HTMLElement} panel Panneau de l'onglet (section role="tabpanel").
 * @param {{sb: object, me: object, toast: Function, esc: Function}} ctx Contexte des modules d'onglet.
 * @param {string} jeu Identifiant : carte, jv, pochette, replique, pays ou plat.
 */
export async function monter(panel, ctx, jeu) {
  const cfg = JEUX[jeu];
  if (!cfg) { panel.innerHTML = '<p class="card">Jeu inconnu.</p>'; return; }
  loadCss('jeux-devine');
  loadCss('jeux-nj');
  const esc = ctx.esc;
  const e = { st: null, err: null, busy: false, draft: '' };
  panel.innerHTML = '<p class="muted">Chargement du jeu…</p>';
  panel.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-act="copier"]');
    if (b && panel.contains(b) && e.st) copier();
  });
  await charger();

  /** Lit l'état du jour (serveur) puis dessine. */
  async function charger() {
    try {
      const { data, error } = await ctx.sb.rpc('hg_nj_etat', { p_jeu: jeu });
      if (error) throw error;
      e.st = data; e.err = null;
    } catch (err) { e.err = err?.message || String(err); }
    dessiner();
  }

  /** Envoie un essai (texte choisi dans la liste, ou null pour passer). */
  async function jouer(texte) {
    if (e.busy) return;
    e.busy = true; dessiner();
    try {
      const { data, error } = await ctx.sb.rpc('hg_nj_essai', { p_jeu: jeu, p_texte: texte });
      if (error) throw error;
      e.st = data; e.draft = '';
      if (data.finished) ctx.toast(data.solved ? `Bravo ! +${data.reward} ✦` : `Pas trouvé cette fois. +${data.reward} ✦`, data.solved ? 'ok' : undefined);
    } catch (err) { ctx.toast(err?.message || String(err), 'error'); }
    e.busy = false; dessiner();
    if (e.st && !e.st.finished) panel.querySelector('#nj-input')?.focus();
  }

  /** Copie le résultat façon Framed (carrés). */
  async function copier() {
    const ok = await copyText(texteResultat(e.st));
    ctx.toast(ok ? 'Résultat copié, colle-le sur Discord.' : 'Copie impossible sur cet appareil.', ok ? 'ok' : 'error');
  }

  /** Texte de partage : titre, numéro de manche, score et une ligne de carrés. */
  function texteResultat(st) {
    const essais = st.essais || [];
    const carres = essais.map((x) => (x.ok ? '🟩' : estPasse(x) ? '⬜' : '🟥')).join('') + '⬜'.repeat(Math.max(0, 6 - essais.length));
    return `${cfg.titre} #${st.round} ${st.solved ? essais.length : 'X'}/6\n${carres}`;
  }

  /** Dessine tout l'onglet d'après e.st. */
  function dessiner() {
    if (e.err) { panel.innerHTML = `<p class="card">Jeu indisponible : ${esc(e.err)}</p>`; return; }
    const st = e.st;
    if (!st) return;
    const n = (st.essais || []).length, fini = !!st.finished, manche = !!st.round;
    const pills = !manche ? '' : fini
      ? `<span class="pill nj-pill">Essais <strong>${n} / 6</strong></span><span class="pill nj-pill">Points <strong>${esc(st.score)}</strong></span>`
      : `<span class="pill nj-pill">Essai <strong>${Math.min(n + 1, 6)} / 6</strong></span><span class="pill nj-pill">Points max <strong>${Math.max(1, 6 - n)}</strong></span>`;
    const head = `<div class="nj-head"><div class="nj-head-t"><p class="nj-kicker">JEU DU JOUR${manche ? ` · N°${esc(st.round)}` : ''}</p>
      <h2 class="nj-title">${esc(cfg.titre)}</h2></div><div class="nj-pills">${pills}</div></div>`;
    const corps = manche
      ? `<div class="nj-main">${jeuHtml(st, fini, n)}</div>`
      : '<div class="nj-main"><div class="card nj-vide"><p>Pas de manche aujourd’hui, reviens demain.</p></div></div>';
    const regles = `<section class="card nj-regles" aria-labelledby="nj-regles-h"><h2 id="nj-regles-h" class="jd-h2">Règles en bref</h2>
      <ul class="nj-rules">${cfg.regles.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      <h3 class="nj-label">Barème</h3><ol class="nj-bareme" aria-label="Barème">${BAREME.map((p, i) => `<li><span class="nj-bp">${p}</span><span class="nj-be">Essai ${i + 1}</span></li>`).join('')}</ol></section>`;
    const board = `<section class="card nj-board" aria-labelledby="nj-board-h"><h2 id="nj-board-h" class="jd-h2">Classement de la semaine</h2>${boardHtml(st.board, ctx.me?.id, esc)}</section>`;
    const hier = st.hier ? `<section class="card nj-hier"><p class="jd-hier-t">Hier : ${esc(st.hier.titre || '—')}</p>
      <p class="muted small">trouvé par ${esc(pluriel(st.hier.trouves ?? 0, 'membre'))}</p></section>` : '';
    panel.innerHTML = `<div class="nj nj--${jeu}">${head}${corps}<aside class="nj-aside">${regles}${board}${hier}</aside></div>`;
    boutonReponses(panel.querySelector('.nj-head'), 'nj', () => jeu);
    lier();
  }

  /** Contenu du jeu (essais, scène, indices, saisie ou fin de partie). */
  function jeuHtml(st, fini, n) {
    const pips = Array.from({ length: 6 }, (_, i) => {
      const x = st.essais?.[i];
      if (!x) return `<span class="nj-pip${i === n && !fini ? ' is-cur' : ''}" aria-hidden="true">${i + 1}</span>`;
      if (x.ok) return '<span class="nj-pip is-win" aria-hidden="true">✓</span>';
      if (estPasse(x)) return '<span class="nj-pip is-pass" aria-hidden="true">–</span>';
      return '<span class="nj-pip is-miss" aria-hidden="true">✗</span>';
    }).join('');
    const derniere = st.essais?.[n - 1];
    const dernier = !derniere ? '' : derniere.ok ? 'Bien joué, c’était la bonne réponse.'
      : estPasse(derniere) ? 'Indice débloqué.'
      : `Raté : ${derniere.t}${derniere.km != null ? ` · ${km(derniere.km)} ${derniere.dir || ''}` : ''}`;
    return `<section class="card nj-jeu" aria-label="Partie en cours">
      <div class="nj-pips" role="img" aria-label="Essais : ${n} sur 6"><span class="nj-pips-t">Essais</span>${pips}</div>
      ${scene(st, fini, n)}
      <div class="nj-info">${indicesHtml(st)}${essaisHtml(st)}</div>
      ${fini ? finHtml(st, n) : `<p class="nj-last muted small" role="status">${esc(dernier)}</p>${formHtml(st)}`}
    </section>`;
  }

  /** Scène du jeu : image, pochette pixelisée, citation ou silhouette. */
  function scene(st, fini, n) {
    const m = st.media || {};
    if (jeu === 'carte') {
      const r = RARETES[m.rarete] ? m.rarete : 'commune';
      const flou = fini ? 0 : FLOU[borne(st.erreurs, 0, 5, 0)];
      return `<div class="nj-scene nj-carte nj-rare-${r}">${media(st.image, 'Carte à deviner', `filter: blur(${flou}px)`)}</div>`;
    }
    if (jeu === 'jv') {
      const z = fini ? 1 : ZOOM[borne(st.erreurs, 0, 5, 0)];
      const fx = borne(m.fx, 0, 1, 0.5) * 100, fy = borne(m.fy, 0, 1, 0.5) * 100;
      return `<div class="nj-scene nj-jv">${media(st.image, 'Capture d’écran à deviner', `transform: scale(${z}); transform-origin: ${fx}% ${fy}%`)}</div>`;
    }
    if (jeu === 'pochette') {
      if (fini || !st.image) return `<div class="nj-scene nj-pochette">${media(st.image, 'Pochette de l’album', '', 'nj-sq')}</div>`;
      const px = PIXELS[borne(st.erreurs, 0, 5, 0)];
      return `<div class="nj-scene nj-pochette"><div class="nj-media nj-sq is-loading"><canvas class="nj-pix" width="${px}" height="${px}" data-pix="${px}" data-src="${esc(st.image)}" role="img" aria-label="Pochette pixelisée à deviner"></canvas></div></div>`;
    }
    if (jeu === 'replique') {
      return `<figure class="nj-scene nj-replique"><blockquote class="nj-quote"><p>« ${esc(m.citation || '…')} »</p></blockquote>${m.contexte ? `<figcaption class="nj-contexte">${esc(m.contexte)}</figcaption>` : ''}</figure>`;
    }
    if (jeu === 'pays') {
      const sil = `<figure class="nj-sil"><div class="nj-grille"><svg viewBox="${esc(viewBox(m.vb))}" role="img" aria-label="Silhouette du pays à deviner"><path d="${esc(m.svg || '')}"/></svg></div>
        <figcaption class="nj-cap">Silhouette réelle</figcaption></figure>`;
      let photo = '';
      if (st.image) photo = `<figure class="nj-photo">${media(st.image, 'Photo du pays à deviner', '')}<figcaption class="nj-cap nj-cap-or">Indice photo</figcaption></figure>`;
      else if (st.photo_bientot) photo = '<figure class="nj-photo nj-photo-vide"><p>Photo débloquée à la 3e erreur</p></figure>';
      return `<div class="nj-scene nj-pays">${sil}${photo}</div>`;
    }
    // plat
    return `<div class="nj-scene nj-plat">${media(st.image, 'Photo du plat à deviner', '')}</div>`;
  }

  /** Cadre d'image (chargement et erreur gérés après le rendu). Sans adresse : cadre en erreur. */
  function media(src, alt, style = '', cls = '') {
    if (!src) return `<div class="nj-media is-error ${cls}"></div>`;
    return `<div class="nj-media ${cls}"><img data-nj-img src="${esc(src)}" alt="${esc(alt)}" decoding="async" ${style ? `style="${esc(style)}"` : ''}></div>`;
  }

  /** Indices débloqués, puis les verrouillés. */
  function indicesHtml(st) {
    const total = borne(st.indices_total, 0, 99, 0);
    if (!total) return '';
    const ouverts = st.indices || [];
    const items = ouverts.map((t, i) => `<li class="nj-ind"><span class="nj-ind-n">${i + 1}</span><span>${esc(t)}</span></li>`);
    for (let i = ouverts.length; i < total; i++) items.push(`<li class="nj-ind is-verrouille"><span class="nj-ind-n">${i + 1}</span><span>Indice verrouillé</span></li>`);
    return `<section class="nj-bloc"><h3 class="nj-label">Indices</h3><ol class="nj-inds">${items.join('')}</ol></section>`;
  }

  /** Essais faits : distance, direction et proximité pour pays et plat. */
  function essaisHtml(st) {
    const geo = jeu === 'pays' || jeu === 'plat';
    const lignes = (st.essais || []).map((x, i) => {
      const passe = estPasse(x);
      const cls = x.ok ? 'is-win' : passe ? 'is-pass' : 'is-miss';
      let detail = `<span class="nj-try-s">${x.ok ? 'Trouvé' : passe ? '+1 indice' : 'Raté'}</span>`;
      if (geo && !x.ok && !passe && x.km != null) {
        const pct = borne(x.pct, 0, 100, 0);
        detail = `<span class="nj-km">${esc(km(x.km))}</span><span class="nj-dir" aria-label="direction">${esc(x.dir || '')}</span>
          <span class="nj-prox" aria-label="Proximité ${pct} %"><span style="width: ${pct}%"></span></span>`;
      }
      return `<li class="nj-try ${cls}"><span class="nj-dot" aria-hidden="true"></span><span class="nj-try-t">${i + 1} · ${passe ? 'Passé' : esc(x.t)}</span>${detail}</li>`;
    }).join('');
    return `<section class="nj-bloc"><h3 class="nj-label">Essais</h3>${lignes ? `<ul class="nj-tries">${lignes}</ul>` : '<p class="muted small">Aucun essai pour l’instant.</p>'}</section>`;
  }

  /** Formulaire de réponse (champ avec suggestions, Valider, Passer). */
  function formHtml(st) {
    const k = (st.indices || []).length;
    const passer = k < (st.indices_total || 0) ? `Passer · indice ${k + 1}` : 'Passer';
    return `<form class="jd-form nj-form" id="nj-form" autocomplete="off">
      <label for="nj-input" class="jd-label">${esc(cfg.champ)}</label>
      <div class="jd-combo">
        <input id="nj-input" class="input" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="nj-list" maxlength="120" placeholder="Tape quelques lettres…" value="${esc(e.draft)}" ${e.busy ? 'disabled' : ''}>
        <ul class="jd-list" id="nj-list" role="listbox" aria-label="Suggestions" hidden></ul>
      </div>
      <div class="jd-actions">
        <button type="button" class="btn btn-ghost" data-act="passer" ${e.busy ? 'disabled' : ''}>${esc(passer)}</button>
        <button type="submit" class="btn btn-sand" data-act="valider" disabled>Valider</button>
      </div>
      <p class="jd-hint muted small" id="nj-hint" role="status"></p>
    </form>`;
  }

  /** Fin de partie : bandeau, réponse, détails, Paillettes et partage. */
  function finHtml(st, n) {
    const rep = st.reponse || {};
    const d = rep.details || {};
    const titre = jeu === 'plat' ? `Pays : ${rep.reponse || ''}` : (rep.titre || rep.reponse || '');
    const plat = jeu === 'plat' && (d.plat || rep.titre) ? `<p class="muted small">Plat : <strong>${esc(d.plat || rep.titre)}</strong></p>` : '';
    const det = Object.entries(d).filter(([k, v]) => k !== 'plat' && (typeof v === 'string' || typeof v === 'number') && v !== '')
      .map(([k, v]) => `<dt>${esc(LIBELLES[k] || k.replace(/_/g, ' '))}</dt><dd>${esc(v)}</dd>`).join('');
    return `<section class="card jd-end nj-fin${st.solved ? ' is-win' : ''}" role="status">
      <p class="jd-end-t">${st.solved ? `Trouvé en ${esc(pluriel(n, 'essai'))} !` : 'Pas trouvé cette fois.'}</p>
      <p class="jd-end-ans">${esc(titre)}</p>${plat}${det ? `<dl class="nj-det">${det}</dl>` : ''}
      <p class="small">${st.reward ? `+${esc(st.reward)} ✦ crédités` : ''}</p>
      <div class="jd-actions"><button type="button" class="btn btn-sand" data-act="copier">Copier le résultat</button></div>
    </section>`;
  }

  /** Après le rendu : images (chargement, erreur), pochette pixelisée, saisie. */
  function lier() {
    panel.querySelectorAll('.nj-media').forEach((box) => {
      const im = box.querySelector('img[data-nj-img]');
      if (!im || (im.complete && im.naturalWidth)) return;
      box.classList.add('is-loading');
      im.addEventListener('load', () => box.classList.remove('is-loading'), { once: true });
      im.addEventListener('error', () => { box.classList.remove('is-loading'); box.classList.add('is-error'); }, { once: true });
    });
    panel.querySelectorAll('canvas[data-pix]').forEach((cv) => pixeliser(cv, cv.dataset.src, Number(cv.dataset.pix), cv.closest('.nj-media')));
    if (e.st && e.st.round && !e.st.finished) formulaire();
  }

  /**
   * Dessine la pochette sur un petit canevas (lecture interdite : on ne lit jamais les pixels), agrandi en CSS.
   * @param {HTMLCanvasElement} cv Canevas.
   * @param {string} src Adresse de l'image.
   * @param {number} px Côté du canevas en pixels.
   * @param {HTMLElement|null} box Cadre à rendre « chargé » ou « en erreur ».
   */
  function pixeliser(cv, src, px, box) {
    const im = IMAGES.get(src) || new Image();
    IMAGES.set(src, im);
    const dessine = () => {
      cv.width = px; cv.height = px;
      cv.getContext('2d').drawImage(im, 0, 0, px, px);
      box?.classList.remove('is-loading');
    };
    if (im.complete && im.naturalWidth) { dessine(); return; }
    im.addEventListener('load', dessine, { once: true });
    im.addEventListener('error', () => { box?.classList.remove('is-loading'); box?.classList.add('is-error'); }, { once: true });
    if (!im.src) im.src = src;
  }

  /** Champ de réponse : suggestions de la liste, Valider seulement pour une réponse de la liste, Passer. */
  function formulaire() {
    const form = panel.querySelector('#nj-form');
    if (!form) return;
    const input = form.querySelector('#nj-input');
    const list = form.querySelector('#nj-list');
    const hint = form.querySelector('#nj-hint');
    const valider = form.querySelector('[data-act="valider"]');
    const choix = (e.st.choix || []).map((c) => ({ c, n: normalize(c) })).filter((x) => x.n);
    const tentes = new Set((e.st.essais || []).filter((x) => !estPasse(x)).map((x) => normalize(x.t)));
    let montres = [], actif = -1;
    /** La réponse de la liste correspondant à la saisie, sinon null. */
    const trouve = (v) => { const n = normalize(v); return n ? (choix.find((x) => x.n === n)?.c ?? null) : null; };
    /** Met à jour l'indication et l'état de Valider. */
    const etat = () => {
      const c = trouve(input.value);
      const doublon = !!c && tentes.has(normalize(c));
      hint.textContent = doublon ? 'Tu as déjà proposé cette réponse.'
        : (input.value.trim() && !c ? 'Choisis une réponse dans la liste des suggestions.' : '');
      valider.disabled = !c || doublon || e.busy;
    };
    const peint = () => {
      list.innerHTML = montres.map((c, i) => `<li role="option" id="nj-opt-${i}" data-i="${i}" aria-selected="${i === actif}" class="jd-opt${i === actif ? ' is-active' : ''}">${esc(c)}</li>`).join('');
      list.hidden = !montres.length;
      input.setAttribute('aria-expanded', String(montres.length > 0));
      if (actif >= 0) input.setAttribute('aria-activedescendant', `nj-opt-${actif}`); else input.removeAttribute('aria-activedescendant');
    };
    const filtre = () => {
      const q = normalize(input.value);
      montres = q ? choix.filter((x) => x.n.includes(q) && !tentes.has(x.n))
        .sort((a, b) => (b.n.startsWith(q) - a.n.startsWith(q)) || a.c.localeCompare(b.c, 'fr'))
        .slice(0, 8).map((x) => x.c) : [];
      // Saisie déjà exacte : pas de liste (elle recouvrirait Valider).
      if (montres.length === 1 && normalize(montres[0]) === q) montres = [];
      actif = montres.length ? 0 : -1;
      peint();
    };
    const choisir = (i) => {
      const c = montres[i];
      if (!c) return;
      input.value = c; e.draft = c; montres = []; actif = -1;
      peint(); etat(); input.focus();
    };
    input.addEventListener('input', () => { e.draft = input.value; filtre(); etat(); });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowDown' && montres.length) { ev.preventDefault(); actif = (actif + 1) % montres.length; peint(); }
      else if (ev.key === 'ArrowUp' && montres.length) { ev.preventDefault(); actif = (actif - 1 + montres.length) % montres.length; peint(); }
      else if (ev.key === 'Enter' && !list.hidden && actif >= 0) { ev.preventDefault(); choisir(actif); }
      else if (ev.key === 'Escape') { montres = []; actif = -1; peint(); }
    });
    list.addEventListener('mousedown', (ev) => ev.preventDefault());
    list.addEventListener('click', (ev) => { const li = ev.target.closest('[data-i]'); if (li) choisir(Number(li.dataset.i)); });
    input.addEventListener('blur', () => setTimeout(() => { montres = []; actif = -1; peint(); }, 150));
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const c = trouve(input.value);
      if (!c) { hint.textContent = 'Choisis une réponse dans la liste des suggestions.'; input.focus(); return; }
      if (tentes.has(normalize(c))) { hint.textContent = 'Tu as déjà proposé cette réponse.'; return; }
      jouer(c);
    });
    form.querySelector('[data-act="passer"]').addEventListener('click', () => jouer(null));
    etat();
  }
}

/**
 * Résumé du jeu pour « Les missions du jour » (sans afficher le jeu).
 * @param {{sb: object}} ctx Contexte des modules d'onglet.
 * @param {string} jeu Identifiant du jeu.
 * @returns {Promise<{etat: string, texte: string, badge: string, gain?: number}>}
 */
export async function resumer(ctx, jeu) {
  try {
    const { data, error } = await ctx.sb.rpc('hg_nj_etat', { p_jeu: jeu });
    if (error) throw error;
    const st = data || {};
    if (!st.round) return { etat: 'info', texte: 'Pas de manche aujourd’hui', badge: '' };
    const n = (st.essais || []).length;
    if (st.finished) {
      return st.solved
        ? { etat: 'fait', texte: `Trouvé en ${pluriel(n, 'essai')}`, badge: `${st.score} pt${st.score > 1 ? 's' : ''}`, gain: Number(st.reward) || 0 }
        : { etat: 'fait', texte: 'Pas trouvé cette fois', badge: '0 pt', gain: Number(st.reward) || 0 };
    }
    if (n > 0) return { etat: 'en_cours', texte: `${pluriel(n, 'essai')} sur 6`, badge: `${Math.max(1, 6 - n)} pt${6 - n > 1 ? 's' : ''} max` };
    return { etat: 'a_jouer', texte: 'Devine en 6 essais', badge: '6 pts max' };
  } catch {
    return { etat: 'info', texte: 'Indisponible pour le moment', badge: '' };
  }
}
