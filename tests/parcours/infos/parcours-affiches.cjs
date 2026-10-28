// Parcours : affiches A3 et tutos lisent les réglages du site (prix, critères, quêtes).
// Le prix du booster Classique se lit sur son type (hg_booster_types, scénario typeOverrides) ; une valeur changée (par exemple 250) doit apparaître sur l'affiche
// des boosters et dans le tuto « Ouvrir un booster ». Sans lecture des réglages, le texte d'origine reste (repli).
// Affiches : affiches/boosters-a3.html, affiches/badges-a3.html, affiches/paillettes-a3.html (script affiches/affiches.js).
// Tutos : /pages/infos/aide.html#ouvrir-un-booster (assets/espaces/infos/aide.js, assets/espaces/admin/reglages-jetons.js).
// Faux Supabase : fixtures/fake-sb-cartes.mjs ; scénarios cardsCfg (surcharge de la configuration du jeu),
// badgesCfg (hg_settings.badges), cardsFail (la RPC hg_card_cfg refuse).
// Lancer : node tests/parcours/infos/parcours-affiches.cjs   (HG_ROOT / HG_PREFIX comme les autres parcours)
const fs = require('fs');
const path = require('path');
const { check, finish, openPage, sleep, chromium, ROOT, DEPOT } = require('../../lib/harness.cjs');

const FIXTURE = 'fake-sb-cartes.mjs';
const NBSP = /\s/g; // espaces insécables des milliers (fmt) : retirées pour comparer les nombres

(async () => {
  const browser = await chromium.launch();
  try {
    // 1. Affiche des boosters, prix du booster à 250 : tous les prix et le lot de 5 (250 × 5) suivent le réglage.
    let page = await openPage(browser, { page: 'affiches/boosters-a3', fixture: FIXTURE, scenario: { cardsCfg: { booster_price: 250 }, typeOverrides: { classique: { price: 250 } } }, width: 1123 });
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
    // Affiche à côté du tuto : deux colonnes de même largeur, l'affiche des boosters réduite dans son cadre.
    await sleep(1200);
    const duo = await page.evaluate(() => {
      const a = document.querySelector('.aide-tuto-duo .aide-tuto')?.getBoundingClientRect();
      const b = document.querySelector('.aide-tuto-duo .aide-affiche')?.getBoundingClientRect();
      const f = document.querySelector('.aide-affiche iframe');
      return { a: a?.width ?? 0, b: b?.width ?? 0, src: f?.getAttribute('src') ?? '', t: f?.style.transform ?? '' };
    });
    check(duo.src === '/affiches/boosters-a3.html', `tuto « Ouvrir un booster » : affiche des boosters à côté (${duo.src})`);
    check(duo.a > 0 && Math.abs(duo.a - duo.b) < 2, `tuto : texte et affiche en deux moitiés égales (${Math.round(duo.a)} / ${Math.round(duo.b)})`);
    check(/^scale\(0\.\d+\)$/.test(duo.t), `tuto : affiche réduite à la largeur du cadre (${duo.t})`);
    check(page.errs.length === 0, `tuto : aucune erreur de page (${page.errs.join(' | ').slice(0, 200)})`);
    await page.ctx.close();

    // 6. Tuto avec lecture refusée : le repli du texte (100) reste.
    page = await openPage(browser, { page: 'aide', fixture: FIXTURE, scenario: { cardsFail: true }, hash: '#ouvrir-un-booster', width: 1280 });
    await sleep(300);
    const tutoRepli = await page.evaluate(() => document.querySelector('#aide-tuto-view')?.textContent ?? '');
    check(tutoRepli.includes('Il coûte 100 Paillettes'), 'tuto, réglages illisibles : repli 100 affiché');
    check(page.errs.length === 0, 'tuto, réglages illisibles : aucune erreur de page');
    await page.ctx.close();

    // 7. Paliers d'ancienneté (hg_badges.levels) et assistance (hg_settings.support) suivent les réglages admin.
    page = await openPage(browser, { page: 'aide', fixture: FIXTURE, hash: '#monter-les-niveaux-d-anciennete', width: 1280,
      scenario: { ancienneteLevels: [{ name: 'Cuivre', level: 1, threshold: 1 }, { name: 'Jade', level: 2, threshold: 4 }] } });
    await sleep(300);
    const anc = await page.evaluate(() => document.querySelector('#aide-tuto-view')?.textContent ?? '');
    check(anc.includes('Cuivre à 1 an dans le gang, Jade à 4 ans'), 'tuto ancienneté : paliers lus dans les niveaux du badge');
    check(anc.includes('(Cuivre ou Jade)'), 'tuto ancienneté : noms des niveaux lus dans le badge');
    await page.ctx.close();
    page = await openPage(browser, { page: 'aide', fixture: FIXTURE, hash: '#demander-de-l-aide', width: 1280,
      scenario: { supportCfg: { message_min: 1, sujets: ['Compte', 'Autre'] } } });
    await sleep(300);
    const sup = await page.evaluate(() => document.querySelector('#aide-tuto-view')?.textContent ?? '');
    check(sup.includes('(1 caractère minimum)'), 'tuto assistance : minimum de caractères lu dans les réglages');
    check(sup.includes('« Compte » ou « Autre »'), 'tuto assistance : sujets lus dans les réglages');
    await page.ctx.close();
    // 8. Affiche des 18 secrets : récompenses lues sur hg_settings.eggs (recompenses), repli écrit si absent.
    page = await openPage(browser, { page: 'affiches/secrets-a3', fixture: FIXTURE, width: 1123 });
    const repliEggs = await page.evaluate(() => document.querySelector('[data-cfg="eggs.recompenses.konami"]')?.textContent ?? '');
    check(repliEggs === '100', `affiche secrets, réglage eggs absent : repli 100 conservé (« ${repliEggs} »)`);
    const texteSecrets = await page.evaluate(() => document.body.textContent);
    check(texteSecrets.includes('Les 18 secrets') && texteSecrets.includes('Chasseur de secrets'), 'affiche secrets : titre et récompense « Chasseur de secrets » présents');
    check(['tzatzikistan', 'kc', 'serge', 'domu', 'Pentakill', 'Le livre est mieux', 'Cueilleur', 'Mycena'].every((m) => texteSecrets.includes(m)), 'affiche secrets : nouveaux secrets et succès (mots tapés, Pentakill, cueilleur) présents');
    check(!texteSecrets.includes('{{'), 'affiche secrets : aucun jeton {{ non remplacé');
    check(page.errs.length === 0, `affiche secrets : aucune erreur de page (${page.errs.join(' | ').slice(0, 200)})`);
    await page.ctx.close();
    const recompenses = { konami: 250, logo: 50, humane: 25, jeu404: 5, heure_gang: 13, anniversaire: 100, console: 50, lettres: 300, secousse: 0, nuit: 30, rembobine: 25, tzatziki: 25, kc: 10, serge: 25, domumobile: 15, champi: 20, livre: 10, creeper: 1 };
    page = await openPage(browser, { page: 'affiches/secrets-a3', fixture: FIXTURE, scenario: { settingsExtra: { eggs: { recompenses } } }, width: 1123 });
    const eggsKonami = await page.evaluate(() => document.querySelector('[data-cfg="eggs.recompenses.konami"]')?.textContent ?? '');
    check(eggsKonami === '250', `affiche secrets : récompense du code Konami suit le réglage (${eggsKonami})`);
    const eggsLettres = await page.evaluate(() => document.querySelector('[data-cfg="eggs.recompenses.lettres"]')?.textContent ?? '');
    check(eggsLettres === '300', `affiche secrets : récompense des 7 lettres suit le réglage (${eggsLettres})`);
    const total = await page.evaluate(() => document.querySelector('[data-expr^="eggs.recompenses.konami"]')?.textContent ?? '');
    // Somme : 250 + 50 + 25 + 13 + 100 + 50 + 300 + 30 + 25 (= 843) + tzatziki 25 + champi 20 × 4 (80) + livre 10 + kc 10 + serge 25 + domu 15 = 1 008.
    check(total.replace(NBSP, '') === '1008', `affiche secrets : total calculé à partir des réglages (${total})`);
    check(page.errs.length === 0, 'affiche secrets, réglage modifié : aucune erreur de page');
    await page.ctx.close();

    // 9. Teaser : 18 cases floutées, « ??? » seulement, aucune récompense, aucun jeton.
    page = await openPage(browser, { page: 'affiches/secrets-teaser-a3', fixture: FIXTURE, width: 1123 });
    const teaser = await page.evaluate(() => ({ cases: document.querySelectorAll('.secret').length, mystere: document.querySelectorAll('.mystere').length, texte: document.body.textContent }));
    check(teaser.cases === 18 && teaser.mystere === 18, `affiche teaser : 18 cases floutées avec « ??? » (${teaser.cases} / ${teaser.mystere})`);
    check(!teaser.texte.includes('{{') && !teaser.texte.includes('par jour') && !teaser.texte.includes('Badge'), 'affiche teaser : aucun jeton et aucune récompense affichée');
    check(!teaser.texte.includes('Indice'), 'affiche teaser : plus aucun indice');
    check(page.errs.length === 0, `affiche teaser : aucune erreur de page (${page.errs.join(' | ').slice(0, 200)})`);
    await page.ctx.close();

    // 10. Solutions : page volontairement non publiée (impression/, hors du site). On vérifie qu'elle n'est pas servie
    // et que son fichier porte les 18 solutions ; ses récompenses dynamiques ne se lisent pas hors du site.
    const solFichier = fs.readFileSync(path.join(DEPOT, 'impression', 'secrets-solutions-a3.html'), 'utf8');
    check(!fs.existsSync(path.join(ROOT, 'affiches', 'secrets-solutions-a3.html')), 'affiche solutions : non publiée dans site/affiches/ (volontaire)');
    check((solFichier.match(/class="sol[ "]/g) || []).length === 18, 'affiche solutions : 18 secrets dans impression/secrets-solutions-a3.html');
    check(solFichier.includes('SECRETS') && solFichier.includes('humane'), 'affiche solutions : mot des lettres et mot humane présents');

    // 11. Affiche « Les jeux » : missions, GeoGuessr, Raclette, Domu-mobile ; et la gamme des boosters lue sur hg_booster_types.
    page = await openPage(browser, { page: 'affiches/jeux-a3', fixture: FIXTURE, width: 1123 });
    const jeux = await page.evaluate(() => document.body.textContent);
    check(['Missions quotidiennes', 'GeoGuessr', 'Sutom du gang', 'Framed', 'Heardle', 'Raclette', 'Domu-mobile', 'Paillettes'].every((m) => jeux.includes(m)), 'affiche jeux : jeux du gang et arcade présents');
    check(page.errs.length === 0, `affiche jeux : aucune erreur de page (${page.errs.join(' | ').slice(0, 200)})`);
    await page.ctx.close();

    page = await openPage(browser, { page: 'affiches/boosters-gamme-a3', fixture: FIXTURE, width: 1123 });
    const colonnes = await page.evaluate(() => document.querySelectorAll('#gamme-tete th.bo').length);
    check(colonnes === 9, `affiche gamme : 9 boosters en colonnes (${colonnes})`);
    check(page.errs.length === 0, `affiche gamme : aucune erreur de page (${page.errs.join(' | ').slice(0, 200)})`);
    await page.ctx.close();

    // 12. Aucune fonctionnalité retirée, aucun pseudo de membre sur les affiches.
    const retires = ['Lexique', 'Ludothèque', 'Gartic', 'Capsule', 'Carnet de voyage', 'Qui main', 'Pronostic', 'Jeux du jour', 'Saisons ', 'CARZY', 'DESTRU'];
    for (const nom of ['index', 'badges-a3', 'paillettes-a3', 'cartes-a3', 'boosters-a3', 'boosters-gamme-a3', 'secrets-a3', 'secrets-teaser-a3', 'jeux-a3']) {
      page = await openPage(browser, { page: 'affiches/' + nom, fixture: FIXTURE, width: 1123 });
      const texte = await page.evaluate(() => document.body.textContent);
      const trouves = retires.filter((m) => texte.includes(m));
      check(trouves.length === 0, `affiche ${nom} : aucun élément retiré ni pseudo (${trouves.join(', ') || 'rien'})`);
      await page.ctx.close();
    }
  } catch (e) {
    check(false, 'exception : ' + (e && e.stack ? e.stack.split('\n')[0] : e));
  } finally {
    await browser.close();
    finish();
  }
})();
