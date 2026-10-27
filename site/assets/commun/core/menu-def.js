// Structure du menu de l'en-tête (barre du haut), partagée par header.js et l'éditeur « Libellés du menu » du panel.
// Chaque titre de menu et chaque entrée a une clé de libellé (menuKey) : « menu:<id> » pour un menu ou un sous-menu,
// l'adresse (href) pour une entrée. Le libellé réglé (hg_settings.site_textes.nav_libelles[clé]) remplace celui d'ici.
// Exporte : MENUS, menuKey, MENU_KEYS, menuEntries.

/**
 * Menus de la barre. page : slug dont l'accès conditionne le lien ; sep : filet de séparation ; sub : sous-menu.
 * « Autres » (auto) reçoit les pages du menu (hg_pages.in_nav) qui ne sont rangées nulle part ailleurs.
 */
export const MENUS = [
  { id: 'cartes', label: 'Le jeu de cartes', items: [
    // cpt : clé de la pastille de compteur (assets/js/core/badges-compteur.js), absente = pas de compteur
    { label: 'Ouverture', href: 'cartes.html#ouverture', page: 'cartes', cpt: 'cartes.ouverture' },
    { label: 'Inventaire', href: 'cartes.html#inventaire', page: 'cartes' },
    { label: 'Boutique', href: 'cartes.html#boutique', page: 'cartes' },
    { label: 'Mes cartes', href: 'cartes.html#collection', page: 'cartes' },
    { label: 'Classement', href: 'cartes.html#classement', page: 'cartes' },
    { label: 'Échanges', href: 'cartes.html#echanges', page: 'cartes', cpt: 'cartes.echanges' },
    { label: 'Arène', href: 'cartes.html#arene', page: 'cartes' },
  ] },
  { id: 'irl', label: 'IRL', items: [
    { label: 'Secret Santa', href: 'secret-santa.html', page: 'secret-santa' },
    { label: 'IRL', href: 'irl.html', page: 'irl' },
    { label: 'Historique', href: 'historique.html', page: 'historique' },
  ] },
  // Jeux : un lien direct vers la page des cartes de jeux (jeux.html), qui range tous les jeux par section.
  { id: 'jeux', label: 'Jeux', href: 'jeux.html', page: 'jeux' },
  { id: 'calendrier', label: 'Calendrier', href: 'calendrier.html', page: 'calendrier' },
  { id: 'autres', label: 'Autres', auto: true },
];

/** Clé de libellé d'un menu, d'un sous-menu ou d'une entrée. */
export const menuKey = (it) => (it.items || it.auto || it.sub ? `menu:${it.id || it.label.toLowerCase()}` : it.href ? it.href : '');

/**
 * Libellés modifiables, dans l'ordre du menu : { key, label (par défaut), depth (0 menu, 1 entrée, 2 sous-entrée), group }.
 * @returns {Array<{key: string, label: string, depth: number, group: string}>}
 */
export function menuEntries() {
  const out = [];
  for (const m of MENUS) {
    out.push({ key: menuKey(m), label: m.label, depth: 0, group: m.id });
    for (const it of m.items || []) {
      if (it.sep) continue;
      out.push({ key: menuKey(it), label: it.label, depth: 1, group: m.id });
      for (const s of it.sub || []) out.push({ key: menuKey(s), label: s.label, depth: 2, group: m.id });
    }
  }
  return out;
}
/** Toutes les clés de libellés du menu. */
export const MENU_KEYS = menuEntries().map((e) => e.key);
