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
    { label: 'Ouverture', href: 'cartes.html#ouverture', page: 'cartes' },
    { label: 'Inventaire', href: 'cartes.html#inventaire', page: 'cartes' },
    { label: 'Boutique', href: 'cartes.html#boutique', page: 'cartes' },
    { label: 'Mes cartes', href: 'cartes.html#collection', page: 'cartes' },
    { label: 'Classement', href: 'cartes.html#classement', page: 'cartes' },
    { label: 'Échanges', href: 'cartes.html#echanges', page: 'cartes' },
    { label: 'Arène', href: 'cartes.html#arene', page: 'cartes' },
  ] },
  { id: 'irl', label: 'IRL', items: [
    { label: 'Secret Santa', href: 'secret-santa.html', page: 'secret-santa' },
    { label: 'IRL', href: 'irl.html', page: 'irl' },
    { label: 'Historique', href: 'historique.html', page: 'historique' },
  ] },
  { id: 'jeux', label: 'Jeux', items: [
    { label: 'Les missions du jour', href: 'jeux.html#aujourdhui', page: 'jeux' },
    { sep: true },
    { label: 'GeoGuessr', href: 'jeux.html#geo', page: 'jeux' },
    { label: 'Qui a dit ça ?', href: 'jeux.html#citations', page: 'jeux' },
    { label: 'Question du jour', href: 'jeux.html#jour', page: 'jeux' },
    { label: 'Sutom HG', href: 'jeux.html#sutom', page: 'jeux' },
    { label: 'Framed', href: 'jeux.html#framed', page: 'jeux' },
    { label: 'Heardle', href: 'jeux.html#heardle', page: 'jeux' },
    { label: 'Arcade', page: 'jeux', sub: [
      { label: 'Paillettes', href: 'jeux.html#arcade-paillettes', page: 'jeux' },
      { label: 'Raclette', href: 'jeux.html#arcade-raclette', page: 'jeux' },
      { label: 'Domu-mobile', href: 'jeux.html#arcade-domu', page: 'jeux' },
    ] },
    { sep: true },
    { label: 'Loup-Garou', href: 'loup-garou.html', page: 'loup-garou', strict: true },
    { label: 'Uno', href: 'uno.html', page: 'uno', strict: true },
  ] },
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
