// Parcours : Communication › Bot Discord — mentions des annonces et pièces jointes du message manuel.
// Les réglages sont en sous-onglets : chaque étape ouvre l'onglet qui contient le champ (Connexion, Mentions, Messages privés).
// (a) Réglages : ID du rôle (format refusé, rôle demandé sans ID refusé), mention par type d'annonce enregistrée
//     dans hg_settings.bot (mention_role_id, mentions) ; sans salon, le bloc des mentions est grisé.
// (b) Message manuel : mention @everyone (confirmation avant envoi), 3 pièces jointes puis retrait d'une, aperçu
//     (mention en tête, image dans l'embed, fichiers en liste), envoi : le faux client reçoit hg-notify avec
//     mention = 'everyone' et deux chemins manuel/<date>/<uuid>-<nom> ; les fichiers sont téléversés avant l'appel.
// (c) Refus : fichier de plus de 10 Mo et type non autorisé, sans téléversement ni envoi.
// Faux Supabase (fixtures/fake-sb.mjs) : hg-notify et hg-bot-media sont simulés, aucune requête réelle.
// Lancer : node tests/parcours-admin-bot-mentions.cjs   (captures 1440 px si SHOTS_DIR est défini)
const path = require('path');
const fs = require('fs');
const { check, finish, openPage, adminSection, hscroll, chromium, sleep } = require('./lib/harness.cjs');

/* ---------- Aides de test ---------- */
const SHOTS_DIR = process.env.SHOTS_DIR || '';
/** Enregistre une capture d'écran nommée name, si un dossier de captures est défini (SHOTS_DIR). */
const shot = async (p, name) => { if (SHOTS_DIR) { fs.mkdirSync(SHOTS_DIR, { recursive: true }); await p.screenshot({ path: path.join(SHOTS_DIR, name) }); } };
/** Identifiant de test du membre n (U(2) = Alice, comme dans le faux client). */
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`; // Alice = U(2) (fixture)
const CHANNEL = '112233445566778899';
const ROLE = '445566778899001122';
const MAX_BYTES = 10 * 1024 * 1024;

// Ouvre une sous-section du panel et attend son formulaire.
/** Ouvre une route du panel admin, puis attend que le sélecteur sel soit affiché. */
async function goto(p, route, sel) {
  await adminSection(p, route);
  await p.waitForFunction((s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; }, sel, { timeout: 8000 }).catch(() => {});
  await sleep(200);
}
/** Ouvre un sous-onglet du bot en cliquant dessus, puis attend son panneau. */
async function tab(p, id) {
  await p.click(`#bot-tab-${id}`);
  await p.waitForSelector(`#bot-p-${id}`, { state: 'visible', timeout: 5000 });
  await sleep(120);
}
/** Enregistre les réglages avec le bouton du panneau affiché. */
async function save(p) { await p.click('#bot-form button[type="submit"]:visible'); await sleep(500); }
/** Réglages du bot lus dans la base simulée (hg_settings, clé « bot »). */
const botSetting = (p) => p.evaluate(() => (window.__DB.hg_settings.find((r) => r.key === 'bot') || {}).value || {});
/** Appels de hg-notify faits depuis le panel admin (journal du faux client). */
const adminCalls = (p) => p.evaluate(() => window.__LOG.filter((e) => e[0] === 'fn' && e[1] === 'hg-notify' && e[2]?.event === 'admin_dm').map((e) => e[2]));
/** Chemins des pièces jointes enregistrées dans le faux stockage hg-bot-media. */
const mediaPaths = (p) => p.evaluate(() => Object.keys(window.__MEDIA || {}));
/** Nombre de pièces jointes affichées dans la liste du message manuel. */
const fileList = (p) => p.locator('#bm-file-list .bm-file').count();
/** Fichier factice dont la taille dépasse la limite de 10 Mo d'un octet. */
const bigBuffer = () => Buffer.alloc(MAX_BYTES + 1, 0);
// PNG valide 160 × 100 (dégradé RGB), généré sans dépendance : l'aperçu doit afficher une vraie image.
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
/** Somme de contrôle CRC-32 d'un tampon, nécessaire pour fabriquer un PNG valide. */
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
/** Bloc PNG (type, données, CRC) : brique de la fabrication d'image. */
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
/** Fabrique une image PNG factice de w × h pixels, sans fichier externe. */
function png(w = 160, h = 100) {
  const zlib = require('zlib');
  const row = w * 3 + 1, raw = Buffer.alloc(row * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * row + 1 + x * 3; raw[o] = Math.floor(x * 255 / w); raw[o + 1] = Math.floor(y * 255 / h); raw[o + 2] = 0x9e; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- Scénario ---------- */
(async () => {
  const browser = await chromium.launch();

  /* (a) Réglages : rôle et mentions */
  {
    const p = await openPage(browser, { page: 'admin', width: 1440, height: 900 });
    // Comptes joignables : chacun a un ID Discord et accepte les MP du bot (sans cela, rien à sélectionner)
    await p.evaluate(([ids]) => { window.__DB.hg_profiles.forEach((pr, i) => { pr.discord_id = ids[i] || null; pr.bot_optin = true; }); },
      [['100000000000000001', '100000000000000002', '100000000000000003', '100000000000000004', '100000000000000005', '100000000000000006']]);
    await goto(p, 'pilotage/bot', '#bot-tablist');

    await tab(p, 'mentions');
    check(await p.isDisabled('#bot-mention-draw'), '(a) sans salon : les mentions sont grisées');
    check(await p.isVisible('#bot-mentions-off'), '(a) sans salon : le texte « renseigne le salon » est visible');
    await tab(p, 'connexion');
    await p.fill('#bot-channel', CHANNEL);
    await tab(p, 'mentions');
    check(!(await p.isDisabled('#bot-mention-draw')), '(a) avec salon : les mentions sont actives');
    check(await p.inputValue('#bot-mention-draw') === 'none', '(a) mention par défaut : aucune');

    await tab(p, 'connexion');
    await p.fill('#bot-role', 'abc');
    await save(p);
    check(await p.locator('text=L\'ID du rôle doit être un nombre').count() > 0, '(a) ID de rôle mal formé : refusé');
    check(!(await botSetting(p)).mention_role_id, '(a) ID mal formé : rien enregistré');

    await p.fill('#bot-role', '');
    await tab(p, 'mentions');
    await p.selectOption('#bot-mention-draw', 'role');
    await save(p);
    check(await p.locator('text=Pour mentionner un rôle, renseigne son ID').count() > 0, '(a) rôle demandé sans ID : refusé');

    await tab(p, 'connexion');
    await p.fill('#bot-role', ROLE);
    await tab(p, 'mentions');
    await p.selectOption('#bot-mention-dyn', 'everyone');
    await save(p);
    const saved = await botSetting(p);
    check(saved.mention_role_id === ROLE, '(a) enregistré : mention_role_id');
    check(saved.mentions?.draw === 'role' && saved.mentions?.dyn === 'everyone', '(a) enregistré : mentions par type (role, everyone)');
    check(saved.mentions?.irl === 'none' && saved.mentions?.birthday === 'none', '(a) enregistré : les autres types restent « aucune »');
    check(saved.announce_channel_id === CHANNEL, '(a) enregistré : salon d\'annonces');
    check(await hscroll(p) === 0, '(a) 1440 px : pas de défilement horizontal');
    await p.locator('#bot-mentions').scrollIntoViewIfNeeded();
    await shot(p, 'reglages-mentions-1440.png');
    check(!p.errs.length, '(a) aucune erreur console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (b) Message manuel : @everyone, pièces jointes, aperçu, envoi */
  {
    const p = await openPage(browser, { page: 'admin', width: 1440, height: 900 });
    await p.evaluate(([ids]) => { window.__DB.hg_profiles.forEach((pr, i) => { pr.discord_id = ids[i] || null; pr.bot_optin = true; }); },
      [['100000000000000001', '100000000000000002', '100000000000000003', '100000000000000004', '100000000000000005', '100000000000000006']]);
    // Réglages déjà enregistrés (rôle configuré) : la mention « Le rôle » doit être proposée
    await p.evaluate((id) => { window.__DB.hg_settings.unshift({ key: 'bot', value: { announce_channel_id: '112233445566778899', mention_role_id: id, mentions: {}, notify: {} } }); }, ROLE);
    await goto(p, 'pilotage/bot', '#bot-tablist');
    await tab(p, 'mp');
    await p.waitForSelector(`#bm-list input[value="${U(2)}"]`, { timeout: 8000 });

    check(await p.isDisabled('#bm-mention'), '(b) sans publication dans le salon : mention grisée');
    await p.click(`#bm-list input[value="${U(2)}"]`, { force: true });
    await p.locator('#bm-channel').check({ force: true });
    check(!(await p.isDisabled('#bm-mention')), '(b) publication dans le salon : mention active');
    check(await p.locator('#bm-mention option[value="role"]').isEnabled(), '(b) rôle configuré : « Le rôle » proposé');
    await p.selectOption('#bm-mention', 'everyone');
    await p.fill('#bm-title', 'Info importante');
    await p.fill('#bm-text', 'Salut {pseudo}, la sortie est confirmée !');

    await p.setInputFiles('#bm-file-input', [
      { name: 'affiche.png', mimeType: 'image/png', buffer: png() },
      { name: 'son d\'ambiance.mp3', mimeType: 'audio/mpeg', buffer: Buffer.alloc(2048, 1) },
      { name: 'programme.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%test\n') },
    ]);
    check(await fileList(p) === 3, '(b) trois pièces jointes ajoutées à la liste');
    await p.click('#bm-file-list .bm-file:has-text("programme.pdf") button');
    check(await fileList(p) === 2, '(b) retrait d\'une pièce jointe');
    check(await p.locator('#bm-preview .dc-mention').count() === 0, '(b) aperçu MP : la mention n\'est pas montrée (elle ne vaut que pour le salon)');
    check((await p.textContent('#bm-preview-for')).includes('@everyone'), '(b) aperçu MP : note « dans le salon : @everyone »');
    await p.click(`#bm-list input[value="${U(2)}"]`, { force: true }); // aperçu du salon seul
    check(await p.locator('#bm-preview .dc-mention').innerText() === '@everyone', '(b) aperçu salon : mention @everyone en tête');
    await p.click(`#bm-list input[value="${U(2)}"]`, { force: true }); // retour : destinataire coché
    check(await p.locator('#bm-preview .dc-img').count() === 1, '(b) aperçu : l\'image est affichée dans l\'embed');
    await p.waitForFunction(() => { const i = document.querySelector('#bm-preview .dc-img'); return !!i && i.complete && i.naturalWidth > 0; }, null, { timeout: 4000 }).catch(() => {});
    check(await p.locator('#bm-preview .dc-img').evaluate((img) => img.complete && img.naturalWidth > 0), '(b) aperçu : l\'image se charge');
    check(await p.locator('#bm-preview .dc-file-name').count() === 1, '(b) aperçu : le son est listé comme fichier joint');
    check(await hscroll(p) === 0, '(b) 1440 px : pas de défilement horizontal');
    await p.locator('#bm-file-list').evaluate((el) => el.scrollIntoView({ block: 'center' })); // pièces jointes et aperçu visibles
    await sleep(150);
    await shot(p, 'envoi-manuel-pj-1440.png');

    await p.click('#bm-send');
    await p.waitForSelector('dialog[open] button[value="ok"]', { timeout: 5000 });
    check((await p.textContent('#bm-dlg-p')).includes('@everyone'), '(b) confirmation : avertit que tout le serveur sera notifié');
    await p.click('dialog[open] button[value="ok"]');
    await p.waitForSelector('#bm-result .bm-result-box', { timeout: 8000 });

    const calls = await adminCalls(p);
    check(calls.length === 1, '(b) hg-notify (admin_dm) appelé une fois');
    const c = calls[0] || {};
    check(c.mention === 'everyone', '(b) appel : mention = everyone');
    check(c.channel === true && Array.isArray(c.user_ids) && c.user_ids.includes(U(2)), '(b) appel : salon + destinataire');
    check(Array.isArray(c.attachments) && c.attachments.length === 2, '(b) appel : deux chemins de pièces jointes');
    const re = /^manuel\/\d{4}-\d{2}-\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/;
    check((c.attachments || []).every((x) => re.test(x)), '(b) chemins sous manuel/<date>/<uuid>-<nom>');
    const stored = await mediaPaths(p);
    check((c.attachments || []).every((x) => stored.includes(x)), '(b) les fichiers sont dans hg-bot-media avant l\'appel');
    const upIdx = await p.evaluate(() => window.__LOG.map((e, i) => (e[0] === 'upload' ? i : -1)).filter((i) => i >= 0));
    const fnIdx = await p.evaluate(() => window.__LOG.findIndex((e) => e[0] === 'fn' && e[1] === 'hg-notify'));
    check(upIdx.length === 2 && upIdx.every((i) => i < fnIdx), '(b) téléversements avant l\'envoi');
    check(await fileList(p) === 0, '(b) liste vidée après envoi');
    check(!(await p.locator('#bm-result').innerText()).includes('Échec'), '(b) résultat sans échec');
    check(!p.errs.length, '(b) aucune erreur console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));

    /* (c) Refus : trop gros, type interdit (rien n'est téléversé ni envoyé) */
    const before = { up: (await p.evaluate(() => window.__LOG.filter((e) => e[0] === 'upload').length)), calls: (await adminCalls(p)).length };
    await p.setInputFiles('#bm-file-input', [{ name: 'gros.mp4', mimeType: 'video/mp4', buffer: bigBuffer() }]);
    await sleep(200);
    check(await p.isVisible('#bm-file-err'), '(c) fichier > 10 Mo : message d\'erreur');
    check((await p.textContent('#bm-file-err')).includes('10 Mo'), '(c) fichier > 10 Mo : refus expliqué (10 Mo maximum)');
    check(await fileList(p) === 0, '(c) fichier > 10 Mo : pas ajouté à la liste');
    await p.setInputFiles('#bm-file-input', [{ name: 'virus.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') }]);
    await sleep(200);
    check((await p.textContent('#bm-file-err')).includes('type de fichier non autorisé'), '(c) type interdit : refus expliqué');
    check(await fileList(p) === 0, '(c) type interdit : pas ajouté à la liste');
    check((await p.evaluate(() => window.__LOG.filter((e) => e[0] === 'upload').length)) === before.up
      && (await adminCalls(p)).length === before.calls, '(c) refus : aucun téléversement ni appel');
    check(!p.errs.length, '(c) aucune erreur console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (d) Mobile 390 px : pas de défilement horizontal sur les réglages et le message manuel */
  {
    const p = await openPage(browser, { page: 'admin', width: 390, height: 844 });
    await goto(p, 'pilotage/bot', '#bot-tablist');
    await tab(p, 'mp');
    check(await hscroll(p) === 0, '(d) 390 px : pas de défilement horizontal (message manuel)');
    check(!p.errs.length, '(d) mobile : aucune erreur console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  await browser.close();
  finish();
})();
