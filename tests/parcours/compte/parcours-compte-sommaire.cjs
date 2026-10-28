// Parcours : Mon compte — sommaire de navigation et barre d'enregistrement du profil (revue R6, priorité 6).
// (a) 390 px : sommaire de 9 liens, collant en haut (position sticky), défilant en ligne, sans défilement horizontal de la page.
// (b) Chaque lien mène à son ancre ; la section courante est surlignée (aria-current) pendant le défilement.
// (c) 390 px : la barre « Modifications non enregistrées » n'apparaît qu'avec un changement du profil ; son bouton
//     « Enregistrer » est visible même loin du formulaire, enregistre le profil et masque la barre.
// (d) 1280 px : pas de barre (le bouton du formulaire est à portée) même avec un changement.
// (e) 390 px : cibles du sommaire de 44 px au moins.
// Faux Supabase : fixtures/fake-sb.mjs (hg_profiles). Lancer : node tests/parcours/compte/parcours-compte-sommaire.cjs
const { check, finish, openPage, log, chromium, sleep, hscroll } = require('../../lib/harness.cjs');

(async () => {
  const browser = await chromium.launch();

  /* (a)(b)(c)(e) téléphone */
  {
    const p = await openPage(browser, { page: 'compte', width: 390, height: 844, mobile: true, dpr: 2 });
    await p.waitForSelector('#acc-nav', { timeout: 8000 });
    await sleep(300);
    const liens = await p.$$eval('#acc-nav a[data-target]', (els) => els.map((e) => ({ id: e.dataset.target, href: e.getAttribute('href'), h: e.getBoundingClientRect().height })));
    check(liens.length === 9, `(a) sommaire de 9 liens (${liens.length})`);
    const cibles = await p.evaluate((ids) => ids.map((id) => !!document.getElementById(id)), liens.map((l) => l.id));
    check(cibles.every(Boolean), '(a) chaque lien pointe vers une section existante');
    check(liens.every((l) => l.href === `#${l.id}`), '(a) liens d’ancre (href = #id)');
    check(liens.every((l) => l.h >= 44), '(e) cibles du sommaire de 44 px au moins');
    check(await p.$eval('#acc-nav', (e) => getComputedStyle(e).position) === 'sticky', '(a) sommaire collant (position: sticky)');
    check(!(await hscroll(p)), '(a) pas de défilement horizontal de la page à 390 px');

    // (b) défilement jusqu'à « Badges » : lien surligné
    await p.click('#acc-nav a[data-target="badges"]');
    await sleep(900);
    const courant = await p.$eval('#acc-nav a[aria-current="true"]', (e) => e.dataset.target).catch(() => null);
    check(courant === 'badges', `(b) section courante surlignée après le lien « Badges » (${courant})`);
    const haut = await p.evaluate(() => { const s = document.getElementById('badges'); return s.getBoundingClientRect().top; });
    check(haut >= 60 && haut < 200, `(b) ancre visible sous le sommaire (haut de la section à ${Math.round(haut)} px)`);

    // (c) barre d'enregistrement : cachée sans changement
    check(await p.isHidden('#acc-savebar'), '(c) barre cachée sans changement');
    await p.click('#acc-nav a[data-target="profile-form"]');
    await sleep(700);
    await p.fill('#pf-pseudo', 'Ethan Test');
    await p.dispatchEvent('#pf-pseudo', 'input');
    await sleep(150);
    check(await p.isVisible('#acc-savebar'), '(c) barre visible après un changement du pseudo');
    // Le formulaire est loin de la barre : le bouton de la barre doit être dans la fenêtre
    await p.evaluate(() => window.scrollTo(0, document.getElementById('avatar').getBoundingClientRect().top + window.scrollY));
    await sleep(300);
    const bouton = await p.$eval('#acc-savebar button', (b) => { const r = b.getBoundingClientRect(); return { bas: r.bottom, haut: r.top, h: window.innerHeight }; });
    check(bouton.bas <= bouton.h && bouton.haut >= 0 && await p.isVisible('#acc-savebar button'), '(c) bouton « Enregistrer » de la barre visible loin du formulaire');
    check(await p.evaluate(() => document.documentElement.hasAttribute('data-savebar')), '(c) boutons flottants remontés (data-savebar)');
    await p.click('#acc-savebar button');
    await sleep(900);
    const up = await log(p);
    check(up.some((l) => l[0] === 'update' && l[1] === 'hg_profiles' && l[2]?.pseudo === 'Ethan Test'), '(c) profil enregistré depuis la barre');
    check(await p.isHidden('#acc-savebar'), '(c) barre masquée après l’enregistrement');
    check(!(await p.evaluate(() => document.documentElement.hasAttribute('data-savebar'))), '(c) boutons flottants revenus à leur place');
    check(!p.errs.length, '(c) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  }

  /* (d) ordinateur : pas de barre */
  {
    const p = await openPage(browser, { page: 'compte', width: 1280, height: 900 });
    await p.waitForSelector('#acc-nav', { timeout: 8000 });
    await sleep(300);
    await p.fill('#pf-pseudo', 'Ethan Autre');
    await p.dispatchEvent('#pf-pseudo', 'input');
    await sleep(150);
    check(!(await p.isVisible('#acc-savebar')), '(d) pas de barre d’enregistrement sur ordinateur');
    check(await p.isVisible('#profile-form button[type="submit"]'), '(d) bouton « Enregistrer » du formulaire visible');
    check(!p.errs.length, '(d) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  }

  await browser.close();
  finish();
})().catch((e) => { console.error(e); process.exitCode = 1; });
