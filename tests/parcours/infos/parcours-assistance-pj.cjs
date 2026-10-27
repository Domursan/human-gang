// Parcours : pièces jointes d'une demande d'assistance (migration 078, fonction hg-support).
// (a) membre connecté, 390 px : zone « Pièces jointes » visible ; ajout d'une image et d'un PDF ; aperçu ;
//     refus d'un vidéo, d'un SVG, d'un HTML et d'un fichier de plus de 5 Mo ; limite de 3 ; retrait avant envoi.
// (b) envoi : les fichiers partent dans le dossier du membre (bucket hg-support-files), puis leurs chemins vont à hg-support.
// (c) visiteur sans compte : aucune zone de pièce jointe.
// (d) « Mes demandes » : les pièces jointes d'une demande s'affichent dans le fil (vignette, icône PDF), liens signés.
// (e) panel admin (Assistance) : le fil de la même demande montre les pièces jointes du membre.
// Faux Supabase : fixtures/fake-sb.mjs (storage et fonctions simulés, journal dans window.__LOG).
// Lancer : node tests/parcours/infos/parcours-assistance-pj.cjs
const zlib = require('zlib');
const { check, finish, openPage, adminSection, hscroll, chromium } = require('../../lib/harness.cjs');

const ME = '11111111-1111-4111-8111-111111111111';          // admin (fixture)
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`; // Alice = U(2)
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

/** CRC-32 (PNG). */
function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) { crc ^= b; for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
  return (crc ^ 0xffffffff) >>> 0;
}
/** Bloc PNG : longueur, type, données, CRC. */
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** Image PNG valide (dégradé, w × h) : sert de fichier joint réel au décodage et à la compression. */
function makePng(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = (x * 255) / w; raw[o + 1] = (y * 255) / h; raw[o + 2] = 128;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PNG = makePng(800, 600);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n');

const SUPPORT = [
  { id: 'sup-1', user_id: U(2), pseudo: 'Alice', subject: 'Bug sur le site', message: 'Le bouton reste gris après l’achat, reçu joint.',
    contact: null, status: 'ouverte', taken_by: ME, taken_at: ago(20), read_at: ago(25), created_at: ago(30), updated_at: ago(20) },
];
const FILES = [
  { id: 'f1', support_id: 'sup-1', path: `${U(2)}/aaaaaaaa-1111-4111-8111-000000000001.webp`, name: 'capture-boutique.png', mime: 'image/webp', size: 310000 },
  { id: 'f2', support_id: 'sup-1', path: `${U(2)}/aaaaaaaa-1111-4111-8111-000000000002.pdf`, name: 'recu-paillettes.pdf', mime: 'application/pdf', size: 412000 },
];
const SCN = { uid: U(2), support: SUPPORT, supportFiles: FILES };

/** Attend qu'une condition soit vraie dans la page (5 s au plus). */
const waitFor = (p, fn, arg) => p.waitForFunction(fn, arg ?? null, { timeout: 5000 }).catch(() => {});
/** Journal du faux client (fonctions, téléversements). */
const logOf = (p, kind) => p.evaluate((k) => (window.__LOG || []).filter((e) => e[0] === k), kind);

(async () => {
  const browser = await chromium.launch();

  /* (a) membre, 390 px : ajout, refus, limite, retrait */
  const p = await openPage(browser, { page: 'assistance', width: 390, height: 844, scenario: { uid: U(2) } });
  check(!(await p.getAttribute('#sp-files-field', 'hidden')), '(a) membre : zone « Pièces jointes » visible');
  await p.setInputFiles('#sp-files-input', [
    { name: 'capture.png', mimeType: 'image/png', buffer: PNG },
    { name: 'recu.pdf', mimeType: 'application/pdf', buffer: PDF },
  ]);
  await waitFor(p, () => document.querySelectorAll('#sp-files-list li').length === 2);
  check(await p.locator('#sp-files-list li').count() === 2, '(a) deux fichiers ajoutés (image et PDF)');
  const meta = await p.locator('#sp-files-list li').first().textContent();
  check(meta.includes('capture.png') && meta.includes('Image ·'), '(a) image : nom et poids affichés');
  check((await p.locator('#sp-files-list li img').count()) === 1, '(a) image : aperçu (vignette)');
  check((await p.locator('#sp-files-list li').nth(1).textContent()).includes('PDF ·'), '(a) PDF : icône et poids, sans vignette image');

  // Refus : vidéo, SVG, HTML, fichier de plus de 5 Mo
  await p.setInputFiles('#sp-files-input', [{ name: 'video-bug.mov', mimeType: 'video/quicktime', buffer: Buffer.from('mov') }]);
  await waitFor(p, () => (document.querySelector('#sp-files-error')?.textContent || '').includes('seulement des images'));
  check((await p.textContent('#sp-files-error')).includes('seulement des images ou des PDF'), '(a) vidéo refusée avec un message clair');
  await p.setInputFiles('#sp-files-input', [{ name: 'dessin.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') }]);
  await waitFor(p, () => (document.querySelector('#sp-files-error')?.textContent || '').includes('dessin.svg'));
  check((await p.textContent('#sp-files-error')).includes('dessin.svg'), '(a) SVG refusé');
  await p.setInputFiles('#sp-files-input', [{ name: 'page.html', mimeType: 'text/html', buffer: Buffer.from('<p>x</p>') }]);
  await waitFor(p, () => (document.querySelector('#sp-files-error')?.textContent || '').includes('page.html'));
  check((await p.textContent('#sp-files-error')).includes('page.html'), '(a) HTML refusé');
  await p.setInputFiles('#sp-files-input', [{ name: 'gros.png', mimeType: 'image/png', buffer: Buffer.alloc(6 * 1024 * 1024) }]);
  await waitFor(p, () => (document.querySelector('#sp-files-error')?.textContent || '').includes('trop lourd'));
  check((await p.textContent('#sp-files-error')).includes('5 Mo maximum'), '(a) fichier de plus de 5 Mo refusé');
  check(await p.locator('#sp-files-list li').count() === 2, '(a) les refus n’ajoutent rien à la liste');

  // Limite de 3 : un troisième ajouté, puis le bouton est désactivé
  await p.setInputFiles('#sp-files-input', [{ name: 'troisieme.png', mimeType: 'image/png', buffer: PNG }]);
  await waitFor(p, () => document.querySelectorAll('#sp-files-list li').length === 3);
  check(await p.locator('#sp-files-list li').count() === 3 && await p.isDisabled('#sp-files-add'), '(a) trois fichiers : ajout désactivé');
  await p.setInputFiles('#sp-files-input', [{ name: 'quatrieme.png', mimeType: 'image/png', buffer: PNG }]);
  await waitFor(p, () => (document.querySelector('#sp-files-error')?.textContent || '').includes('Trois fichiers'));
  check((await p.textContent('#sp-files-error')).includes('Trois fichiers au maximum'), '(a) quatrième refusé (trois au maximum)');

  // Retrait avant envoi : le troisième (troisieme.png) part
  const rm = p.locator('#sp-files-list [data-rm]').nth(2);
  await rm.click();
  check(await p.locator('#sp-files-list li').count() === 2 && !(await p.isDisabled('#sp-files-add')), '(a) retrait d’un fichier avant envoi : deux restent, ajout de nouveau possible');
  check(await p.evaluate(() => document.activeElement?.id) === 'sp-files-add', '(a) après retrait, le focus reste sur « Ajouter »');
  check(await hscroll(p) === 0, '(a) 390 px : pas de défilement horizontal avec les fichiers');
  check(!p.errs.length, '(a) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));

  /* (b) envoi : dépôt dans le dossier du membre, puis demande avec les chemins */
  await p.selectOption('#sp-subject', 'Bug sur le site');
  await p.fill('#sp-message', 'Le bouton « Ouvrir 5 boosters » reste gris après l’achat, mes Paillettes ont bien été retirées.');
  await p.click('#support-form [type="submit"]');
  await waitFor(p, () => !document.querySelector('#support-done')?.hidden);
  const ups = await logOf(p, 'upload');
  check(ups.length === 2 && ups.every((u) => String(u[1]).startsWith(U(2) + '/')), '(b) deux fichiers déposés dans le dossier du membre');
  check(ups.every((u) => /^[0-9a-f-]{36}\.(webp|pdf)$/.test(String(u[1]).split('/')[1])), '(b) noms de fichiers aléatoires (uuid + extension)');
  const fn = (await logOf(p, 'fn')).find((e) => e[1] === 'hg-support');
  check(fn && fn[2].files.length === 2 && fn[2].files[0].name === 'capture.png' && fn[2].files[1].name === 'recu.pdf', '(b) hg-support reçoit les deux pièces (chemin et nom)');
  check(await p.isVisible('#support-done'), '(b) confirmation affichée après l’envoi');
  check(await hscroll(p) === 0, '(b) 390 px : pas de défilement horizontal après l’envoi');
  check(!p.errs.length, '(b) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));

  /* (c) visiteur sans compte : pas de pièce jointe */
  const v = await openPage(browser, { page: 'assistance', width: 1280, height: 900, scenario: { guest: true } });
  check(await v.getAttribute('#sp-files-field', 'hidden') !== null, '(c) visiteur : zone « Pièces jointes » absente');
  check((await v.locator('#sp-files-add').count()) === 1 && !(await v.isVisible('#sp-files-field')), '(c) visiteur : aucun bouton d’ajout visible');

  /* (d) Mes demandes : les pièces jointes de la demande dans le fil */
  const m = await openPage(browser, { page: 'assistance', width: 390, height: 844, scenario: SCN });
  await waitFor(m, () => !document.querySelector('#my-support')?.hidden);
  await m.click('#my-support-list .my-support-row');
  await waitFor(m, () => document.querySelectorAll('#my-support-thread .sf-item').length === 2);
  check(await m.locator('#my-support-thread .sf-item').count() === 2, '(d) fil : les deux pièces jointes de la demande');
  check(await m.locator('#my-support-thread .sf-item.is-pdf').count() === 1 && await m.locator('#my-support-thread .sf-item.is-img').count() === 1, '(d) image en vignette, PDF avec icône');
  await waitFor(m, () => !!document.querySelector('#my-support-thread .sf-item img')?.getAttribute('src'));
  check((await m.getAttribute('#my-support-thread .sf-item.is-img img', 'src')) || '', '(d) vignette : lien signé chargé');
  check((await m.getAttribute('#my-support-thread .sf-item.is-pdf', 'href')) || '', '(d) PDF : lien d’ouverture signé');
  check(await hscroll(m) === 0, '(d) 390 px : pas de défilement horizontal avec les pièces jointes');
  check(!m.errs.length, '(d) aucune erreur JS' + (m.errs.length ? ' (' + m.errs.join(' | ') + ')' : ''));

  /* (e) panel admin : le fil montre les pièces jointes du membre */
  const a = await openPage(browser, { page: 'admin', width: 1440, height: 900, scenario: { ...SCN, uid: ME, realtime: true, staff: ['support'] } });
  await adminSection(a, 'pilotage/assistance');
  await a.evaluate(() => { location.hash = '#poste/assistance/sup-1'; });
  await waitFor(a, () => document.querySelectorAll('#support-root .ui-msg .sf-item').length === 2);
  check(await a.locator('#support-root .sf-item').count() === 2, '(e) admin : pièces jointes dans le fil de la demande');
  check((await a.locator('#support-root .sf-item .sf-name').allTextContents()).join(',').includes('capture-boutique.png'), '(e) admin : nom des fichiers affiché');
  check(!a.errs.length, '(e) aucune erreur JS' + (a.errs.length ? ' (' + a.errs.join(' | ') + ')' : ''));

  await browser.close();
  finish();
})().catch((e) => { console.error(e); process.exitCode = 1; });
