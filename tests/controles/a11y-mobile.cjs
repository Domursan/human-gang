// Audit d'accessibilité TÉLÉPHONE de toutes les pages du site (tests/controles/a11y-mobile.cjs).
// Toutes les pages à la racine du dépôt (*.html), à 360 et 390 px de large, en mode tactile (hasTouch, isMobile).
// Contrôles, par page et par largeur :
//   - pas de défilement horizontal de la page ;
//   - cibles tactiles d'au moins 44 × 44 px (boutons, liens isolés, cases, onglets, icônes). Exempts : liens
//     dans un texte courant (display inline), éléments masqués ou désactivés ; une case ou un bouton radio
//     se mesure par son étiquette ;
//   - texte lisible : aucun texte de contenu sous 12 px ;
//   - balise meta viewport sans user-scalable=no ni maximum-scale < 2 (zoom permis) ;
//   - champs de formulaire à 16 px au moins (sinon iOS zoome) et type adapté (email, tel) ;
//   - éléments fixes en bas ou en haut : déclaration env(safe-area-inset-*) quand viewport-fit=cover ;
//   - menu du haut (bouton « Menu » à 760 px et moins) : s'ouvre, se referme, cibles mesurées une fois ouvert ;
//   - fenêtres modales (balises dialog) : tiennent dans l'écran, cibles mesurées, refermables (Échap ou bouton Fermer).
// Pages de jeux (liste JEUX) : passage en paysage 740 × 360 : pas de défilement horizontal, barres fixes
// qui occupent plus de 40 % de la hauteur signalées en avis.
// Exceptions documentées (non comptées comme défauts) :
//   - champ piège anti-spam (zone aria-hidden, hors écran) : ni touché ni lu ;
//   - textes de la planche A4 (collection-a4, aperçu mis à l'échelle par transform, format d'impression) ;
//   - bouton Menu couvert par une superposition (récap : diaporama plein écran) : signalé comme « navCouvert ».
// Ne mesure pas : barres fixes qui masquent le contenu, clavier virtuel, encoches réelles (à vérifier sur un appareil).
// Faux Supabase (tests/fixtures/) : aucune donnée réelle. Écrit tests/shots/a11y-mobile.json.
// Lancer : node tests/controles/a11y-mobile.cjs   (ou : npm run test:a11y-mobile)
const fs = require('fs');
const path = require('path');
const { ROOT, SHOTS, check, finish, openPage, sleep, chromium } = require('../lib/harness.cjs');

const LARGEURS = [360, 390];
const HAUTEUR = { 360: 740, 390: 844 };
const PAYSAGE = { width: 740, height: 360 };
const MIN_CIBLE = 44, MIN_TEXTE = 12, MIN_CHAMP = 16;
/** Pages de jeux : contrôle supplémentaire en paysage. */
const JEUX = new Set(['blackjack', 'catan', 'cluedo', 'destins', 'duels', 'jeux', 'loup-garou', 'monopoly', 'nom-de-code', 'pictionary', 'poker', 'risk', 'shadow-hunters', 'uno']);

/**
 * Lit la page dans le navigateur. o = { rootSel, minCible, minTexte, minChamp, rootAttr }.
 * Tout est calculé ici (getBoundingClientRect, getComputedStyle), le résultat est renvoyé à Node.
 */
function scanDom(o) {
  const de = document.documentElement;
  const vw = de.clientWidth, vh = innerHeight;
  const root = o.rootSel ? document.querySelector(o.rootSel) : document.body;
  const out = { total: 0, petites: [], texte: [], champs: [], fixes: [], debords: [], hscroll: 0, fieldsTotal: 0 };
  if (!root) return out;
  out.hscroll = Math.max(de.scrollWidth, document.body.scrollWidth) - de.clientWidth;
  const visible = (el) => (el.checkVisibility ? el.checkVisibility({ visibilityProperty: true }) : el.getClientRects().length > 0);
  const short = (el) => {
    const t = (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.value || el.placeholder || '')
      .toString().trim().replace(/\s+/g, ' ').slice(0, 40);
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + cls : '') + (t ? ' « ' + t + ' »' : '');
  };
  const clippedAncestor = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox !== 'visible' && ox !== 'clip') return true;
    }
    return false;
  };

  // 1. Cibles tactiles
  const SEL = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=checkbox], ' +
    '[role=switch], [role=radio], [role=menuitem], [role=option], [role=link], [onclick], label:has(input)';
  const vues = new Set();
  const etiquetteDe = (el) => el.closest('label') || (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]'));
  for (const el of root.querySelectorAll(SEL)) {
    if (el.disabled || !visible(el)) continue;
    if (el.closest('[aria-hidden="true"]')) continue; // champ piège (anti-spam) et décor : ni touché ni lu
    // Voyant de statut : 24 × 24 px visibles, zone tactile étendue au doigt (site/assets/commun/notifs.css, choix documenté : pas 44 px,
    // pour ne pas couvrir la photo du menu). Exempt de la règle des 44 px ; à revoir si le design change.
    if (el.classList.contains('statut-voyant')) continue;
    const cs = getComputedStyle(el);
    if (el.tagName === 'A' && cs.display === 'inline') continue; // lien dans un texte courant : exempt
    let cible = el;
    // Case, bouton radio ou champ caché (fichier, bascule) : la cible tactile est son étiquette.
    const r0 = el.getBoundingClientRect();
    const cache = el.tagName === 'INPUT' && (r0.width <= 2 || r0.height <= 2 || el.type === 'checkbox' || el.type === 'radio');
    if (cache) {
      const lab = etiquetteDe(el);
      if (lab && getComputedStyle(lab).display !== 'inline') cible = lab;
      else if (r0.width <= 2 || r0.height <= 2) continue; // champ caché sans étiquette visible : rien à toucher
    }
    if (cible.tagName === 'LABEL' && getComputedStyle(cible).display === 'inline') continue;
    if (vues.has(cible)) continue;
    vues.add(cible);
    const r = cible.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (r.bottom <= 0 || r.right <= 0) continue; // hors de la page (lien d'évitement, champ décalé hors écran)
    out.total++;
    if (r.width < o.minCible - 0.5 || r.height < o.minCible - 0.5) {
      out.petites.push({ el: short(cible), w: Math.round(r.width), h: Math.round(r.height) });
    }
  }

  // 2. Texte de contenu sous la taille minimale (hors planche d'impression A4 : mise à l'échelle par transform)
  for (const el of root.querySelectorAll('*')) {
    if (!(el instanceof HTMLElement) || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName)) continue;
    if (el.closest('.a4-sheets')) continue;
    let own = false;
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) { own = true; break; }
    if (!own || !visible(el)) continue;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px >= o.minTexte) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue; // texte masqué visuellement (lecteur d'écran seul)
    out.texte.push({ el: short(el), px });
  }

  // 3. Champs de formulaire : taille de police et type
  for (const el of root.querySelectorAll('input, select, textarea')) {
    const t = (el.type || '').toLowerCase();
    if (el.tagName === 'INPUT' && ['hidden', 'checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file', 'image'].includes(t)) continue;
    if (!visible(el)) continue;
    out.fieldsTotal++;
    const px = parseFloat(getComputedStyle(el).fontSize);
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    const hint = [el.name, el.id, ac, el.getAttribute('placeholder'), el.getAttribute('aria-label')].join(' ').toLowerCase();
    const problemes = [];
    if (px < o.minChamp) problemes.push('police ' + px + ' px (16 px minimum)');
    if (/(^|[^a-z])(e-?mail|courriel)/.test(hint) || ac === 'email') { if (t !== 'email') problemes.push('type=email attendu (actuel : ' + (t || 'text') + ')'); }
    else if (/(^|[^a-z])(tel|telephone|téléphone|phone|mobile)/.test(hint) || ac === 'tel' || ac.startsWith('tel-')) { if (t !== 'tel') problemes.push('type=tel attendu (actuel : ' + (t || 'text') + ')'); }
    out.champs.push({ el: short(el), type: t || 'text', px, problemes });
  }

  // 4. Éléments fixes (en-tête, barres du bas) et encoches
  const vp = document.querySelector('meta[name="viewport"]');
  const viewportFit = /viewport-fit\s*=\s*cover/.test(vp ? vp.content : '');
  const safeDans = (rules, el) => {
    for (const ru of rules) {
      if (ru instanceof CSSMediaRule || ru instanceof CSSSupportsRule) { if (safeDans(ru.cssRules, el)) return true; continue; }
      if (ru instanceof CSSStyleRule && ru.style.cssText.includes('safe-area')) {
        try { if (el.matches(ru.selectorText)) return true; } catch (e) { /* sélecteur non applicable */ }
      }
    }
    return false;
  };
  const sheetsSafe = (el) => {
    if ((el.getAttribute('style') || '').includes('safe-area')) return true;
    for (const sh of document.styleSheets) {
      let rules; try { rules = sh.cssRules; } catch (e) { continue; }
      if (safeDans(rules, el)) return true;
    }
    return false;
  };
  for (const el of root.querySelectorAll('*')) {
    if (getComputedStyle(el).position !== 'fixed' || !visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 4) continue;
    const bord = r.top <= 2 ? 'haut' : (r.bottom >= vh - 2 && r.top > vh / 2 ? 'bas' : '');
    const plein = r.height >= vh - 2; // superposition plein écran (voile, fenêtre) : pas une barre
    if (plein) continue;
    out.fixes.push({ el: short(el), bord, hauteur: Math.round(r.height), pourcentHauteur: Math.round(100 * r.height / vh),
      encocheOk: !bord || !viewportFit || sheetsSafe(el) });
  }
  out.viewportFit = viewportFit;

  // 5. Éléments qui dépassent à droite (cause du défilement horizontal)
  for (const el of root.querySelectorAll('*')) {
    if (!(el instanceof HTMLElement) || !visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.right <= vw + 1) continue;
    if (clippedAncestor(el)) continue;
    out.debords.push({ el: short(el), droite: Math.round(r.right) });
    if (out.debords.length >= 5) break;
  }
  out.vw = vw;
  return out;
}

/** Résumé d'un scan : liste des défauts (vide si rien à signaler), pour un test par page et largeur. */
function defauts(s) {
  const d = [];
  if (s.hscroll > 0) d.push(`défilement horizontal ${s.hscroll} px`);
  if (s.petites.length) d.push(`${s.petites.length} cible(s) < 44 px`);
  if (s.texte.length) d.push(`${s.texte.length} texte(s) < 12 px`);
  const champsKo = s.champs.filter((c) => c.problemes.some((p) => /^police|^type=email|^type=tel/.test(p)));
  if (champsKo.length) d.push(`${champsKo.length} champ(s) à corriger`);
  const encKo = s.fixes.filter((f) => !f.encocheOk);
  if (encKo.length) d.push(`${encKo.length} élément(s) fixe(s) sans safe-area`);
  const barresHautes = s.fixes.filter((f) => f.bord && f.pourcentHauteur > 25);
  if (barresHautes.length) d.push(`${barresHautes.length} barre(s) fixe(s) occupant plus de 25 % de l'écran`);
  if (s.debords.length) d.push(`${s.debords.length} élément(s) hors écran à droite`);
  return d;
}

/** Ce qui doit être signalé en détail (échantillon) dans la sortie. */
function exemples(s) {
  const e = [];
  for (const c of s.petites.slice(0, 4)) e.push(`cible ${c.w}×${c.h} : ${c.el}`);
  for (const t of s.texte.slice(0, 3)) e.push(`texte ${t.px} px : ${t.el}`);
  for (const c of s.champs.filter((c) => c.problemes.length).slice(0, 3)) e.push(`champ : ${c.el} → ${c.problemes.join(', ')}`);
  for (const f of s.fixes.filter((f) => !f.encocheOk).slice(0, 2)) e.push(`fixe sans safe-area : ${f.el}`);
  for (const d of s.debords.slice(0, 2)) e.push(`dépasse à droite (${d.droite} px) : ${d.el}`);
  return e;
}

const OPTS = { minCible: MIN_CIBLE, minTexte: MIN_TEXTE, minChamp: MIN_CHAMP };

(async () => {
  const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).map((f) => f.slice(0, -5)).sort();
  const browser = await chromium.launch();
  const resultats = [];
  for (const pg of pages) {
    for (const w of LARGEURS) {
      const p = await openPage(browser, { page: pg, width: w, height: HAUTEUR[w], mobile: true, dpr: 2, reducedMotion: 'reduce' });
      const rapport = { page: pg, largeur: w, meta: null, fixes: [], nav: null, dialogues: [], paysage: null, erreur: null };
      try {
        rapport.meta = await p.evaluate(() => { const m = document.querySelector('meta[name="viewport"]'); return m ? m.content : null; });
        const s = await p.evaluate(scanDom, { ...OPTS, rootSel: null });
        rapport.scan = s;

        // Menu du haut : ouvert puis refermé au bouton « Menu »
        const tog = await p.$('.nav-toggle');
        // Atteignable au doigt ? Sinon (ex. récap : diaporama plein écran qui couvre l'en-tête) : signalé à part.
        const couvert = tog && await p.evaluate(() => {
          const t = document.querySelector('.nav-toggle'); const r = t.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !!hit && !t.contains(hit);
        });
        if (tog && await tog.isVisible() && couvert) rapport.navCouvert = true;
        else if (tog && await tog.isVisible()) {
          await tog.click(); await sleep(350);
          const ouvert = await p.evaluate(() => document.querySelector('.site-header')?.classList.contains('nav-open') === true);
          const sNav = await p.evaluate(scanDom, { ...OPTS, rootSel: '.site-header' });
          await tog.click(); await sleep(350);
          const ferme = await p.evaluate(() => document.querySelector('.site-header')?.classList.contains('nav-open') !== true);
          rapport.nav = { ouvert, ferme, scan: sNav };
        }

        // Fenêtres modales : ouvertes, mesurées, refermées au clavier (Échap) ou par leur bouton Fermer
        const nd = await p.evaluate(() => document.querySelectorAll('dialog').length);
        for (let i = 0; i < nd; i++) {
          const ok = await p.evaluate((i) => {
            const d = document.querySelectorAll('dialog')[i];
            if (d.open) return false;
            try { d.showModal(); d.setAttribute('data-a11y-root', ''); return true; } catch (e) { return false; }
          }, i);
          if (!ok) continue;
          await sleep(250);
          const info = await p.evaluate(() => {
            const d = document.querySelector('dialog[data-a11y-root]');
            const r = d.getBoundingClientRect();
            const de = document.documentElement;
            return { id: d.id || d.className || 'dialog', tientEcran: r.left >= -0.5 && r.right <= de.clientWidth + 0.5 };
          });
          const sD = await p.evaluate(scanDom, { ...OPTS, rootSel: 'dialog[data-a11y-root]' });
          await p.keyboard.press('Escape'); await sleep(200);
          const fermeEchap = await p.evaluate(() => !document.querySelector('dialog[data-a11y-root]')?.open);
          const boutonFermer = await p.evaluate(() => {
            const d = document.querySelector('dialog[data-a11y-root]');
            return [...d.querySelectorAll('button, [role=button], a')].some((b) => {
              const t = ((b.getAttribute('aria-label') || '') + ' ' + (b.innerText || '')).toLowerCase();
              return b.getClientRects().length > 0 && /ferm|close|annul|retour|×|✕|✖/.test(t);
            });
          });
          if (!fermeEchap) await p.evaluate(() => { const d = document.querySelector('dialog[data-a11y-root]'); d.close(); });
          await p.evaluate(() => document.querySelectorAll('[data-a11y-root]').forEach((x) => x.removeAttribute('data-a11y-root')));
          rapport.dialogues.push({ ...info, fermeEchap, boutonFermer, scan: sD });
        }
      } catch (e) {
        rapport.erreur = e.message.split('\n')[0].slice(0, 160);
      }
      await p.ctx.close();

      // Une ligne par page et largeur (les défauts de la page entière et des éléments ouverts)
      const tous = [rapport.scan, rapport.nav?.scan, ...rapport.dialogues.map((d) => d.scan)].filter(Boolean);
      const ds = [...new Set(tous.flatMap(defauts))];
      // Zoom permis : pas de user-scalable=no / 0, ni maximum-scale inférieur à 2
      const m = rapport.meta;
      if (m === null) ds.push('balise meta viewport absente');
      else if (/user-scalable\s*=\s*(no|0)\b/i.test(m)) ds.push('zoom bloqué (user-scalable=no)');
      else { const ms = /maximum-scale\s*=\s*([\d.]+)/i.exec(m); if (ms && Number(ms[1]) < 2) ds.push(`zoom limité (maximum-scale=${ms[1]})`); }
      if (rapport.nav && !rapport.nav.ouvert) ds.push('menu du haut ne s\'ouvre pas');
      if (rapport.nav && !rapport.nav.ferme) ds.push('menu du haut ne se referme pas');
      for (const d of rapport.dialogues) {
        if (!d.tientEcran) ds.push(`fenêtre « ${d.id} » dépasse l'écran`);
        if (!d.fermeEchap && !d.boutonFermer) ds.push(`fenêtre « ${d.id} » sans fermeture accessible`);
      }
      if (rapport.erreur) ds.push('analyse impossible : ' + rapport.erreur);
      rapport.defauts = ds;
      resultats.push(rapport);
      const ex = [...(rapport.scan ? exemples(rapport.scan) : []), ...(rapport.nav?.scan ? exemples(rapport.nav.scan).map((x) => 'menu : ' + x) : [])];
      check(ds.length === 0, `${pg} ${w} : ${ds.length ? ds.join(' ; ') : 'OK'}${ex.length && ds.length ? '  [' + ex.slice(0, 3).join(' | ') + ']' : ''}`);

      // Paysage (pages de jeux) : défilement horizontal et barres fixes trop hautes
      if (JEUX.has(pg)) {
        const q = await openPage(browser, { page: pg, width: PAYSAGE.width, height: PAYSAGE.height, mobile: true, dpr: 2, reducedMotion: 'reduce' });
        try {
          const s = await q.evaluate(scanDom, { ...OPTS, rootSel: null });
          const hautes = s.fixes.filter((f) => f.pourcentHauteur > 40);
          const pd = [];
          if (s.hscroll > 0) pd.push(`défilement horizontal ${s.hscroll} px`);
          const av = hautes.map((f) => `barre fixe ${f.pourcentHauteur} % de la hauteur : ${f.el}`);
          rapport.paysage = { hscroll: s.hscroll, avis: av };
          check(pd.length === 0, `${pg} paysage ${PAYSAGE.width}×${PAYSAGE.height} : ${pd.length ? pd.join(' ; ') : 'OK'}${av.length ? '  (avis : ' + av.join(' ; ') + ')' : ''}`);
        } catch (e) {
          check(false, `${pg} paysage : analyse impossible (${e.message.split('\n')[0].slice(0, 120)})`);
        }
        await q.ctx.close();
      }
    }
  }
  await browser.close();

  fs.mkdirSync(SHOTS, { recursive: true });
  const bilan = { pages: pages.length, largeurs: LARGEURS, resultats: resultats.map((r) => ({ page: r.page, largeur: r.largeur, meta: r.meta, defauts: r.defauts, scan: r.scan, nav: r.nav, dialogues: r.dialogues, paysage: r.paysage })) };
  fs.writeFileSync(path.join(SHOTS, 'a11y-mobile.json'), JSON.stringify(bilan, null, 2));
  const total = (k) => resultats.reduce((n, r) => n + (r.scan ? r.scan[k].length : 0), 0);
  console.log(`\nAudit mobile : ${pages.length} pages × ${LARGEURS.join('/')} px ; cibles < 44 px : ${total('petites')} ; textes < 12 px : ${total('texte')} ; ` +
    `pages avec défilement horizontal : ${resultats.filter((r) => r.scan && r.scan.hscroll > 0).length}`);
  finish();
})();
