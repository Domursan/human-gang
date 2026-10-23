// Parcours : « Qui sait faire quoi » (idée P7, migration 091).
// (a) Annuaire : pastilles « Qui sait faire… », volontaires d'une compétence (précision, « aussi : »), lien
//     « Demander un coup de main » vers une conversation préremplie ; « Tout le gang » rend la grille ; 360 px.
// (b) Messages : le brouillon passé dans l'adresse est placé dans la zone de saisie, jamais envoyé seul.
// (c) Compte : carte « Entraide et liens », 8 compétences au plus, enregistrement des différences, cases parrainage et souvenirs.
// (d) Fiche d'un membre : pastilles « Peut aider pour ».
// Faux Supabase : fixtures/fake-sb.mjs + fake-sb-social2.mjs. Lancer : node tests/parcours-competences.cjs
const { ROOT, check, finish, openPage, log, chromium } = require('./lib/harness.cjs');
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const ME = '11111111-1111-4111-8111-111111111111';
const errs = (p) => (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : '');

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();
  {
    const p = await openPage(browser, { page: 'membre', width: 360, height: 900, scenario: { extra: 'fake-sb-social2.mjs' } });
    await p.waitForSelector('.sk-chip', { timeout: 8000 }).catch(() => {});
    check(await p.locator('.sk-chip').count() === 5, '(a) 4 compétences + « Tout le gang »');
    await p.click('.sk-chip[data-sk-code="nature"]');
    await p.waitForSelector('.sk-result', { timeout: 5000 }).catch(() => {});
    check(await p.locator('.sk-result').count() === 2, '(a) 2 volontaires pour Champignons et nature');
    check(await p.isHidden('#gang'), '(a) grille du gang masquée pendant le filtre');
    check(await p.getAttribute('.sk-chip[data-sk-code="nature"]', 'aria-pressed') === 'true', '(a) pastille choisie : aria-pressed');
    const t = await p.textContent('#sk-results');
    check(/« cèpes et girolles »/.test(t) && /aussi : Cuisine/.test(t), '(a) précision et autres compétences');
    check(/2 volontaires/.test(await p.textContent('#sk-hint')), '(a) nombre de volontaires annoncé');
    const href = await p.getAttribute('.sk-result .sk-help', 'href');
    check(/^messages\.html\?to=/.test(href) && /brouillon=/.test(href) && /coup%20de%20main/.test(href), '(a) lien vers une conversation préremplie');
    check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '(a) 360 px : pas de défilement horizontal');
    await p.click('.sk-chip[data-sk-code=""]');
    check(await p.isVisible('#gang') && await p.isHidden('#sk-results'), '(a) « Tout le gang » rend la grille');
    check(!p.errs.length, '(a) aucune erreur JS' + errs(p));
    await p.ctx.close();
  }
  {
    const draft = 'Salut Alice, tu pourrais me donner un coup de main pour « Cuisine » ? ';
    const p = await openPage(browser, { page: 'messages', scenario: { extra: 'fake-sb-social2.mjs', conversations: [{ id: 'c0000000-0000-4000-8000-000000000001', kind: 'direct', last_message_at: new Date().toISOString() }], convMembers: [{ conversation_id: 'c0000000-0000-4000-8000-000000000001', user_id: ME }, { conversation_id: 'c0000000-0000-4000-8000-000000000001', user_id: U(2) }] } });
    await p.goto(p.url().replace(/messages\.html.*/, `messages.html?to=${U(2)}&brouillon=${encodeURIComponent(draft)}`));
    await p.waitForTimeout(1500);
    const rpcs = (await log(p)).filter((l) => l[0] === 'rpc');
    check(rpcs.some((l) => l[1] === 'hg_open_direct'), '(b) conversation directe ouverte');
    const val = await p.inputValue('#msg-input').catch(() => '');
    check(val === draft, '(b) brouillon placé dans la zone de saisie');
    check(!rpcs.some((l) => l[1] === 'hg_send_message'), '(b) rien n’est envoyé sans la personne');
    await p.ctx.close();
  }
  {
    const p = await openPage(browser, { page: 'compte', width: 360, height: 900, scenario: { extra: 'fake-sb-social2.mjs' } });
    await p.waitForSelector('#entraide [data-sk]', { timeout: 8000 }).catch(() => {});
    check(await p.isVisible('#entraide'), '(c) carte « Entraide et liens »');
    check(await p.isChecked('[data-sk="informatique"]'), '(c) compétence déjà cochée');
    await p.check('[data-sk="cuisine"]');
    await p.fill('[data-sk-note="cuisine"]', 'raclette');
    await p.uncheck('[data-sk="informatique"]');
    await p.click('[data-sk-save]');
    await p.waitForTimeout(600);
    const L = await log(p);
    check(L.some((l) => l[0] === 'insert' && l[1] === 'hg_member_skills' && JSON.stringify(l[2]).includes('"note":"raclette"')), '(c) ajout avec précision');
    check(L.some((l) => l[0] === 'delete' && l[1] === 'hg_member_skills'), '(c) retrait');
    await p.check('#pf-mentor');
    await p.waitForTimeout(400);
    check((await log(p)).some((l) => l[0] === 'update' && l[1] === 'hg_profiles' && l[2]?.mentor_volunteer === true), '(c) « Je veux bien parrainer » enregistré');
    await p.check('#pf-hide-friend');
    await p.waitForTimeout(400);
    check((await log(p)).some((l) => l[0] === 'update' && l[1] === 'hg_profiles' && l[2]?.hide_friendship === true), '(c) « Ne pas afficher nos souvenirs communs » enregistré');
    check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '(c) 360 px : pas de défilement horizontal');
    check(!p.errs.length, '(c) aucune erreur JS' + errs(p));
    await p.ctx.close();
  }
  {
    const p = await openPage(browser, { page: 'compte', scenario: { extra: 'fake-sb-social2.mjs', skills: ['cuisine', 'nature', 'maths'].map((c) => ({ user_id: ME, skill_code: c, note: null })) } });
    await p.waitForSelector('#entraide [data-sk]', { timeout: 8000 }).catch(() => {});
    // Catalogue de 4 : impossible de dépasser 8, on vérifie le compteur
    check(/3 \/ 8/.test(await p.textContent('.sk-count')), '(c) compteur 3 / 8');
    await p.ctx.close();
  }
  {
    const p = await openPage(browser, { page: 'membre', scenario: { extra: 'fake-sb-social2.mjs' } });
    await p.goto(p.url().replace(/membre\.html.*/, `membre.html?id=${U(2)}`));
    await p.waitForSelector('.sk-pill', { timeout: 8000 }).catch(() => {});
    check(await p.locator('#mb-skills .sk-pill').count() === 2, '(d) 2 pastilles « Peut aider pour »');
    check(/cèpes et girolles/.test(await p.textContent('#mb-skills')), '(d) précision affichée');
    check(!p.errs.length, '(d) aucune erreur JS' + errs(p));
    await p.ctx.close();
  }
  await browser.close();
  finish();
})();
