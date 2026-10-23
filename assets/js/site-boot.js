/* Module chargé par toutes les pages, avant le module de la page.
   - Repli des images en erreur : balise <img data-on-error="remove|hide|text|initials">
     (remplace les gestionnaires onerror="" inline, interdits par la CSP).
   - Boutons « Réessayer » : <button data-action="reload"> (remplace onclick="" inline). */
/*
 * Rôle : petits comportements communs à toutes les pages, sans rapport avec une fonctionnalité précise :
 * repli des images cassées, bouton « Réessayer », feuilles de style « print » basculées sur « all »,
 * et enregistrement du service worker (mode hors ligne). Signale aussi l'ouverture depuis l'app installée
 * aux quêtes de la semaine (quest-track.js, importé dynamiquement). Lance enfin les secrets cachés
 * (eggs/core.js) une fois la page chargée, sans la ralentir.
 * Page : toutes les pages (chargé avant le module de chaque page).
 * Dépendances : aucune au démarrage (quest-track.js seulement si l'app est installée ; eggs/core.js après le chargement). Le fichier sw.js (racine du site) est enregistré ici.
 * Exporte : rien (effets de bord seulement).
 */

/* ---------- Images en erreur ---------- */

/**
 * Repli des images dont le chargement échoue : selon data-on-error, l'image est retirée, cachée,
 * remplacée par un texte ou par des initiales. Écouteur en phase de capture, car l'événement « error » ne remonte pas.
 */
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.onError) return;
  const mode = img.dataset.onError;
  if (mode === 'remove') img.remove();
  else if (mode === 'hide') img.style.visibility = 'hidden';
  else if (mode === 'text') img.replaceWith(document.createTextNode(img.dataset.fallback || ''));
  else if (mode === 'initials') {
    const s = document.createElement('span');
    s.className = img.dataset.fallbackClass || '';
    s.textContent = img.dataset.fallback || '';
    img.replaceWith(s);
  }
}, true);

/* ---------- Journal des erreurs du navigateur (A9) ---------- */
// Écouteurs posés tout de suite ; le module d'envoi (error-report.js) n'est chargé qu'à la première erreur.
/** Transmet une erreur au module d'envoi (import à la demande, sans jamais lever). */
const remonte = (e) => { import('./error-report.js').then((m) => m.reportError(e)).catch(() => {}); };
addEventListener('error', (e) => {
  if (!(e instanceof ErrorEvent)) return; // erreurs de chargement (images, scripts) : pas des erreurs JavaScript
  remonte({ message: e.message || String(e.error || ''), file: e.filename, line: e.lineno, col: e.colno });
});
addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  const stack = String(r?.stack || '');
  const at = stack.match(/(https?:\/\/[^\s)]+?):(\d+):(\d+)/);
  remonte({ message: `Unhandled rejection: ${r?.message || r || ''}`, file: at?.[1] || '', line: at ? Number(at[2]) : null, col: at ? Number(at[3]) : null });
});

/* ---------- Bouton « Réessayer » ---------- */

// Délégation : un clic sur n'importe quel [data-action="reload"] recharge la page
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="reload"]')) location.reload();
});

/* ---------- Feuilles de style ---------- */

/* Feuilles chargées en « print » puis basculées sur « all » (remplace onload="" inline). */
document.querySelectorAll('link[data-media-all]').forEach((l) => {
  /** Passe la feuille en « all » : elle s'applique à l'écran. */
  const on = () => { l.media = 'all'; };
  if (l.sheet) on(); else l.addEventListener('load', on, { once: true });
});

/* ---------- App installée (quête « app installée ») ---------- */

/** Vrai si le site tourne comme app installée (fenêtre autonome), et non dans un onglet du navigateur. */
const estAppInstallee = () => {
  try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch { return false; }
};
/** Signale l'action « app installée » aux quêtes. Import dynamique : rien ne se charge dans un onglet ordinaire. */
const signaleApp = () => { import('./quest-track.js').then((m) => m.questTrack('app_installee', 'app')).catch(() => {}); };
if (estAppInstallee()) signaleApp();
addEventListener('appinstalled', signaleApp);

/* ---------- Mode hors ligne (service worker) ---------- */

/* Mode hors ligne : enregistrement du service worker (sw.js, à la racine du site). */
if (window.isSecureContext && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  // Nouvelle version du site installée pendant la visite : on recharge une fois pour ne pas mélanger
  // l'ancienne page et les nouveaux fichiers.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
}

/* ---------- Secrets : les sept lettres cachées (eggs/lettres.js, import dynamique) ---------- */
import('./eggs/lettres.js').catch(() => {});
/* ---------- Secrets cachés (easter eggs) : chargés après la page, sans la ralentir ---------- */

/** Charge et lance le module des secrets (eggs/core.js). Import dynamique : rien ne se charge avant la fin du démarrage. */
const lanceSecrets = () => { import('./eggs/core.js').then((m) => m.initEggs()).catch(() => {}); };
/** Planifie le lancement quand le navigateur est au repos (ou après un court délai si l'API manque). */
const auRepos = () => ('requestIdleCallback' in window ? requestIdleCallback(lanceSecrets, { timeout: 2000 }) : setTimeout(lanceSecrets, 800));
if (document.readyState === 'complete') auRepos(); else addEventListener('load', auRepos, { once: true });
