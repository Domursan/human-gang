// Parcours : affiches A3 et tutos lisent les réglages du site (prix, critères, quêtes).
// Une valeur changée dans les réglages (par exemple le prix d'un booster à 250) doit apparaître sur l'affiche
// des boosters et dans le tuto « Ouvrir un booster ». Sans lecture des réglages, le texte d'origine reste (repli).
// Affiches : affiches/boosters-a3.html, affiches/badges-a3.html, affiches/paillettes-a3.html (script affiches/affiches.js).
// Tutos : aide.html#ouvrir-un-booster (assets/js/aide.js, assets/js/reglages-jetons.js).
// Faux Supabase : fixtures/fake-sb-cartes.mjs ; scénarios cardsCfg (surcharge de la configuration du jeu),
// badgesCfg (hg_settings.badges), cardsFail (la RPC hg_card_cfg refuse).
// Lancer : node tests/parcours-affiches.cjs   (HG_ROOT / HG_PREFIX comme les autres parcours)
const { check, finish, openPage, sleep, chromium } = require('./lib/harness.cjs');

const FIXTURE = 'fake-sb-cartes.mjs';
const NBSP = /\s/g; // espaces insécables des milliers (fmt) : retirées pour comparer les nombres

(async () => {
  const browser = await chromium.launch();
  try {
    // 1. Affiche des boosters, prix du booster à 250 : tous les prix et le lot de 5 (250 × 5) suivent le réglage.
    let page = await openPage(browser, { page: 'affiches/boosters-a3', fixture: FIXTURE, scenario: { cardsCfg: { booster_price: 250 } }, width: 1123 });
    const prix = await page.evaluate(() => [...document.querySelectorAll('[data-cfg="cartes.booster_price"]')].map((e) => e.textContent));
    check(prix.length >= 1 && prix.every((t) => t === '250'), `affiche boosters : prix du booster affiché 250 (${prix.join(', ') || 'aucun élément'})`);
    const lot = await page.evaluate(() => document.querySelector('[data-expr="cartes.booster_price*5"]')?.textContent ?? '');
    check(lot.replace(NBSP, '') === '1250', `affiche boosters : lot de 5 calculé à 1 250 (« ${lot} »)`);
    const taux = await page.evaluate(() => document.querySelector('[data-cfg="cartes.shiny_rate"]')?.textContent ?? '');
    check(taux === '3', `affiche boosters : taux de brillante lu sur la configuration (« ${taux} »)`);
    check(page.errs.length === 0, `affiche boosters : aucune erreur de page (${page.errs.join(' | ').slice(0, 200)})`);
    await page.ctx.close();

    // 2. Même affiche, lecture du jeu refusée : le texte d'origine (100) reste, sans erreur.
    page = await openPage(browser, { page: 'affiches/boosters-a3', fixture: FIXTURE, scenario: { cardsFail: true }, width: 1123 });
    const repli = await page.evaluate(() => [...document.querySelectorAll('[data-cfg="cartes.booster_price"]')].map((e) => e.textContent));
    check(repli.length >= 1 && repli.every((t) => t === '100'), `affiche boosters, réglages illisibles : repli 100 conservé (${repli.join(', ')})`);
    check(page.errs.length === 0, 'affiche boosters, réglages illisibles : aucune erreur de page');
    await page.ctx.close();

    // 3. Affiche des badges : critère « Toujours là » à 8 sorties (hg_settings.badges), badges lus sur hg_badges.
    page = await openPage(browser, { page: 'affiches/badges-a3', fixture: FIXTURE, scenario: { badgesCfg: { criteres: { toujours_la_sorties: 8 } } }, width: 1123 });
    const texteBadges = await page.evaluate(() => document.body.textContent);
    check(texteBadges.includes('Présent à 8 sorties passées'), 'affiche badges : critère « Toujours là » lu sur les réglages (8)');
    check(texteBadges.includes('Chasseur de citrouilles'), 'affiche badges : badge de la base (hg_badges) affiché, même hors des sections d\'origine');
    const nb = await page.evaluate(() => document.getElementById('nb-badges')?.textContent ?? '');
    check(Number(nb) >= 10, `affiche badges : nombre de badges calculé sur la base (${nb})`);
    check(page.errs.length === 0, `affiche badges : aucune erreur de page (${page.errs.join(' | ').slice(0, 200)})`);
    await page.ctx.close();

    // 4. Affiche Paillettes : les quêtes sont celles de hg_card_quests_templates (deux modèles actifs dans la fixture).
    page = await openPage(browser, { page: 'affiches/paillettes-a3', fixture: FIXTURE, width: 1123 });
    const quetes = await page.evaluate(() => [...document.querySelectorAll('#quetes .q')].map((e) => e.textContent));
    check(quetes.length === 2 && quetes[0] === 'Ouvrir 5 boosters', `affiche Paillettes : quêtes lues sur la base (${quetes.join(' | ')})`);
    const nbQuetes = await page.evaluate(() => document.querySelector('[data-cfg-calc="quetes"]')?.textContent ?? '');
    check(nbQuetes === '2', `affiche Paillettes : nombre de quêtes actives affiché (${nbQuetes})`);
    const jour30 = await page.evaluate(() => document.querySelector('[data-expr*="streak_max-1"]')?.textContent ?? '');
    // Fixture : passage du jour 20, bonus 5, série max 7 : dernier jour = 20 + 5 × (7 − 1) = 50.
    check(jour30 === '50', `affiche Paillettes : palier du dernier jour calculé à partir des réglages (${jour30})`);
    check(page.errs.length === 0, 'affiche Paillettes : aucune erreur de page');
    await page.ctx.close();

    // 5. Tuto « Ouvrir un booster » : prix 250 et lot de 5 à 1 250, dans le texte rendu par aide.js.
    page = await openPage(browser, { page: 'aide', fixture: FIXTURE, scenario: { cardsCfg: { booster_price: 250 } }, hash: '#ouvrir-un-booster', width: 1280 });
    await sleep(300);
    const tuto = await page.evaluate(() => document.querySelector('#aide-tuto-view')?.textContent ?? '');
    check(tuto.includes('Il coûte 250 Paillettes'), 'tuto « Ouvrir un booster » : prix 250 affiché dans l\'étape');
    check(tuto.replace(NBSP, '').includes('Ouvrir5boosters·1250') || tuto.replace(NBSP, '').includes('pour1250Paillettes'), 'tuto « Ouvrir un booster » : lot de 5 à 1 250');
    check(!tuto.includes('{{'), 'tuto « Ouvrir un booster » : aucun jeton non remplacé');
    check(page.errs.length === 0, `tuto : aucune erreur de page (${page.errs.join(' | ').slice(0, 200)})`);
    await page.ctx.close();

    // 6. Tuto avec lecture refusée : le repli du texte (100) reste.
    page = await openPage(browser, { page: 'aide', fixture: FIXTURE, scenario: { cardsFail: true }, hash: '#ouvrir-un-booster', width: 1280 });
    await sleep(300);
    const tutoRepli = await page.evaluate(() => document.querySelector('#aide-tuto-view')?.textContent ?? '');
    check(tutoRepli.includes('Il coûte 100 Paillettes'), 'tuto, réglages illisibles : repli 100 affiché');
    check(page.errs.length === 0, 'tuto, réglages illisibles : aucune erreur de page');
    await page.ctx.close();
  } catch (e) {
    check(false, 'exception : ' + (e && e.stack ? e.stack.split('\n')[0] : e));
  } finally {
    await browser.close();
    finish();
  }
})();
