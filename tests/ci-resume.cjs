/**
 * Résumé global de la CI : rassemble les bilans des 4 morceaux de tests (resultats-K.json écrits par run-all.cjs)
 * et, s'ils existent, ceux de l'accessibilité (a11y.json) et du budget de performance (perf.json).
 * Écrit un résumé lisible dans GITHUB_STEP_SUMMARY (« 79 fichiers · 77 OK · 2 réussis au second essai · durée 11 min »)
 * et la liste des fichiers en échec dans GITHUB_OUTPUT (sortie « echecs », reprise par l'alerte Discord).
 * Aucun appel réseau, aucune donnée réelle : les bilans ne contiennent que des noms de fichiers de test et des durées.
 * Lancer : node tests/ci-resume.cjs <dossier des bilans>   (par défaut tests/shots)
 */
const fs = require('fs');
const path = require('path');

const base = path.resolve(process.argv[2] || path.join(__dirname, 'shots'));

/** Tous les fichiers JSON d'un dossier, sous-dossiers compris (un dossier par artefact téléchargé). */
function jsons(d) {
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? jsons(p) : (e.name.endsWith('.json') ? [p] : []);
  });
}
/** Lit un JSON, ou null s'il est illisible. */
const lire = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
/** Durée lisible : « 42 s » ou « 11 min ». */
const duree = (ms) => { const s = Math.round(ms / 1000); return s < 60 ? `${s} s` : `${Math.round(s / 60)} min`; };
/** Nom de fichier de test sûr pour un message (lettres, chiffres, points, tirets). */
const sur = (f) => String(f).replace(/[^A-Za-z0-9._-]/g, '');

const fichiers = jsons(base);
const morceaux = fichiers.filter((p) => /resultats(-\d+)?\.json$/.test(p)).map(lire).filter(Boolean);
const a11y = fichiers.filter((p) => p.endsWith('a11y.json')).map(lire).filter(Boolean)[0] || null;
const perf = fichiers.filter((p) => p.endsWith('perf.json')).map(lire).filter(Boolean)[0] || null;

const tous = morceaux.flatMap((m) => (m.resultats || []).map((r) => ({ ...r, shard: m.shard })));
const echecs = tous.filter((r) => !r.ok);
const relances = tous.filter((r) => r.ok && r.relance);
const dureeMax = Math.max(0, ...morceaux.map((m) => m.ms || 0));
const prevus = morceaux.reduce((s, m) => s + (m.prevus || 0), 0);

const md = ['## Résumé de la CI', ''];
if (!morceaux.length) md.push('Aucun bilan de tests reçu (les morceaux n’ont pas démarré ou ont été annulés).', '');
else {
  md.push(`**${tous.length} fichiers** · ${tous.length - echecs.length - relances.length} OK · ${relances.length} réussis au second essai · ${echecs.length} en échec · durée ${duree(dureeMax)} (${morceaux.length} morceaux en parallèle)`, '');
  if (tous.length < prevus) md.push(`⚠ ${prevus - tous.length} fichier(s) prévus n’ont pas été lancés.`, '');
  if (echecs.length) {
    md.push('### En échec', '', ...echecs.map((r) => `- \`${sur(r.f)}\` · morceau ${r.shard || '?'}${r.delai ? ' · limite de temps dépassée' : ''} · second essai : échec aussi`), '',
      'Les captures sont dans les artefacts « captures-morceau-K » de cette exécution.', '');
  }
  if (relances.length) md.push('### Réussis au second essai (à stabiliser)', '', relances.map((r) => `\`${sur(r.f)}\``).join(' · '), '');
}
if (a11y) {
  md.push(`### Accessibilité (axe-core, mode « ${a11y.mode === 'bloquer' ? 'bloquant' : 'signaler'} »)`, '',
    `${a11y.pages || 0} pages contrôlées · ${a11y.graves || 0} défaut(s) grave(s) · ${a11y.autres || 0} autre(s)`, '');
}
if (perf) {
  const hors = (perf.pages || []).filter((p) => !p.ok);
  md.push('### Budget de performance mobile', '', `${(perf.pages || []).length} pages mesurées · ${hors.length} hors budget (+10 % toléré)`, '');
}
const texte = md.join('\n');
console.log(texte);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, texte + '\n');
if (process.env.GITHUB_OUTPUT) {
  const liste = echecs.map((r) => sur(r.f).replace(/\.c?js$|\.mjs$/, '')).slice(0, 10).join(', ');
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `echecs=${liste}\n`);
}
