// Parcours : protections côté navigateur (correctifs de sécurité du 23/10/2026).
// 1. Anti-encadrement (theme-boot.js) : une page du site encadrée par un autre site s'ouvre en pleine fenêtre ;
//    encadrée par le site lui-même (simulateur de téléphone), elle reste affichée.
// 2. CSP : un script jsDelivr hors des bibliothèques prévues est refusé ; simulateur.html a sa propre CSP sans script inline.
// 3. Code d'invitation en attente (compte.js, hg_pending_join) : utilisé s'il a moins d'une heure, ignoré et effacé sinon.
// Faux Supabase (fixtures/fake-sb.mjs), rien n'atteint la vraie base. Lancer : node tests/parcours-securite-front.cjs
const { ORIGIN, PREFIX, check, finish, openPage, sleep, chromium } = require('./lib/harness.cjs');

const EVIL = 'http://autre-site.test';
/** Ajoute au contexte de la page un « autre site » qui encadre l'adresse donnée. */
async function routeEvil(p, target) {
  await p.ctx.route(`${EVIL}/**`, (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><title>autre site</title><iframe id="f" src="${target}" width="800" height="600"></iframe>`,
  }));
}

(async () => {
  const browser = await chromium.launch();
  const base = `${ORIGIN}${PREFIX}`;

  // 1a. Encadrée par un autre site : la fenêtre principale part vers la page du site.
  let p = await openPage(browser, { page: 'legal', scenario: { guest: true } });
  await routeEvil(p, `${base}/legal.html`);
  await p.goto(`${EVIL}/`);
  await p.waitForURL(/\/legal\.html$/, { timeout: 4000 }).catch(() => {});
  // Chrome refuse la redirection de la fenêtre principale sans clic : la page doit alors être masquée et inerte.
  let etat = 'pleine fenêtre';
  if (!p.url().startsWith(`${base}/legal.html`)) {
    const f = p.frames().find((x) => x.url().includes('/legal.html'));
    etat = f ? await f.evaluate(() => `${document.documentElement.style.visibility}/${document.documentElement.inert}`).catch(() => '?') : 'absent';
    // Un clic au centre du cadre ne doit atteindre aucun élément de la page encadrée.
    const hit = f ? await f.evaluate(() => { const e = document.elementFromPoint(400, 300); return e ? e.tagName : 'aucun'; }).catch(() => '?') : '?';
    etat += ` clic:${hit}`;
  }
  check(etat === 'pleine fenêtre' || /^hidden\/true/.test(etat), `cadre d'un autre site : page ouverte en pleine fenêtre ou masquée et inerte (${etat})`);
  await p.ctx.close();

  // 1b. Cadre isolé (sandbox sans navigation de la fenêtre principale) : la page reste masquée.
  p = await openPage(browser, { page: 'legal', scenario: { guest: true } });
  await p.ctx.route(`${EVIL}/**`, (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><iframe id="f" sandbox="allow-scripts allow-same-origin" src="${base}/legal.html" width="800" height="600"></iframe>`,
  }));
  await p.goto(`${EVIL}/`);
  await sleep(1500);
  const fr = p.frames().find((f) => f.url().includes('/legal.html'));
  const vis = fr ? await fr.evaluate(() => document.documentElement.style.visibility).catch(() => '?') : 'absent';
  check(p.url().startsWith(EVIL) && vis === 'hidden', `cadre isolé d'un autre site : page masquée (visibility=${vis})`);
  await p.ctx.close();

  // 1c. Simulateur (même site) : la page encadrée reste visible, sans erreur de CSP.
  p = await openPage(browser, { page: 'simulateur', scenario: {} });
  const csp = [];
  p.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text().slice(0, 160)); });
  await p.reload();
  await sleep(2500);
  const frames = p.frames().filter((f) => f !== p.mainFrame());
  const shown = frames.length ? await frames[0].evaluate(() => document.documentElement.style.visibility !== 'hidden' && !!document.body).catch(() => false) : false;
  check(frames.length >= 1 && shown, `simulateur : page du site affichée dans le cadre (${frames.length} cadre(s))`);
  check(await p.locator('#url').count() === 1 && (await p.locator('.screen').count()) >= 1, 'simulateur : script externe chargé (téléphone et barre d\'adresse affichés)');
  check(!csp.length && !p.errs.length, 'simulateur : aucune erreur JS ni CSP' + (csp.length || p.errs.length ? ` (${[...csp, ...p.errs].join(' | ')})` : ''));
  const simCsp = await p.$eval('meta[http-equiv="Content-Security-Policy"]', (m) => m.content).catch(() => '');
  check(/script-src 'self';/.test(simCsp) && !/unsafe-inline'[^;]*;\s*style/.test(simCsp.split('script-src')[1] || ''), 'simulateur : CSP présente, scripts du site seulement');
  await p.ctx.close();

  // 2. CSP des pages : bibliothèque jsDelivr non prévue refusée, bibliothèques prévues autorisées.
  p = await openPage(browser, { page: 'legal', scenario: { guest: true } });
  const res = await p.evaluate(async () => {
    const viol = [];
    document.addEventListener('securitypolicyviolation', (e) => viol.push(e.blockedURI));
    const tryImport = async (u) => { try { await import(u); return 'ok'; } catch (e) { return 'err'; } };
    await tryImport('https://cdn.jsdelivr.net/npm/paquet-inconnu@1.0.0/+esm');
    await tryImport('https://cdn.jsdelivr.net/gh/quelquun/depot@main/x.js');
    await tryImport('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm');
    await tryImport('https://cdn.jsdelivr.net/npm/@supabase/auth-js@2.65.0/+esm');
    await new Promise((r) => setTimeout(r, 300));
    return viol;
  });
  check(res.some((u) => u.includes('paquet-inconnu')) && res.some((u) => u.includes('/gh/')), 'CSP : paquet jsDelivr non prévu refusé');
  check(!res.some((u) => u.includes('qrcode-generator') || u.includes('@supabase')), 'CSP : bibliothèques prévues (@supabase, qrcode-generator) autorisées');
  check(await p.evaluate(() => window.top === window.self && document.documentElement.style.visibility !== 'hidden'), 'page normale : affichée, pas de masquage');
  await p.ctx.close();

  // 3a. Code en attente récent (10 min) : appliqué après confirmation de l'e-mail, puis effacé.
  const pendingPage = async (ageMs) => {
    const q = await openPage(browser, { page: 'legal', scenario: { uid: 'nouveau-membre' } });
    await q.evaluate((age) => localStorage.setItem('hg_pending_join', JSON.stringify({ code: 'HG-TEST01', pseudo: 'Nouvelle', at: Date.now() - age })), ageMs);
    await q.goto(`${base}/compte.html`);
    await sleep(2000);
    return q;
  };
  p = await pendingPage(10 * 60000);
  // Succès = appel hg_join visible, ou redirection vers l'accueil déjà faite (elle n'a lieu qu'après un hg_join réussi).
  await p.waitForURL(/\/accueil\.html$/, { timeout: 4000 }).catch(() => {});
  let calls = await p.evaluate(() => (window.__LOG || []).filter((l) => l[0] === 'rpc' && l[1] === 'hg_join').map((l) => l[2])).catch(() => []);
  const joined = calls.some((a) => a?.p_code === 'HG-TEST01') || /\/accueil\.html$/.test(p.url());
  const left = await p.evaluate(() => localStorage.getItem('hg_pending_join'));
  check(joined && left === null, `code en attente de 10 min : rejoint le gang, entrée effacée (${p.url()})`);
  await p.ctx.close();

  // 3b. Code en attente de plus d'une heure : ignoré (pas d'appel hg_join), effacé, formulaire « rejoindre » vide.
  p = await pendingPage(2 * 3600000);
  calls = await p.evaluate(() => (window.__LOG || []).filter((l) => l[0] === 'rpc' && l[1] === 'hg_join'));
  const left2 = await p.evaluate(() => localStorage.getItem('hg_pending_join'));
  const pseudo = await p.inputValue('#jn-pseudo').catch(() => 'absent');
  check(!calls.length && left2 === null && pseudo === '', `code en attente de 2 h : ignoré et effacé, formulaire vide (pseudo="${pseudo}")`);
  check(!p.errs.length, 'compte : aucune erreur JS' + (p.errs.length ? ` (${p.errs.join(' | ')})` : ''));
  await p.ctx.close();

  await browser.close();
  finish();
})();
