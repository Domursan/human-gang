// Parcours : la prise en charge d'une demande d'assistance ouvre une conversation privée (migration 066).
// (a) membre 390 px, page Messages : la conversation porte le nom de la demande, l'étiquette « Assistance »,
//     le résumé de la demande en haut (sujet, statut, auteur, message), et la réponse part dans la conversation.
// (b) membre, page Assistance : la demande prise en charge propose « Ouvrir la conversation ».
// (c) long message : le résumé est replié (« Lire toute la demande »).
// Faux Supabase (fixtures/fake-sb.mjs). Lancer : node tests/parcours-assistance-conversation.cjs
const { check, finish, openPage, hscroll, chromium } = require('./lib/harness.cjs');

const ME = '11111111-1111-4111-8111-111111111111';          // admin (fixture)
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`; // Alice = U(2)
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const LONG = 'Bonjour, je n\'arrive plus à me connecter depuis mon téléphone. '.repeat(8);

const SCN = {
  uid: U(2),
  support: [
    { id: 'sup-1', user_id: U(2), pseudo: 'Alice', subject: 'Paillettes non créditées', message: 'Je suis venu à la sortie IRL de samedi, je n\'ai pas reçu mes Paillettes.',
      contact: null, status: 'ouverte', taken_by: ME, taken_at: ago(20), read_at: ago(25), created_at: ago(30), updated_at: ago(20), conversation_id: 'c0000000-0000-4000-8000-000000000001' },
    { id: 'sup-2', user_id: U(2), pseudo: 'Alice', subject: 'Connexion impossible', message: LONG,
      contact: null, status: 'ouverte', taken_by: ME, taken_at: ago(10), read_at: ago(12), created_at: ago(15), updated_at: ago(10), conversation_id: 'c0000000-0000-4000-8000-000000000002' },
  ],
  conversations: [
    { id: 'c0000000-0000-4000-8000-000000000001', kind: 'support', title: 'Paillettes non créditées', support_id: 'sup-1', created_at: ago(20), last_message_at: ago(20) },
    { id: 'c0000000-0000-4000-8000-000000000002', kind: 'support', title: 'Connexion impossible', support_id: 'sup-2', created_at: ago(10), last_message_at: ago(10) },
  ],
  convMembers: [
    { conversation_id: 'c0000000-0000-4000-8000-000000000001', user_id: ME }, { conversation_id: 'c0000000-0000-4000-8000-000000000001', user_id: U(2) },
    { conversation_id: 'c0000000-0000-4000-8000-000000000002', user_id: ME }, { conversation_id: 'c0000000-0000-4000-8000-000000000002', user_id: U(2) },
  ],
  messages: [
    { id: 1, conversation_id: 'c0000000-0000-4000-8000-000000000001', sender_id: ME, body: 'Salut Alice ! Je prends en charge ta demande « Paillettes non créditées ».', created_at: ago(20) },
    { id: 2, conversation_id: 'c0000000-0000-4000-8000-000000000002', sender_id: ME, body: 'Salut Alice ! Je prends en charge ta demande « Connexion impossible ».', created_at: ago(10) },
  ],
};

/** Attend qu'une condition soit vraie dans la page (5 s au plus). */
const waitFor = (p, fn) => p.waitForFunction(fn, null, { timeout: 5000 }).catch(() => {});

(async () => {
  const browser = await chromium.launch();

  /* (a) Page Messages : conversation d'assistance */
  {
    const p = await openPage(browser, { page: 'messages', width: 390, height: 844, scenario: SCN, query: '?c=c0000000-0000-4000-8000-000000000001' });
    await p.goto(p.url().split('?')[0] + '?c=c0000000-0000-4000-8000-000000000001').catch(() => {});
    await waitFor(p, () => !!document.querySelector('#msg-support-sum .msg-support-subject'));
    check((await p.textContent('#msg-thread-t'))?.trim() === 'Paillettes non créditées', '(a) titre de la conversation = sujet de la demande');
    check((await p.textContent('.msg-thread-sub')).includes('Assistance'), '(a) sous-titre « Assistance · conversation privée avec le Staff »');
    const sum = await p.textContent('#msg-support-sum');
    check(sum.includes('Demande d’assistance') && sum.includes('Paillettes non créditées') && sum.includes('En cours'), '(a) résumé : sujet et statut « En cours »');
    check(sum.includes('Alice') && sum.includes('sortie IRL de samedi'), '(a) résumé : auteur et message d\'origine');
    check(sum.includes('prise en charge par Ethan'), '(a) résumé : qui a pris la demande en charge');
    check((await p.textContent('#msg-thread')).includes('Je prends en charge ta demande'), '(a) fil : le premier message du Staff');
    await p.fill('#msg-input', 'Merci, c\'était samedi soir à Lausanne.');
    await p.click('#msg-send');
    await waitFor(p, () => window.__DB.hg_messages.some((m) => m.body.includes('Lausanne')));
    const sent = await p.evaluate(() => window.__DB.hg_messages.find((m) => m.body.includes('Lausanne'))?.conversation_id);
    check(sent === 'c0000000-0000-4000-8000-000000000001', '(a) la réponse du membre part dans la conversation d\'assistance');
    check(await hscroll(p) === 0, '(a) 390 px : pas de défilement horizontal');
    check(!p.errs.length, '(a) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.context().close();
  }

  /* (a bis) Liste des conversations : étiquette Assistance */
  {
    const p = await openPage(browser, { page: 'messages', width: 1280, height: 900, scenario: SCN });
    await waitFor(p, () => document.querySelectorAll('#msg-convs [data-conv]').length >= 2);
    const tags = await p.locator('#msg-convs .msg-tag.is-support').count();
    check(tags === 2, `(a) liste : étiquette « Assistance » sur les conversations d'assistance (${tags})`);
    check(!p.errs.length, '(a) liste : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.context().close();
  }

  /* (b) Page Assistance : lien vers la conversation */
  {
    const p = await openPage(browser, { page: 'assistance', width: 390, height: 844, scenario: SCN });
    await waitFor(p, () => document.querySelectorAll('#my-support-list .my-support-row').length > 0);
    check((await p.textContent('#my-support-list')).includes('Discussion ouverte dans tes Messages'), '(b) liste : mention de la discussion ouverte');
    await p.click('#my-support-list .my-support-row[data-id="sup-1"]');
    await waitFor(p, () => !!document.querySelector('#my-support-thread .my-support-convbox a'));
    const href = await p.getAttribute('#my-support-thread .my-support-convbox a', 'href');
    check(href === 'messages.html?c=c0000000-0000-4000-8000-000000000001', `(b) détail : bouton « Ouvrir la conversation » vers la conversation (${href})`);
    check(!p.errs.length, '(b) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.context().close();
  }

  /* (c) Long message : résumé replié */
  {
    const p = await openPage(browser, { page: 'messages', width: 1280, height: 900, scenario: SCN });
    await p.goto(p.url().split('?')[0] + '?c=c0000000-0000-4000-8000-000000000002').catch(() => {});
    await waitFor(p, () => !!document.querySelector('#msg-support-sum .msg-support-subject'));
    check(await p.locator('#msg-support-sum details.msg-support-msg').count() === 1, '(c) long message : résumé replié');
    check((await p.textContent('#msg-support-sum summary')).includes('Lire toute la demande'), '(c) lien « Lire toute la demande »');
    check(!p.errs.length, '(c) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.context().close();
  }

  await browser.close();
  finish();
})().catch((e) => { console.error(e); process.exitCode = 1; });
