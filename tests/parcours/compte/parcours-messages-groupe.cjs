// Parcours P3 « Conversations de groupe » (migration 090).
// (a) messages (390 px) : groupe dans la liste (pile d'avatars, étiquette « Sortie · N »), fil avec avatars et pseudos,
//     messages système centrés, envoi.
// (b) panneau du groupe : membres, sourdine, renommage, ajout, retrait (responsable), départ.
// (c) création d'un groupe libre ; (d) lien ?event=<sortie> (bouton de la page IRL) : discussion ouverte.
// (e) message d'un autre membre reçu pendant la lecture (actualisation) ; 360 px sans défilement.
// Faux Supabase : fixtures/fake-sb-social.mjs. Lancer : node tests/parcours/compte/parcours-messages-groupe.cjs
const { check, finish, openPage, hscroll, chromium, SHOTS } = require('../../lib/harness.cjs');

const ME = '11111111-1111-4111-8111-111111111111';
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
const G = 'gggg0000-0000-4000-8000-000000000001'.replace(/g/g, 'c');
const EV = 'eeeeeeee-0000-4000-8000-000000000001'; // « Raclette de test » (faux commun), organisée par Ethan
const SCN = {
  groups: [{ id: G, title: 'Nouvel an chez Litver', color: '#E2C77E', event_id: null, created_at: ago(300), last_message_at: ago(5) }],
  groupMembers: [{ conversation_id: G, user_id: U(2), role: 'resp' }, { conversation_id: G, user_id: ME }, { conversation_id: G, user_id: U(3) }, { conversation_id: G, user_id: U(4) }],
  groupMessages: [
    { id: 1, conversation_id: G, sender_id: U(2), body: 'Alice a créé le groupe « Nouvel an chez Litver »', created_at: ago(300), system: true },
    { id: 2, conversation_id: G, sender_id: U(2), body: 'Liste de courses en ligne ce soir. MERCI DE PAS TROLL.', created_at: ago(30) },
    { id: 3, conversation_id: G, sender_id: U(3), body: 'Je prends la raclette sans raclette', created_at: ago(20) },
    { id: 4, conversation_id: G, sender_id: ME, body: 'Moi j’en ai trois', created_at: ago(5) },
  ],
  rsvps: [{ event_id: EV, user_id: U(5), status: 'oui' }],
};
const waitFor = (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 6000 }).catch(() => {});
const open = (b, scn = SCN, w = 390, extra = {}) => openPage(b, { page: 'messages', fixture: 'fake-sb-social.mjs', width: w, height: 844, scenario: { ...scn, ...extra } });

(async () => {
  const browser = await chromium.launch();
  {
    const p = await open(browser);
    await waitFor(p, (g) => !!document.querySelector(`[data-conv="${g}"]`), G);
    const row = `[data-conv="${G}"]`;
    check(!!(await p.$(`${row} .grp-av`)), '(a) pile d’avatars du groupe');
    check((await p.textContent(`${row} .msg-tag`)).includes('Groupe · 4'), '(a) étiquette « Groupe · 4 »');
    await p.click(row);
    await waitFor(p, () => document.querySelectorAll('#msg-thread .msg-row').length >= 3);
    check((await p.textContent('.msg-thread-sub')).includes('Groupe · 4 membres'), '(a) sous-titre « Groupe · 4 membres »');
    check((await p.textContent('#msg-thread .msg-sys')).includes('a créé le groupe'), '(a) message système centré');
    check((await p.$$('#msg-thread .msg-row.is-grp .msg-row-av .avatar')).length === 2, '(a) avatar de chaque auteur (autres membres)');
    check((await p.$$eval('#msg-thread .msg-sender-grp', (e) => e.map((x) => x.textContent))).join(',') === 'Alice,Bruno', '(a) pseudo des auteurs');
    check((await p.getAttribute('#msg-input', 'placeholder')) === 'Écris au groupe…', '(a) invite « Écris au groupe… »');
    await p.fill('#msg-input', 'Arrivée à partir de 16 h le 31');
    await p.press('#msg-input', 'Enter');
    await waitFor(p, () => window.__SOC.msgs.some((m) => m.body.startsWith('Arrivée')));
    check(await p.evaluate(() => window.__SOC.msgs.some((m) => m.body.startsWith('Arrivée'))), '(a) envoi dans le groupe');
    check(await hscroll(p) === 0, '(a) 390 px : pas de défilement horizontal');
    await p.screenshot({ path: `${SHOTS}/p3-fil-390.png` });
    // (b) panneau : je ne suis pas responsable
    await p.click('#msg-group-info');
    await waitFor(p, () => !!document.querySelector('#grp-dlg[open]'));
    const panel = await p.textContent('#grp-dlg');
    check(panel.includes('4 membres') && panel.includes('Responsable'), '(b) panneau : membres et responsable');
    check(!(await p.$('#grp-rename')) && !(await p.$('[data-grp-rm]')), '(b) membre simple : ni renommage ni retrait');
    await p.click('[data-grp-mute="semaine"]');
    await waitFor(p, () => window.__LOG.some((l) => l[1] === 'hg_group_mute'));
    check(await p.evaluate(() => window.__LOG.find((l) => l[1] === 'hg_group_mute')[2].p_mode) === 'semaine', '(b) sourdine une semaine');
    await waitFor(p, () => document.querySelector('.msg-thread-sub')?.textContent.includes('sourdine'));
    check((await p.textContent('.msg-thread-sub')).includes('en sourdine'), '(b) sourdine affichée');
    check(!p.errs.length, '(a/b) aucune erreur JS' + (p.errs.length ? ` (${p.errs.join(' | ')})` : ''));
    await p.ctx.close();
  }
  // (b) responsable : renommer, ajouter, retirer, quitter
  {
    const p = await open(browser, SCN, 390, { groupMembers: SCN.groupMembers.map((m) => ({ ...m, role: m.user_id === ME ? 'resp' : 'membre' })) });
    await p.goto(`http://hg.test/pages/compte/messages.html?c=${G}`);
    await waitFor(p, () => !!document.querySelector('#msg-group-info'));
    await p.click('#msg-group-info');
    await waitFor(p, () => !!document.querySelector('#grp-rename'));
    await p.fill('#grp-rn', 'Nouvel an 2027');
    await p.click('#grp-rename [type=submit]');
    await waitFor(p, () => document.querySelector('#msg-thread-t')?.textContent === 'Nouvel an 2027');
    check((await p.textContent('#msg-thread-t')) === 'Nouvel an 2027', '(b) renommage : titre mis à jour');
    await waitFor(p, () => [...document.querySelectorAll('.msg-sys')].some((e) => e.textContent.includes('a renommé')));
    check((await p.textContent('#msg-thread')).includes('a renommé le groupe en « Nouvel an 2027 »'), '(b) message système de renommage');
    await p.click('#msg-group-info');
    await waitFor(p, () => !!document.querySelector('#grp-dlg[open] .grp-add'));
    await p.click('.grp-add summary');
    await p.check(`#grp-add-${U(5)}`);
    await p.click('#grp-add-go');
    await waitFor(p, () => window.__LOG.some((l) => l[1] === 'hg_group_add'));
    check(await p.evaluate(() => window.__LOG.find((l) => l[1] === 'hg_group_add')[2].p_users.length) === 1, '(b) ajout d’un membre');
    await p.waitForTimeout(500);
    await p.click('#msg-group-info');
    await waitFor(p, () => !!document.querySelector(`#grp-dlg[open] [data-grp-rm]`));
    await p.click(`[data-grp-rm="${U(4)}"]`);
    await p.click('dialog.hg-dialog[open] button[value="ok"]');
    await waitFor(p, () => window.__LOG.some((l) => l[1] === 'hg_group_remove'));
    check(await p.evaluate(() => window.__LOG.some((l) => l[1] === 'hg_group_remove')), '(b) retrait d’un membre (après confirmation)');
    check(!p.errs.length, '(b) aucune erreur JS' + (p.errs.length ? ` (${p.errs.join(' | ')})` : ''));
    await p.ctx.close();
  }
  // (c) création
  {
    const p = await open(browser, SCN, 360);
    await waitFor(p, () => !!document.querySelector('#msg-new-group'));
    await p.click('#msg-new-group');
    await waitFor(p, () => !!document.querySelector('#grp-new-dlg[open]'));
    await p.fill('#grp-title', 'Campagne Serge');
    await p.fill('#grp-search', 'chl');
    check(await p.$eval(`#grp-new-${U(2)}`, (e) => e.closest('li').hidden), '(c) recherche par pseudo');
    await p.check(`#grp-new-${U(4)}`);
    check(await hscroll(p) === 0, '(c) 360 px : pas de défilement horizontal');
    await p.screenshot({ path: `${SHOTS}/p3-creation-360.png` });
    await p.click('#grp-form [type=submit]');
    await waitFor(p, () => document.querySelector('#msg-thread-t')?.textContent === 'Campagne Serge');
    const a = await p.evaluate(() => window.__LOG.find((l) => l[1] === 'hg_group_create')?.[2]);
    check(a?.p_title === 'Campagne Serge' && a.p_members.length === 1 && /^#[0-9A-F]{6}$/i.test(a.p_color), '(c) hg_group_create : nom, couleur, membres');
    check((await p.textContent('#msg-thread-t')) === 'Campagne Serge', '(c) le nouveau groupe s’ouvre');
    check(!p.errs.length, '(c) aucune erreur JS' + (p.errs.length ? ` (${p.errs.join(' | ')})` : ''));
    await p.ctx.close();
  }
  // (d) discussion de sortie
  {
    const p = await open(browser, SCN, 390);
    await p.goto(`http://hg.test/pages/compte/messages.html?event=${EV}`);
    await waitFor(p, () => document.querySelector('.msg-thread-sub')?.textContent.includes('Discussion de la sortie'));
    check((await p.textContent('.msg-thread-sub')).includes('Discussion de la sortie · 2 membres'), '(d) discussion de la sortie (organisateur + réponse « oui »)');
    check(!(await p.url()).includes('event='), '(d) adresse nettoyée (?c=)');
    await p.ctx.close();
  }
  // (e) message d'un autre membre arrivé pendant la lecture : actualisation sans recharger (le vrai Realtime n'existe pas hors ligne)
  {
    const a = await open(browser, SCN, 390);
    await a.goto(`http://hg.test/pages/compte/messages.html?c=${G}`);
    await waitFor(a, () => document.querySelectorAll('#msg-thread .msg-row').length >= 3);
    await a.evaluate(() => { window.__SOC.msgs.push({ id: 500, conversation_id: 'cccc0000-0000-4000-8000-000000000001', sender_id: '00000002-0000-4000-8000-000000000002', body: 'Message de l’autre onglet', created_at: new Date().toISOString(), system: false }); });
    await a.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(a, () => document.querySelector('#msg-thread')?.textContent.includes('autre onglet'));
    check((await a.textContent('#msg-thread')).includes('Message de l’autre onglet'), '(e) message d’un autre membre reçu sans recharger la page');
    await a.ctx.close();
  }
  await browser.close();
  finish();
})();
