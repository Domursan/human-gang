// Budget de performance mobile (Q3) : accueil, cartes, IRL, historique et membre, sur un téléphone moyen simulé
// (390 px, 4G lente : 150 ms d'aller-retour et 200 Ko/s par réponse, processeur ralenti × 4), avec le faux Supabase.
// Mesures : plus grand affichage (LCP), octets et requêtes servis au premier chargement, décalage de mise en page (CLS).
// Seuils : tests/perf-budget.json (objectif par page, plafond bloquant pour ce qui dépasse déjà) ; échec au-delà du plafond + 10 %.
// Limites : fausses données (protège contre les régressions du code, pas contre un album de 400 photos) ; photos et
// polices Google hors mesure (servies à part) ; le réseau lent est simulé réponse par réponse, sans partage du débit.
// Écrit tests/shots/perf.json (repris par tests/ci-resume.cjs) et, sous GitHub Actions, un tableau dans le résumé.
// Lancer : node tests/perf-budget.cjs   (ou npm run test:perf)
const fs = require('fs');
const path = require('path');
const { SHOTS, check, finish, openPage, sleep, chromium } = require('./lib/harness.cjs');

const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'perf-budget.json'), 'utf8'));
const TOL = 1 + (Number(CFG.tolerance) || 0);
const delay = (octets) => CFG.reseau.rtt_ms + Math.round(octets / CFG.reseau.debit_ko_s);

/** Script injecté avant le chargement : relève le LCP et le CLS (PerformanceObserver). */
const INIT = () => {
  window.__perf = { lcp: 0, cls: 0 };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.lcp = Math.max(window.__perf.lcp, e.startTime); }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  } catch { /* navigateur sans ces mesures */ }
};

(async () => {
  const browser = await chromium.launch();
  const pages = [];
  for (const [pg, seuil] of Object.entries(CFG.pages)) {
    const p = await openPage(browser, { page: pg, width: 390, height: 844, mobile: true, dpr: 2, delay, cpu: CFG.cpu, init: INIT });
    await p.waitForLoadState('load').catch(() => {});
    await sleep(2500); // laisse les modules et les données arriver (le LCP peut encore changer)
    const m = await p.evaluate(() => window.__perf || { lcp: 0, cls: 0 });
    const net = p.ctx.__net;
    const r = { page: pg, lcp_ms: Math.round(m.lcp), ko: Math.round(net.octets / 1024), requetes: net.requetes, cls: Math.round(m.cls * 1000) / 1000 };
    const K = ['lcp_ms', 'ko', 'requetes', 'cls'];
    const limite = (k) => (seuil.plafond?.[k] ?? seuil[k]);
    const hors = K.filter((k) => r[k] > limite(k) * TOL); // bloquant
    r.objectif = K.filter((k) => r[k] > seuil[k]);        // à améliorer (affiché seulement)
    r.ok = !hors.length;
    check(r.ok, `${pg} : LCP ${r.lcp_ms} ms / ${seuil.lcp_ms} · ${r.ko} Ko / ${seuil.ko} · ${r.requetes} requêtes / ${seuil.requetes} · CLS ${r.cls} / ${seuil.cls}`
      + `${r.objectif.length ? ` · hors objectif : ${r.objectif.join(', ')}` : ''}${hors.length ? ` · AU-DELÀ DU PLAFOND : ${hors.join(', ')}` : ''}${p.errs.length ? ` · erreurs : ${p.errs.join(' | ').slice(0, 200)}` : ''}`);
    pages.push(r);
    await p.ctx.close();
  }
  await browser.close();
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, 'perf.json'), JSON.stringify({ pages }, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = ['### Budget de performance mobile', '', '| Page | LCP | Transféré | Requêtes | CLS | Budget |', '|---|---|---|---|---|---|',
      ...pages.map((r) => { const s = CFG.pages[r.page]; return `| ${r.page} | ${r.lcp_ms} ms / ${s.lcp_ms} | ${r.ko} Ko / ${s.ko} | ${r.requetes} / ${s.requetes} | ${r.cls} / ${s.cls} | ${!r.ok ? '**plafond dépassé**' : r.objectif.length ? `hors objectif (${r.objectif.join(', ')})` : 'respecté'} |`; }), ''];
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n');
  }
  finish();
})();
