// Test de la logique pure de la fonction edge hg-archive (A8) : découpage en parties, noms de fichiers, index.html,
// LISEZ-MOI. Lancer : node tests/unitaires/hg-archive-lib.mjs (Node 22.18+, types TypeScript retirés à la volée).
import { partition, photoName, momentImageName, indexHtml, readme, slug } from '../../supabase/functions/hg-archive/lib.ts';

let fails = 0;
const check = (c, m) => { console.log((c ? 'OK     ' : 'ECHEC ') + m); if (!c) fails++; };
const MO = 1024 * 1024;
const s = (id, n, title = `Sortie ${id}`) => ({ id: String(id), title, starts_at: `2026-0${id}-14T18:00:00Z`, location: 'Lyon', participants: 4,
  photos: Array.from({ length: n }, (_, i) => ({ id: `${id}-${i}`, path: `u/${id}-${i}.jpg` })) });
const size = () => 10 * MO;

check(JSON.stringify(partition([], size, 300 * MO)) === '[[]]', 'année vide : une seule partie');
check(JSON.stringify(partition([s(1, 2), s(2, 3)], size, 300 * MO)) === '[["1","2"]]', 'deux sorties légères : une partie');
const p = partition([s(1, 20), s(2, 15), s(3, 5)], size, 300 * MO);
check(JSON.stringify(p) === '[["1"],["2","3"]]', `sorties entières par partie (${JSON.stringify(p)})`);
check(JSON.stringify(partition([s(1, 40)], size, 300 * MO)) === '[["1"]]', 'sortie plus lourde que le plafond : sa propre partie');
check(JSON.stringify(partition([s(1, 10)], size, 300 * MO, 250 * MO)) === '[[],["1"]]', 'images des moments comptées dans la partie 1');
check(photoName(s(1, 1, 'RDV de Lyon !'), 0, { path: 'abc/IMG 001.JPG' }) === 'sorties/2026-01-14-rdv-de-lyon/001-img-001.jpg', 'nom de photo sûr');
check(momentImageName({ title: 'Nouvel an chez Litver', happened_on: '2026-01-01', image_path: 'x/y.webp' }) === 'moments/2026-01-01-nouvel-an-chez-litver.webp', 'nom d’image de moment');
check(slug('Week-end chez Wae') === 'week-end-chez-wae', 'slug');
const a = { year: 2026, parts: ['moments', 'sorties', 'secret_santa'], generated_at: '2026-10-23T10:00:00Z',
  moments: [{ id: 'm', title: '<script>alert(1)</script>', happened_on: '2026-02-02', author: 'Litver' }],
  sorties: [s(1, 1), s(2, 1)], secret_santa: { year: 2026, status: 'termine', participants: 2, pairs: [{ giver: 'Wae', receiver: 'Litver' }] } };
const html = indexHtml(a, new Map([['1', 1], ['2', 2]]), 2);
check(!html.includes('<script>') && html.includes('&lt;script&gt;'), 'index.html : texte échappé');
check(html.includes('Photos dans la partie 2') && html.includes('sorties/2026-01-14-sortie-1/001-1-0.jpg'), 'index.html : photos de la partie 1 en local, renvoi vers la partie 2');
check(html.includes('Wae → Litver') && !/https?:\/\//.test(html), 'index.html : paires révélées, aucune ressource externe');
check(!html.includes('Cartes créées'), 'index.html : seulement les parties choisies');
check(readme(2026, 2, 3).includes('partie 2 sur 3') && readme(2026, 1, 1).includes('garde-le privé'), 'LISEZ-MOI');
console.log(`\n${fails ? fails + ' ECHEC(S)' : 'tout est OK'}`);
process.exitCode = fails ? 1 : 0;
