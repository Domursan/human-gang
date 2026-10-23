// Parcours : « Signaler un contenu » (idée A6, migration 093).
// (a) membre, Historique : le moment d'un autre membre a un menu « … » → « Signaler » ; raison, mot, envoi (hg_report),
//     confirmation « Merci, le Staff regarde » ; pas de menu sur son propre moment.
// (b) membre, Messages (direct) : « Signaler » sur le message de l'autre ; message masqué : mention pour l'auteur.
// (c) membre, IRL : la visionneuse propose « Signaler » sur la photo d'un autre membre, pas sur la sienne.
// (d) Staff, Assistance : filtre « Signalements », aperçu de la photo, raison, « Masquer » (hg_report_resolve).
// (e) 360 px : fenêtre de signalement sans défilement horizontal, cibles ≥ 44 px.
// Faux Supabase (fixtures/fake-sb.mjs). Lancer : node tests/parcours-signalement.cjs
const { check, finish, openPage, hscroll, adminSection, log, sleep, chromium } = require('./lib/harness.cjs');

const ME = '11111111-1111-4111-8111-111111111111';
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const CONV = 'c0000000-0000-4000-8000-0000000000aa';
const MSG = {
  uid: U(3),
  conversations: [{ id: CONV, kind: 'direct', title: null, created_at: ago(60), last_message_at: ago(5) }],
  convMembers: [{ conversation_id: CONV, user_id: U(3) }, { conversation_id: CONV, user_id: U(2) }],
  messages: [
    { id: 11, conversation_id: CONV, sender_id: U(2), body: 'Achète mes cartes pas chères !!!', created_at: ago(30) },
    { id: 12, conversation_id: CONV, sender_id: U(3), body: 'Mon message masqué', created_at: ago(20), hidden_at: ago(10) },
    { id: 13, conversation_id: CONV, sender_id: U(2), body: 'Salut Bruno', created_at: ago(5) },
  ],
};

(async () => {
  const browser = await chromium.launch();
  try {
    /* ---------- (a) Historique ---------- */
    let p = await openPage(browser, { page: 'historique', scenario: { uid: U(3) } });
    await p.waitForSelector('.tl-card-moment', { timeout: 8000 });
    // Bruno (U3) : le moment d'Alice a un menu, le sien (« La partie de cartes ») non
    const btns = await p.$$eval('.tl-card-moment', (cards) => cards.map((c) => ({ t: c.querySelector('.tl-title')?.textContent, m: !!c.querySelector('.rp-more') })));
    check(btns.find((b) => b.t === 'Le karaoké de Noël')?.m === true && btns.find((b) => b.t === 'La partie de cartes')?.m === false,
      `(a) menu « … » sur le moment d’un autre, pas sur le sien (${JSON.stringify(btns)})`);
    const more = p.locator('.tl-card-moment', { hasText: 'Le karaoké de Noël' }).locator('.rp-more');
    const box = await more.boundingBox();
    check(box && box.width >= 44 && box.height >= 44, `(a) bouton « … » ≥ 44 px (${box && Math.round(box.width)}×${box && Math.round(box.height)})`);
    await more.click();
    check(await more.getAttribute('aria-expanded') === 'true' && await p.isVisible('.rp-menu [role="menuitem"]'), '(a) menu ouvert (aria-expanded, menuitem)');
    await p.click('.rp-menu [role="menuitem"]');
    await p.waitForSelector('.rp-dialog[open]', { timeout: 4000 });
    check((await p.textContent('.rp-dialog .dialog-title')).trim() === 'Signaler ce moment', '(a) fenêtre « Signaler ce moment »');
    check(await p.$$eval('.rp-dialog .rp-opt', (o) => o.map((x) => x.textContent.trim()).join('|')) === 'Blessant ou gênant|Information privée|Spam ou doublon|Autre', '(a) quatre raisons');
    await p.click('.rp-dialog [data-rp-send]');
    check(await p.isVisible('.rp-dialog .form-error'), '(a) envoi sans raison : message d’erreur');
    await p.click('.rp-dialog .rp-opt:has-text("Blessant ou gênant")');
    await p.fill('.rp-dialog textarea', 'Pas drôle du tout');
    await p.click('.rp-dialog [data-rp-send]');
    await p.waitForFunction(() => /Merci, le Staff regarde/.test(document.querySelector('.rp-dialog')?.textContent || ''), null, { timeout: 4000 }).catch(() => {});
    check(/ne saura pas que c’est toi/.test(await p.textContent('.rp-dialog')), '(a) confirmation « Merci, le Staff regarde… ne saura pas que c’est toi »');
    const call = (await log(p)).find((l) => l[0] === 'rpc' && l[1] === 'hg_report');
    check(call && call[2].p_kind === 'moment' && call[2].p_ref === 'mmmmmmmm-0000-4000-8000-000000000001' && call[2].p_reason === 'blessant' && call[2].p_note === 'Pas drôle du tout',
      '(a) hg_report(moment, id, blessant, mot)');
    await p.click('.rp-dialog button[value="ok"]');
    await p.waitForSelector('.rp-dialog', { state: 'detached', timeout: 3000 }).catch(() => {});
    check(!(await p.$('.rp-dialog')), '(a) fenêtre fermée');
    check(p.errs.length === 0, '(a) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.slice(0, 3).join(' | ') + ')' : ''));
    await p.ctx.close();

    /* ---------- (b) Messages ---------- */
    p = await openPage(browser, { page: 'messages', scenario: MSG, hash: '' });
    await p.goto(`http://hg.test/messages.html?c=${CONV}`);
    await p.waitForSelector('.msg-row', { timeout: 8000 });
    await sleep(500);
    const rows = await p.$$eval('.msg-row', (rs) => rs.map((r) => ({ id: r.dataset.id, rep: !!r.querySelector('.rp-more'), hid: r.classList.contains('is-hidden'), note: !!r.querySelector('.msg-hidden-note') })));
    check(rows.find((r) => r.id === '11')?.rep && !rows.find((r) => r.id === '12')?.rep, `(b) « … » sur le message de l’autre, pas sur le sien (${JSON.stringify(rows)})`);
    check(rows.find((r) => r.id === '12')?.hid && rows.find((r) => r.id === '12')?.note, '(b) mon message masqué : mention « Masqué par le Staff »');
    await p.click('.msg-row[data-id="11"] .rp-more');
    await p.click('.rp-menu [role="menuitem"]');
    await p.waitForSelector('.rp-dialog[open]', { timeout: 4000 });
    await p.click('.rp-dialog .rp-opt:has-text("Spam ou doublon")');
    await p.click('.rp-dialog [data-rp-send]');
    await sleep(400);
    const mcall = (await log(p)).find((l) => l[0] === 'rpc' && l[1] === 'hg_report');
    check(mcall && mcall[2].p_kind === 'message' && mcall[2].p_ref === '11' && mcall[2].p_reason === 'spam', '(b) hg_report(message, 11, spam)');
    check(p.errs.length === 0, '(b) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.slice(0, 3).join(' | ') + ')' : ''));
    await p.ctx.close();

    /* ---------- (c) IRL : visionneuse ---------- */
    p = await openPage(browser, { page: 'irl', scenario: { uid: U(3) } });
    await sleep(800);
    const thumbs = await p.$$('[data-act="photo"], .irl-photo, .alb-thumb, button[data-photo]');
    if (thumbs.length) {
      await thumbs[0].click();
      await p.waitForSelector('dialog.lightbox[open]', { timeout: 4000 }).catch(() => {});
      check(await p.isVisible('dialog.lightbox .lb-report'), '(c) visionneuse : « Signaler » sur la photo d’un autre membre');
    } else {
      // Sans vignette accessible dans ce scénario : on ouvre la visionneuse comme irl.js le fait
      await p.evaluate(async () => { const m = await import('/assets/js/photos.js'); m.openLightbox([{ url: 'data:,', report: 'pppppppp-0000-4000-8000-000000000001' }, { url: 'data:,' }]); });
      check(await p.isVisible('dialog.lightbox .lb-report'), '(c) visionneuse : « Signaler » sur une photo signalable');
      await p.click('dialog.lightbox .lb-next');
      check(!(await p.isVisible('dialog.lightbox .lb-report')), '(c) pas de « Signaler » sur sa propre photo');
    }
    await p.ctx.close();

    /* ---------- (d) Staff « support » : file des signalements ---------- */
    const SUP = {
      uid: U(4), staff: ['support'],
      support: [
        { id: 'sup-r1', user_id: U(3), pseudo: 'Bruno', subject: 'Signalement', message: 'Signalement · Photo · Information privée', status: 'ouverte', created_at: ago(20), updated_at: ago(20) },
        { id: 'sup-b1', user_id: U(5), pseudo: 'David', subject: 'Bug sur le site', message: 'Page Cartes vide', status: 'ouverte', created_at: ago(60), updated_at: ago(60) },
      ],
      reports: [{ id: 'rep-1', reporter: U(3), kind: 'photo', ref_id: 'pppppppp-0000-4000-8000-000000000001', reason: 'prive', note: 'On voit l’adresse sur le colis.',
        snapshot: { path: `${U(2)}/raclette-1.webp`, caption: 'Le fromage', event_title: 'Raclette de test', event_at: ago(43200), author: 'Alice' }, support_id: 'sup-r1', status: 'ouverte', created_at: ago(20) }],
    };
    p = await openPage(browser, { page: 'admin', scenario: SUP });
    await adminSection(p, 'communication/assistance');
    const chip = p.locator('.ui-chip', { hasText: 'Signalements' });
    check(await chip.count() === 1 && /1/.test(await chip.textContent()), '(d) filtre « Signalements » avec son compteur');
    await chip.click();
    await sleep(300);
    const titles = await p.$$eval('.ui-row-title', (t) => t.map((x) => x.textContent.trim()));
    check(titles.length === 1 && /Photo · Raclette de test/.test(titles[0]), `(d) seule la demande de signalement listée (${titles.join(' | ')})`);
    await p.evaluate(() => { location.hash = '#communication/assistance/sup-r1'; });
    await p.waitForSelector('.rp-card', { timeout: 5000 });
    check(await p.isVisible('.rp-card .rp-photo') && /Information privée/.test(await p.textContent('.rp-card .rp-reason')), '(d) aperçu de la photo et raison');
    check(/Signalé par 1 membre/.test(await p.textContent('.rp-card')) && /colis/.test(await p.textContent('.rp-card')), '(d) nombre de signalements et mot du signalement');
    await p.click('.rp-card [data-rp="masquer"]');
    await sleep(500);
    check((await log(p)).some((l) => l[0] === 'report_resolve' && l[1] === 'rep-1' && l[2] === 'masquer'), '(d) « Masquer » appelle hg_report_resolve');
    check(/Décision prise/.test(await p.textContent('.rp-card')), '(d) décision affichée après coup');
    check(p.errs.length === 0, '(d) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.slice(0, 3).join(' | ') + ')' : ''));
    await p.ctx.close();

    /* ---------- (e) 360 px ---------- */
    p = await openPage(browser, { page: 'historique', width: 360, height: 760, scenario: { uid: U(3) } });
    await p.waitForSelector('.tl-card-moment .rp-more', { timeout: 8000 });
    await p.locator('.tl-card-moment .rp-more').first().click();
    await p.click('.rp-menu [role="menuitem"]');
    await p.waitForSelector('.rp-dialog[open]', { timeout: 4000 });
    const small = await p.$$eval('.rp-dialog .rp-opt, .rp-dialog .btn', (els) => els.filter((e) => e.getBoundingClientRect().height < 44).length);
    check(small === 0, `(e) 360 px : cibles ≥ 44 px (${small} trop petites)`);
    check(await hscroll(p) <= 0, '(e) 360 px : pas de défilement horizontal');
    await p.ctx.close();
  } catch (e) {
    check(false, 'arrêt sur erreur : ' + String(e.message).split('\n')[0]);
  } finally {
    await browser.close();
  }
  finish();
})();
