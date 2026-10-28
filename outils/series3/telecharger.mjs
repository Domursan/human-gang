// Télécharge les images des séries Pays du monde, Capitales, Plateforme de streaming.
// Sortie : site/<code>/NNN.webp (500 px, pour le site) et local/<Nom série>/NNN - Nom.png (1000 px max, pour le PC).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const ICI = path.dirname(new URL(import.meta.url).pathname);
const D = JSON.parse(fs.readFileSync(path.join(ICI, 'donnees.json'), 'utf8'));
const NOMS = { pays: 'Pays du monde', capitales: 'Capitales', streaming: 'Plateforme de streaming' };
const UA = { 'User-Agent': 'HumaneGangCartes/1.0 (https://humane-gang.com)' };
const propre = (s) => s.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim();
const rapport = [];
for (const [code, cartes] of Object.entries(D)) {
  fs.mkdirSync(path.join(ICI, 'site', code), { recursive: true });
  fs.mkdirSync(path.join(ICI, 'local', NOMS[code]), { recursive: true });
  for (const c of cartes) {
    const num = String(c.n).padStart(3, '0');
    try {
      let buf = null;
      for (let i = 0; i < 3 && !buf; i++) {
        const r = await fetch(c.img, { headers: UA });
        if (r.ok) buf = Buffer.from(await r.arrayBuffer());
        else if (r.status === 429) await new Promise((ok) => setTimeout(ok, 3000));
        else throw new Error('HTTP ' + r.status);
      }
      if (!buf) throw new Error('trop de tentatives');
      const svg = /\.svg($|\?)/i.test(c.img);
      const src = () => sharp(buf, svg ? { density: 300 } : {}).rotate();
      await src().resize({ width: 500, height: 500, fit: 'inside', withoutEnlargement: !svg }).webp({ quality: 85 })
        .toFile(path.join(ICI, 'site', code, num + '.webp'));
      await src().resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: !svg }).png()
        .toFile(path.join(ICI, 'local', NOMS[code], `${num} - ${propre(c.nom)}.png`));
      rapport.push({ code, n: c.n, ok: true });
    } catch (e) { rapport.push({ code, n: c.n, ok: false, err: String(e.message || e), img: c.img }); }
    await new Promise((ok) => setTimeout(ok, 1500));
  }
}
fs.writeFileSync(path.join(ICI, 'rapport.json'), JSON.stringify(rapport, null, 1));
console.log('ok', rapport.filter((x) => x.ok).length, 'échecs', rapport.filter((x) => !x.ok).length);
