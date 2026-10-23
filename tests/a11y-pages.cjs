// Contrôle d'accessibilité automatique (axe-core) des pages publiques du test de fumée, à 390 et 1280 px.
// Faux Supabase (tests/fixtures/fake-sb.mjs) : aucune donnée réelle, aucun appel à la vraie base.
// Défauts « graves » (les seuls qui peuvent bloquer) : bouton ou lien sans nom, contraste insuffisant,
// champ sans étiquette, image sans texte alternatif, quand axe les classe « serious » ou « critical ».
// Mode (variable A11Y_MODE) :
//   signaler (défaut) : liste tout, sort toujours en succès (période d'observation d'une semaine) ;
//   bloquer           : sort en erreur s'il reste un défaut grave.
// Écrit tests/shots/a11y.json (repris par tests/ci-resume.cjs) et, sous GitHub Actions, un résumé Markdown.
// Dépendance de développement : @axe-core/playwright (version fixe dans package.json).
// Lancer : node tests/a11y-pages.cjs   (A11Y_MODE=bloquer node tests/a11y-pages.cjs)
const fs = require('fs');
const path = require('path');
const { SHOTS, check, finish, openPage, chromium } = require('./lib/harness.cjs');

let AxeBuilder;
try { ({ AxeBuilder } = require('@axe-core/playwright')); } catch {
  console.log('@axe-core/playwright absent : lance « npm install » (dépendance de développement) puis relance ce test.');
  // Sur la CI le paquet doit être là : son absence est une erreur. Sur un poste, on ne bloque pas.
  process.exit(process.env.CI === 'true' ? 1 : 0);
}

const MODE = process.env.A11Y_MODE === 'bloquer' ? 'bloquer' : 'signaler';
const PAGES = ['index', 'accueil', 'cartes', 'evenements', 'rejoindre', 'compte', 'secret-santa', 'irl', 'historique', 'assistance', 'legal', 'messages', 'membre', 'recap'];
const LARGEURS = [390, 1280];
/** Règles axe dont un défaut « serious » ou « critical » est considéré comme grave. */
const GRAVES = new Set(['button-name', 'link-name', 'color-contrast', 'label', 'select-name', 'image-alt', 'input-button-name', 'aria-input-field-name']);
const IMPACTS_GRAVES = new Set(['serious', 'critical']);

(async () => {
  const browser = await chromium.launch();
  const lignes = [];
  let graves = 0, autres = 0, pages = 0;
  for (const pg of PAGES) {
    for (const w of LARGEURS) {
      const p = await openPage(browser, { page: pg, width: w, height: w < 600 ? 844 : 900, reducedMotion: 'reduce' });
      try {
        const r = await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        pages++;
        for (const v of r.violations) {
          const grave = GRAVES.has(v.id) && IMPACTS_GRAVES.has(v.impact);
          if (grave) graves += v.nodes.length; else autres += v.nodes.length;
          lignes.push({ page: pg, largeur: w, regle: v.id, impact: v.impact, grave, n: v.nodes.length, cible: v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' ; ') });
        }
        const g = r.violations.filter((v) => GRAVES.has(v.id) && IMPACTS_GRAVES.has(v.impact));
        const msg = `${pg} ${w} : ${g.length ? g.map((v) => `${v.id} ×${v.nodes.length}`).join(', ') : 'aucun défaut grave'}`;
        if (MODE === 'bloquer') check(!g.length, msg); else console.log((g.length ? 'SIGNALE ' : 'OK      ') + msg);
      } catch (e) {
        check(false, `${pg} ${w} : analyse impossible (${e.message.slice(0, 120)})`);
      }
      await p.ctx.close();
    }
  }
  await browser.close();

  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, 'a11y.json'), JSON.stringify({ mode: MODE, pages, graves, autres, lignes }, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = [`### Accessibilité (axe-core) · mode « ${MODE} »`, '', `${pages} pages · ${graves} élément(s) avec un défaut grave · ${autres} autre(s)`, '',
      '| Page | Largeur | Règle | Impact | Grave | Éléments | Exemples |', '|---|---|---|---|---|---|---|',
      ...lignes.sort((a, b) => (b.grave - a.grave) || a.page.localeCompare(b.page)).slice(0, 80)
        .map((l) => `| ${l.page} | ${l.largeur} | ${l.regle} | ${l.impact} | ${l.grave ? 'oui' : 'non'} | ${l.n} | \`${l.cible.replace(/[|`]/g, ' ').slice(0, 90)}\` |`), ''];
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n');
  }
  console.log(`\nAccessibilité : ${pages} pages, ${graves} défaut(s) grave(s), ${autres} autre(s) (mode ${MODE}).`);
  finish();
})();
