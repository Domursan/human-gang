// Parcours : textes de la page d'accueil et plafonds de Paillettes, éditables depuis l'admin.
// 1. Admin › Mairie › Textes et intro : groupe « Page d'accueil » (titre, présentation, libellés en une case par item),
//    valeur actuelle, défaut en placeholder, « Valeur par défaut » par champ ; enregistrement sans effacer les clés de
//    site_textes que le formulaire ne gère pas ; accueil du site qui affiche le texte réglé ; 390 px sans défilement.
// 2. Fabrique › Limites : groupes de plafonds (Jeux quotidiens, Quiz et citations, …), valeur enregistrée ou défaut en
//    placeholder, bornes (0 à 1 000), enregistrement qui garde les autres sous-clés de cards.plafonds et les autres
//    réglages (y compris la configuration écrite par l'Arène actuelle), rétablissement d'un groupe, 390 px.
// Aucune erreur console. Lancer : node tests/parcours/compte/parcours-reglages-textes-plafonds.cjs
const { check, finish, openPage, adminSection, hscroll, log, chromium, sleep } = require('../../lib/harness.cjs');

const FX_TEXTES = 'fake-sb-reglages.mjs';
const FX_CARTES = 'fake-sb-cartes.mjs';
/** Réglages de départ : deux textes d'accueil réglés, une clé de site_textes que le formulaire ne connaît pas. */
const REG_TEXTES = { site_textes: { accueil_titre: 'Mon QG', rsvp_libelles: { oui: 'Je viens !' }, zz_custom: 'garde-moi' } };
/** Configuration « cards » de départ : plafonds de l'Arène écrits par la RPC (chaînes), une clé inconnue, une récompense. */
const CARDS_START = {
  plafonds: { bataille_gain: '12', batailles_jour: '3', zz_custom: '7' },
  rewards: { daily: 100, citation: 20 },
  zz_top: 'garde',
};

/** Réglages enregistrés par le faux client (localStorage, clé __fake_settings) : valeur de la clé key, ou undefined. */
const storedValue = (p, key) => p.evaluate((k) => {
  try { return ((JSON.parse(localStorage.getItem('__fake_settings') || 'null') || []).find((r) => r.key === k) || {}).value; } catch { return undefined; }
}, key);
/** Dernière écriture de la clé « cards » dans le journal du faux client (la charge utile est la configuration complète). */
const lastCardsWrite = async (p) => {
  const w = (await log(p)).filter((l) => ['upsert', 'update', 'insert'].includes(l[0]) && l[1] === 'hg_settings' && l[2] && l[2].key === 'cards');
  return w.length ? w[w.length - 1][2].value : null;
};
/** Ouvre une partie de la Mairie ou de La Fabrique dans le panel admin et attend son formulaire. */
async function goto(p, route, waitFor) {
  await adminSection(p, route);
  await p.waitForSelector(waitFor, { timeout: 8000 });
  await sleep(400);
}

/* ---------- Scénario ---------- */
(async () => {
  const browser = await chromium.launch();
  try {
    /* ========== 1. Textes de l'accueil ========== */
    const pt = await openPage(browser, { page: 'admin', fixture: FX_TEXTES, width: 1280, height: 900, scenario: { reglages: REG_TEXTES } });
    await goto(pt, 'mairie/textes', '#rgi-form');
    await pt.evaluate(() => document.querySelectorAll('#rgi-form details.rgi-fold').forEach((d) => { d.open = true; })); // groupes repliés : ouverts pour les saisir
    const field = (k) => pt.locator(`#rgi-${k.replace(/[^a-z0-9]/gi, '-')}`);
    const groups = await pt.$$eval('#rgi-form fieldset[data-group]', (fs) => fs.filter((f) => !f.hidden).map((f) => f.dataset.group).join(','));
    check(groups.startsWith('accueil,') && groups.includes('textes'), `textes : groupe « Page d'accueil » en tête de « Textes et intro » (${groups})`);

    check(await field('site_textes.accueil_titre').inputValue() === 'Mon QG', 'textes : titre d\'accueil réglé affiché');
    check((await field('site_textes.accueil_lead').inputValue()).startsWith('Secret Santa, sorties IRL'), 'textes : présentation affiche le texte d\'origine quand rien n\'est réglé');
    check(await pt.inputValue('#rgi-site-textes-rsvp-libelles-oui') === 'Je viens !', 'textes : libellé « oui » réglé, une case par réponse');
    check(await pt.getAttribute('#rgi-site-textes-rsvp-libelles-peut-etre', 'placeholder') === 'Peut-être', 'textes : défaut du libellé « peut-être » en placeholder');
    check(/Une sortie/.test(await pt.getAttribute('#rgi-site-textes-idees-aide', 'placeholder') || ''), 'textes : texte d\'aide de la boîte à idées : défaut en placeholder');
    check(await pt.$$eval('#rgi-site-textes-ss-statuts-inscriptions, #rgi-site-textes-defis-libelles-termine', (els) => els.length) === 2, 'textes : libellés Secret Santa et défis présents');
    check(await pt.locator('button[data-reset="site_textes.accueil_titre"]').count() === 1, 'textes : « Valeur par défaut » sur chaque champ d\'accueil');

    // Modifier deux champs, enregistrer
    await field('site_textes.accueil_titre').fill('QG de test');
    await pt.fill('#rgi-site-textes-rsvp-libelles-oui', 'Présent');
    await field('site_textes.ss_pas_edition').fill('Rien pour l’instant');
    await pt.click('#rgi-save');
    await sleep(500);
    const tx1 = await storedValue(pt, 'site_textes') || {};
    check(tx1.accueil_titre === 'QG de test' && tx1.ss_pas_edition === 'Rien pour l’instant', `textes : titre et édition enregistrés (${JSON.stringify({ t: tx1.accueil_titre, s: tx1.ss_pas_edition })})`);
    check(tx1.rsvp_libelles && tx1.rsvp_libelles.oui === 'Présent' && tx1.rsvp_libelles['peut-etre'] === 'Peut-être' && tx1.rsvp_libelles.non === 'Tu ne viens pas', 'textes : libellés des réponses enregistrés (valeurs complètes)');
    check(tx1.zz_custom === 'garde-moi', 'textes : clé de site_textes hors formulaire conservée à l\'enregistrement');
    check(!('accueil_lead' in tx1), 'textes : texte égal au défaut non enregistré');

    // « Valeur par défaut » sur un champ et sur un libellé, puis enregistrer
    await pt.click('button[data-reset="site_textes.accueil_titre"]');
    check(await field('site_textes.accueil_titre').inputValue() === 'Le QG du Humane Gang', 'textes : « Valeur par défaut » remet le titre d\'origine dans le champ');
    await pt.click('button[data-reset="site_textes.rsvp_libelles"]');
    check(await pt.inputValue('#rgi-site-textes-rsvp-libelles-oui') === 'Tu viens', 'textes : « Valeur par défaut » remet les libellés de réponses');
    await pt.click('#rgi-save');
    await sleep(500);
    const tx2 = await storedValue(pt, 'site_textes') || {};
    check(!('accueil_titre' in tx2) && !('rsvp_libelles' in tx2) && tx2.ss_pas_edition === 'Rien pour l’instant' && tx2.zz_custom === 'garde-moi',
      'textes : défaut retiré des écarts, autres réglages conservés');

    // Champ vidé : le défaut est enregistré (rien d'écrit), et le formulaire le réaffiche
    await field('site_textes.ss_pas_edition').fill('');
    await pt.click('#rgi-save');
    await sleep(500);
    check(!('ss_pas_edition' in (await storedValue(pt, 'site_textes') || {})), 'textes : champ vidé = texte d\'origine (rien d\'écrit)');
    check(await field('site_textes.ss_pas_edition').inputValue() === 'Pas encore d\'édition', 'textes : après enregistrement, le champ vidé affiche le texte d\'origine');

    // Le site affiche le texte réglé
    const pa = await openPage(browser, { page: 'accueil', fixture: FX_TEXTES, scenario: { reglages: { site_textes: { accueil_titre: 'QG seedé' } } } });
    check((await pa.textContent('h1.page-title')).includes('QG seedé'), 'accueil : titre réglé affiché sur le site');
    check(pa.errs.length === 0, 'accueil : aucune erreur JS' + (pa.errs.length ? ' (' + pa.errs.slice(0, 2).join(' | ') + ')' : ''));
    await pa.close(); await pa.ctx.close();

    // 390 px : pas de défilement horizontal
    const pm = await openPage(browser, { page: 'admin', fixture: FX_TEXTES, width: 390, height: 844, touch: true });
    await goto(pm, 'mairie/textes', '#rgi-form');
    check((await hscroll(pm)) <= 0, 'textes 390 px : pas de défilement horizontal');
    check(pm.errs.length === 0 && pt.errs.length === 0, 'textes : aucune erreur console' + (pt.errs.length ? ' (' + pt.errs.slice(0, 2).join(' | ') + ')' : ''));
    await pm.close(); await pm.ctx.close();
    await pt.close(); await pt.ctx.close();

    /* ========== 2. Plafonds de Paillettes (Fabrique › Limites) ========== */
    const pl = await openPage(browser, { page: 'admin', fixture: FX_CARTES, width: 1440, height: 900, scenario: { settingsExtra: { cards: CARDS_START } } });
    await goto(pl, 'fabrique/limites', '#acd-econ-form');
    await pl.evaluate(() => document.querySelectorAll('details.acd-fold-plaf').forEach((d) => { d.open = true; })); // plafonds repliés : ouverts pour les saisir
    const legends = await pl.$$eval('#acd-econ-form fieldset', (fs) => fs.filter((f) => f.getClientRects().length).map((f) => f.querySelector('legend').textContent.trim()));
    const wanted = ['Jeux quotidiens', 'Quiz et citations', 'Photos et sorties', 'Limites de publication', 'Codes cadeaux et badges', 'Calendrier de l’Avent', 'Arène actuelle'];
    check(wanted.every((w) => legends.includes(w)), `plafonds : groupes thématiques dans « Limites » (${legends.join(' | ')})`);
    check(await pl.inputValue('#acd-e-plafonds_bataille_gain') === '12', 'plafonds : valeur enregistrée affichée (Arène : 12)');
    check(await pl.inputValue('#acd-e-plafonds_quiz_serie_7') === '' && await pl.getAttribute('#acd-e-plafonds_quiz_serie_7', 'placeholder') === '50',
      'plafonds : non enregistré = champ vide, défaut (50) en placeholder');
    check(await pl.getAttribute('#acd-e-plafonds_framed_gain', 'max') === '200' && await pl.getAttribute('#acd-e-plafonds_quiz_serie_7', 'max') === '1000', 'plafonds : bornes affichées dans les champs');

    // Bornes refusées, puis valeurs acceptées
    await pl.fill('#acd-e-plafonds_code_paillettes', '2000');
    await pl.click('#acd-econ-form [type="submit"]');
    await sleep(400);
    check(/Paillettes maximum par code cadeau/.test(await pl.textContent('#acd-econ-form .form-error')) && await lastCardsWrite(pl) === null,
      'plafonds : valeur hors bornes refusée, rien écrit');
    await pl.fill('#acd-e-plafonds_code_paillettes', '900');
    await pl.fill('#acd-e-plafonds_quiz_serie_7', '75');
    await pl.fill('#acd-e-plafonds_photos_jour', '');
    await pl.click('#acd-econ-form [type="submit"]');
    await sleep(500);
    const w1 = await lastCardsWrite(pl);
    check(w1 && w1.plafonds.quiz_serie_7 === 75 && w1.plafonds.code_paillettes === 900, `plafonds : valeurs saisies enregistrées (${JSON.stringify(w1 && w1.plafonds)})`);
    check(w1 && !('photos_jour' in w1.plafonds), 'plafonds : champ vidé retiré (le SQL reprend son défaut)');
    check(w1 && Number(w1.plafonds.bataille_gain) === 12 && Number(w1.plafonds.batailles_jour) === 3 && w1.plafonds.zz_custom === '7',
      'plafonds : autres sous-clés de cards.plafonds conservées (Arène et clé inconnue)');
    check(w1 && w1.rewards.daily === 100 && w1.rewards.citation === 20 && w1.zz_top === 'garde', 'plafonds : récompenses et clé de premier niveau conservées');

    // Rétablir un groupe : ses champs se vident (défauts), les autres groupes ne bougent pas
    await pl.fill('#acd-e-plafonds_framed_gain', '30');
    await pl.click('fieldset:has(legend:text-is("Jeux quotidiens")) [data-act="econ-default"]');
    await sleep(200);
    check(await pl.inputValue('#acd-e-plafonds_framed_gain') === '' && await pl.inputValue('#acd-e-plafonds_quiz_serie_7') === '75',
      'plafonds : « Rétablir » remplit le groupe avec les défauts sans toucher aux autres');
    await pl.click('#acd-econ-form [type="submit"]');
    await sleep(500);
    const w2 = await lastCardsWrite(pl);
    check(w2 && !('framed_gain' in w2.plafonds) && w2.plafonds.quiz_serie_7 === 75, 'plafonds : après enregistrement, le défaut est retiré des écarts');

    // Parties : enregistrer depuis « Tirage » conserve les plafonds
    await goto(pl, 'fabrique/tirage', '#acd-econ-form');
    await pl.fill('#acd-e-pity_epique', '25');
    await pl.click('#acd-econ-form [type="submit"]');
    await sleep(500);
    const w3 = await lastCardsWrite(pl);
    check(w3 && w3.pity_epique === 25 && w3.plafonds.quiz_serie_7 === 75 && Number(w3.plafonds.bataille_gain) === 12 && w3.plafonds.zz_custom === '7', 'plafonds : enregistrer depuis « Tirage » conserve les plafonds');
    check(pl.errs.length === 0, 'plafonds : aucune erreur console' + (pl.errs.length ? ' (' + pl.errs.slice(0, 2).join(' | ') + ')' : ''));
    await pl.close(); await pl.ctx.close();

    // 390 px
    const pm2 = await openPage(browser, { page: 'admin', fixture: FX_CARTES, width: 390, height: 844, touch: true });
    await goto(pm2, 'fabrique/limites', '#acd-econ-form');
    check((await hscroll(pm2)) <= 0, 'plafonds 390 px : pas de défilement horizontal');
    check(pm2.errs.length === 0, 'plafonds 390 px : aucune erreur console');
    await pm2.close(); await pm2.ctx.close();
  } catch (e) {
    check(false, `exception : ${e.message}`);
  } finally {
    await browser.close();
    finish();
  }
})();
