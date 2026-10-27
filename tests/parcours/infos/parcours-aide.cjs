// Parcours : aide et tutos.
// Bouton « ? » dans l'éventail du profil (membre) ou dans l'en-tête (visiteur) sur plusieurs pages ;
// page /pages/infos/aide.html : liste des groupes, recherche (sans accents ni casse), tuto ouvert par l'adresse /pages/infos/aide.html#<slug>,
// « Y aller » ; visiteur (sans compte) : seulement les tutos « Premiers pas » ; accès à l'assistance depuis l'aide ;
// plus de lien Assistance dans le pied de page ; 390 px sans défilement horizontal.
// Données : assets/espaces/infos/tutos/<groupe>.js (61 tutos). Contrôles sans navigateur : slugs uniques, pages existantes,
// nombre d'étapes (3 à 7).
// Faux Supabase : fixtures/fake-sb.mjs (scenario.guest pour un visiteur).
// Lancer : node tests/parcours/infos/parcours-aide.cjs   (HG_ROOT / HG_PREFIX comme les autres parcours)
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { ROOT, SHOTS, check, finish, openPage, hscroll, sleep, chromium } = require('../../lib/harness.cjs');

/** Membre : le « ? » est dans l'éventail de la photo de profil (.nav-me) ; on ouvre l'éventail d'abord. */
const ouvrirMoi = async (pg) => {
  await pg.locator('.nav-me').click();
  await pg.waitForSelector('.me-fan a.nav-help', { state: 'visible', timeout: 4000 }).catch(() => {});
};

const MEMBER_SLUG = 'ouvrir-un-booster';   // tuto membre (cartes-base), page cartes.html, 7 étapes, 3 astuces
const GUEST_SLUG = 'se-connecter';          // tuto « Premiers pas », visible sans compte, 5 étapes
const GROUP_IDS = ['premiers-pas', 'secret-santa', 'irl-historique', 'cartes-base', 'cartes-avance', 'communaute'];

/* ---------- Données (sans navigateur) ---------- */
/**
 * Importe les données d'un groupe. Dans une version construite (HG_ROOT=_site), le fichier d'origine n'est qu'un relais
 * « export * from "/assets/_b/…" » vers le fichier regroupé : Node ne résout pas une adresse absolue de site, on suit donc
 * le relais sur le disque. Dans la source, le fichier contient directement les données.
 */
async function importerGroupe(id) {
  let file = path.join(ROOT, 'assets/espaces/infos/tutos', id + '.js');
  const relais = fs.readFileSync(file, 'utf8').match(/^export \* from "(\/[^"]+)";/m);
  if (relais) file = path.join(ROOT, relais[1]);
  return (await import(pathToFileURL(file).href)).default;
}

/** Parcourt les groupes et tutos de la page d'aide et relève les anomalies : slug en double, page absente, étapes manquantes. */
async function checkData() {
  const slugs = new Map();   // slug -> groupe
  const badSlug = [], badPage = [], badSteps = [];
  let total = 0, groupsOk = 0;
  for (const id of GROUP_IDS) {
    let g = null;
    try { g = await importerGroupe(id); } catch (e) { /* signalé plus bas */ }
    if (!g || !Array.isArray(g.tutos)) { badPage.push(`groupe ${id} illisible`); continue; }
    groupsOk++;
    for (const t of g.tutos) {
      total++;
      if (!/^[a-z0-9-]+$/.test(t.slug || '')) badSlug.push(String(t.slug));
      if (slugs.has(t.slug)) badSlug.push(`${t.slug} (en double : ${slugs.get(t.slug)} et ${id})`);
      else slugs.set(t.slug, id);
      if (t.page) {
        const file = String(t.page).split('#')[0];
        if (!/\.html$/.test(file) || !fs.existsSync(path.join(ROOT, file))) badPage.push(`${t.slug} -> ${t.page}`);
      }
      const n = Array.isArray(t.steps) ? t.steps.length : 0;
      if (n < 3 || n > 7) badSteps.push(`${t.slug} (${n})`);
    }
  }
  check(groupsOk === GROUP_IDS.length, `données : les ${GROUP_IDS.length} groupes se chargent (${groupsOk})`);
  check(total >= 61, `données : au moins 61 tutos (${total})`);
  check(badSlug.length === 0, `données : slugs uniques sur tout le site${badSlug.length ? ' — ' + badSlug.join(', ') : ''}`);
  check(badPage.length === 0, `données : chaque page pointe vers un fichier HTML existant${badPage.length ? ' — ' + badPage.join(', ') : ''}`);
  check(badSteps.length === 0, `données : 3 à 7 étapes par tuto${badSteps.length ? ' — ' + badSteps.join(', ') : ''}`);
  return slugs;
}

(async () => {
  const slugs = await checkData();
  check(slugs.get(MEMBER_SLUG) === 'cartes-base', `données : « ${MEMBER_SLUG} » existe dans cartes-base`);
  check(slugs.get(GUEST_SLUG) === 'premiers-pas', `données : « ${GUEST_SLUG} » existe dans premiers-pas`);

  const browser = await chromium.launch();

  /* ---------- Bouton « ? » sur plusieurs pages (membre, 1280 px) ---------- */
  for (const pg of ['accueil', 'cartes', 'irl', 'compte', 'assistance', 'legal']) {
    const p = await openPage(browser, { page: pg, width: 1280 });
    await ouvrirMoi(p);
    const n = await p.locator('.me-fan a.nav-help[href="/pages/infos/aide.html"]').count();
    check(n === 1, `${pg} : bouton « ? » dans l'éventail du profil (${n})`);
    await p.ctx.close();
  }

  /* ---------- Visiteur : bouton « ? » aussi, pied de page sans Assistance ---------- */
  let p = await openPage(browser, { page: 'accueil', scenario: { guest: true }, width: 1280 });
  check(await p.locator('.site-header a.nav-help').count() === 1, 'visiteur : bouton « ? » présent');
  check(await p.locator('.site-footer a[href="/pages/infos/assistance.html"]').count() === 0, 'pied de page : plus de lien Assistance');
  await p.ctx.close();

  /* ---------- Membre : pied de page sans Assistance, page d'aide ---------- */
  p = await openPage(browser, { page: 'accueil', width: 1280 });
  check(await p.locator('.site-footer a[href="/pages/infos/assistance.html"]').count() === 0, 'membre : pied de page sans lien Assistance');
  check(await p.locator('.site-footer a[href="/pages/infos/legal.html#mentions"]').count() === 1, 'membre : pied de page garde les liens légaux');
  await p.ctx.close();

  /* ---------- Page d'aide (membre) : liste, recherche ---------- */
  const memberLink = `a.aide-tuto-link[href="/pages/infos/aide.html#${MEMBER_SLUG}"]`;
  p = await openPage(browser, { page: 'aide', width: 1280 });
  check(p.errs.length === 0, `aide : chargement sans erreur${p.errs.length ? ' ' + p.errs.join(' | ') : ''}`);
  check(await p.locator('.aide-group').count() === 6, 'aide : les six groupes affichés pour un membre');
  check(await p.locator(memberLink).count() === 1, 'aide : le tuto « Ouvrir un booster » est listé');
  check(await p.locator(`${memberLink} .aide-tuto-title`).innerText().then((t) => t === 'Ouvrir un booster'), 'aide : titre du tuto affiché');
  await p.fill('#aide-q', 'booster');
  await sleep(150);
  check(await p.locator(memberLink).count() === 1, 'recherche « booster » : trouve « Ouvrir un booster »');
  check(await p.locator('.aide-tuto-link').count() === 3, 'recherche « booster » : trois résultats (« Fabriquer une carte » et « Préférences d’affichage » citent aussi le booster)');
  check(await p.locator('#aide-count').innerText().then((t) => t === '3 tutos trouvés'), 'recherche « booster » : compteur « 3 tutos trouvés »');
  await p.fill('#aide-q', 'BOOSTER');
  await sleep(150);
  check(await p.locator(memberLink).count() === 1, 'recherche « BOOSTER » (casse ignorée) : trouve le tuto');
  await p.fill('#aide-q', 'ÉCHANGE');
  await sleep(150);
  check(await p.locator('a.aide-tuto-link[href="/pages/infos/aide.html#proposer-un-echange"]').count() === 1, 'recherche « ÉCHANGE » (majuscules et accent) : trouve « Proposer un échange »');
  await p.fill('#aide-q', 'Recyclér');
  await sleep(150);
  check(await p.locator('a.aide-tuto-link[href="/pages/infos/aide.html#recycler-ses-doublons"]').count() === 1, 'recherche « Recyclér » (accent ignoré) : trouve « Recycler ses doublons »');
  await p.fill('#aide-q', 'zzqx');
  await sleep(150);
  check(await p.locator('.aide-tuto-link').count() === 0, 'recherche « zzqx » : aucun résultat');
  check(await p.locator('#aide-empty').isVisible(), 'recherche « zzqx » : message « aucun tuto »');
  await p.fill('#aide-q', '');
  await sleep(100);
  check(await p.locator('#aide-count').innerText().then((t) => t === ''), 'recherche vide : pas de compteur');
  await ouvrirMoi(p);
  check(await p.locator('.me-fan a.nav-help[aria-current="page"]').count() === 1, 'aide : « ? » marqué comme page courante');
  check(await hscroll(p) <= 0, 'aide 1280 : pas de défilement horizontal');
  await p.ctx.close();

  /* ---------- Tuto ouvert par son adresse ---------- */
  p = await openPage(browser, { page: 'aide', hash: '#' + MEMBER_SLUG, width: 1280 });
  check(await p.locator('#aide-list-view').isHidden(), 'tuto par adresse : la liste est masquée');
  check(await p.locator('#aide-tuto-view').isVisible(), 'tuto par adresse : le tuto est affiché');
  check(await p.locator('.aide-step').count() === 7, 'tuto : sept étapes numérotées');
  check(await p.locator('.aide-step-num').first().innerText().then((t) => t === '1'), 'tuto : numérotation à partir de 1');
  check(await p.locator('.aide-shot').count() === 0, 'tuto : pas de capture (aucune étape n\'en a)');
  check(await p.locator('.aide-tips li').count() === 3, 'tuto : trois astuces');
  check(await p.locator('.aide-actions a.btn-primary').getAttribute('href') === '/pages/cartes/cartes.html', 'tuto : bouton « Y aller » vers /pages/cartes/cartes.html');
  check(await p.title().then((t) => t.startsWith('Ouvrir un booster')), 'tuto : titre de l\'onglet mis à jour');
  check(await hscroll(p) <= 0, 'tuto 1280 : pas de défilement horizontal');
  // Retour à la liste par le fil d'Ariane
  await p.click('.aide-crumb a');
  await sleep(200);
  check(await p.locator('#aide-list-view').isVisible(), 'tuto : « Tous les tutos » revient à la liste');
  await p.ctx.close();

  /* ---------- Adresse inconnue ---------- */
  p = await openPage(browser, { page: 'aide', hash: '#n-existe-pas', width: 1280 });
  check((await p.locator('#aide-tuto-view').innerText()).includes("n'existe pas"), 'adresse inconnue : message « n\'existe pas »');
  await p.ctx.close();

  /* ---------- Visiteur : tutos Premiers pas seulement, pas de tuto membre ---------- */
  p = await openPage(browser, { page: 'aide', scenario: { guest: true }, width: 1280 });
  check(await p.locator(`a.aide-tuto-link[href="/pages/infos/aide.html#${GUEST_SLUG}"]`).count() === 1, 'visiteur : tuto « Premiers pas » visible');
  check(await p.locator('.aide-group').count() === 1, 'visiteur : un seul groupe (Premiers pas)');
  check(await p.locator(memberLink).count() === 0, 'visiteur : « Ouvrir un booster » (membres) non listé');
  check(await p.locator('#aide-guest').isVisible(), 'visiteur : note « Te connecter » affichée');
  check(await p.locator('#aide-list-view a[href="/pages/compte/compte.html"]').count() >= 1, 'visiteur : lien vers la connexion');
  await p.ctx.close();
  p = await openPage(browser, { page: 'aide', scenario: { guest: true }, hash: '#' + GUEST_SLUG, width: 1280 });
  check(await p.locator('.aide-steps').count() === 1, 'visiteur : tuto « Premiers pas » ouvrable par son adresse');
  await p.ctx.close();
  p = await openPage(browser, { page: 'aide', scenario: { guest: true }, hash: '#' + MEMBER_SLUG, width: 1280 });
  check((await p.locator('#aide-tuto-view').innerText()).includes('réservé aux membres'), 'visiteur : tuto membre par adresse → « réservé aux membres »');
  await p.ctx.close();

  /* ---------- Assistance depuis l'aide ---------- */
  p = await openPage(browser, { page: 'aide', width: 1280 });
  const help = p.locator('.aide-help');
  check(await help.locator('a[href="/pages/infos/assistance.html"]').count() === 1, 'aide : « Contacter l\'assistance » mène à /pages/infos/assistance.html');
  check(await help.locator('a[href="/pages/infos/assistance.html?sujet=Bug%20sur%20le%20site"]').count() === 1, 'aide : « Signaler un bug » mène au sujet « Bug sur le site »');
  check(await help.locator('a[href="/pages/compte/accueil.html#idees"]').count() === 1, 'aide : « Proposer une idée » mène à la boîte à idées');
  await help.locator('a[href="/pages/infos/assistance.html?sujet=Bug%20sur%20le%20site"]').click();
  await p.waitForURL(/assistance\.html\?sujet=Bug/, { timeout: 8000 }).catch(() => {});
  await sleep(800);
  check(await p.locator('#sp-subject').inputValue().then((v) => v === 'Bug sur le site'), 'assistance : le sujet « Bug sur le site » est pré-rempli');
  check(await p.locator('#support-form').isVisible(), 'assistance : le formulaire est intact');
  await p.ctx.close();

  /* ---------- Téléphone 390 px : bouton, menu, page d'aide sans défilement ---------- */
  p = await openPage(browser, { page: 'accueil', width: 390 });
  await p.locator('.nav-me').isVisible().then((ok) => check(ok, '390 px : photo de profil (éventail) visible'));
  check(await hscroll(p) <= 0, '390 px accueil : pas de défilement horizontal');
  // Alignement : le bouton Menu est centré verticalement sur le logo (à 3 px près)
  const centreY = async (sel) => { const b = await p.locator(sel).first().boundingBox(); return b.y + b.height / 2; };
  const ecart = Math.abs((await centreY('.nav-toggle')) - (await centreY('.brand img')));
  check(ecart <= 3, '390 px : bouton Menu centré sur le logo (écart ' + ecart.toFixed(1) + ' px)');
  await p.click('.nav-toggle');
  await sleep(150);
  check(await p.getAttribute('.nav-toggle', 'aria-expanded') === 'true', '390 px : menu ouvert, aria-expanded à true');
  check(await p.locator('.nav .nav-group').first().isVisible(), '390 px : menu ouvert, groupes de navigation visibles');
  await p.ctx.close();
  p = await openPage(browser, { page: 'accueil', width: 390 });
  await ouvrirMoi(p);
  check(await p.locator('.me-fan a.nav-help').isVisible(), '390 px : bouton « ? » visible dans l\'éventail du profil');
  await p.ctx.close();
  p = await openPage(browser, { page: 'aide', width: 390 });
  check(await hscroll(p) <= 0, '390 px aide : pas de défilement horizontal (liste)');
  check(await p.locator('.aide-tuto-link').first().isVisible(), '390 px aide : liste lisible');
  await p.ctx.close();
  p = await openPage(browser, { page: 'aide', hash: '#' + MEMBER_SLUG, width: 390 });
  check(await hscroll(p) <= 0, '390 px tuto : pas de défilement horizontal');
  await p.screenshot({ path: path.join(SHOTS, 'aide-tuto-390.png') }).catch(() => {});
  await p.ctx.close();
  p = await openPage(browser, { page: 'aide', hash: '#' + MEMBER_SLUG, width: 1280 });
  await p.screenshot({ path: path.join(SHOTS, 'aide-tuto-1280.png') }).catch(() => {});
  await p.ctx.close();

  await browser.close();
  finish();
})();
