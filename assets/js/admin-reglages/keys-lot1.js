// Réglages du lot 1 : identité, textes, pages légales, menu, pied de page, intro et bandeau cookies.
// Stockés dans hg_settings sous site_identite et site_textes (écarts aux valeurs par défaut uniquement).
// Les valeurs par défaut vivent dans core/site-defaults.js, lues par le site et par ce formulaire.
// Les deux clés sont saisies dans le formulaire « Identité et textes » (formulaire: true) : elles n'apparaissent pas dans la liste.

export const KEYS_LOT1 = {
  site_identite: { label: 'Identité du site', help: 'Nom, initiales, logo, éditeur, contact, intro et bandeau cookies. Se règle dans le formulaire ci-dessus.', formulaire: true },
  site_textes: { label: 'Textes et menu du site', help: 'Textes des pages, libellés du menu et du pied de page, paragraphes ajoutés aux pages légales. Se règle dans le formulaire ci-dessus.', formulaire: true },
};

/**
 * Groupes du formulaire. k = « clé_hg_settings.champ ». kind : text, area, url, email, bool, nav, footer.
 * vide : la valeur peut rester vide. max : longueur maximale. aide : texte court sous le champ.
 */
export const GROUPES_LOT1 = [
  { id: 'identite', titre: 'Identité', aide: 'Le nom et le logo du site, en haut de chaque page et dans le titre des pages.', champs: [
    { k: 'site_identite.nom', kind: 'text', label: 'Nom du site', max: 60, aide: 'Affiché dans l\'en-tête, le titre des pages, le pied de page et les messages du bot. Obligatoire.' },
    { k: 'site_identite.initiales', kind: 'text', label: 'Initiales', max: 4, aide: 'Lettres du logo de secours (intro et console admin).' },
    { k: 'site_identite.logo_url', kind: 'url', vide: true, label: 'Logo par défaut', aide: 'Adresse https://… ou chemin assets/… . Vide : logo d\'origine. Le logo d\'un thème en cours reste prioritaire.' },
    { k: 'site_identite.copyright', kind: 'text', max: 120, label: 'Ligne de copyright', aide: 'Pied de page. {annee} et {nom} sont remplacés automatiquement.' },
  ] },
  { id: 'legal', titre: 'Éditeur et mentions légales', aide: 'Remplissent les mentions légales et la politique de confidentialité. Vide : « à compléter » s\'affiche sur la page.', champs: [
    { k: 'site_identite.editeur', kind: 'text', vide: true, max: 120, label: 'Nom ou pseudo de l\'éditeur', aide: 'Personne qui édite le site. Laisse vide tant que ce n\'est pas décidé.' },
    { k: 'site_identite.contact_email', kind: 'email', vide: true, label: 'Adresse e-mail de contact', aide: 'Affichée dans les mentions légales et la politique de confidentialité.' },
    { k: 'site_textes.legal_mentions', kind: 'area', vide: true, max: 3000, label: 'Texte ajouté aux mentions légales', aide: 'Paragraphe(s) ajouté(s) en fin de section. Une ligne vide sépare deux paragraphes.' },
    { k: 'site_textes.legal_confidentialite', kind: 'area', vide: true, max: 3000, label: 'Texte ajouté à la confidentialité', aide: 'Ajouté en fin de la politique de confidentialité.' },
    { k: 'site_textes.legal_cookies', kind: 'area', vide: true, max: 3000, label: 'Texte ajouté aux cookies', aide: 'Ajouté en fin de la section Cookies.' },
  ] },
  { id: 'textes', titre: 'Textes des pages', aide: 'Phrases affichées à plusieurs endroits du site.', champs: [
    { k: 'site_textes.intro_indice', kind: 'text', max: 200, label: 'Indice de l\'intro', aide: 'Phrase lue par les lecteurs d\'écran pendant l\'intro.' },
    { k: 'site_textes.intro_bouton', kind: 'text', max: 40, label: 'Bouton de fin d\'intro', aide: 'Affiché à la fin de l\'intro, avant l\'accueil.' },
    { k: 'site_textes.cookies_texte', kind: 'area', max: 400, label: 'Texte du bandeau cookies', aide: 'Le lien « En savoir plus » est ajouté automatiquement.' },
    { k: 'site_textes.assistance_intro', kind: 'area', max: 400, label: 'Texte de la page Assistance', aide: '{nom} est remplacé par le nom du site.' },
  ] },
  { id: 'affichage', titre: 'Intro et bandeau cookies', aide: 'Activer ou couper ces deux éléments.', champs: [
    { k: 'site_identite.intro_active', kind: 'bool', label: 'Intro d\'entrée', aide: 'Coupée : l\'accueil s\'ouvre directement, sans l\'animation.' },
    { k: 'site_identite.bandeau_cookies', kind: 'bool', label: 'Bandeau d\'information cookies', aide: 'Coupé : le bandeau n\'apparaît plus. Le site n\'utilise que le stockage nécessaire.' },
  ] },
  { id: 'navigation', titre: 'Menu et pied de page', aide: 'Libellés du menu (en-tête) et liens du pied de page.', champs: [
    { k: 'site_textes.nav_libelles', kind: 'nav', label: 'Libellés du menu', aide: 'Vide = nom automatique de la page. Le libellé s\'affiche dans l\'en-tête.' },
    { k: 'site_textes.footer_liens', kind: 'footer', label: 'Liens du pied de page', aide: 'Décoche pour masquer un lien. « Événements » reste réservé aux membres qui y ont accès.' },
  ] },
];

/** Libellés automatiques du menu (pour le placeholder du champ). */
export const NAV_AUTO_LABELS = { 'secret-santa': 'Secret Santa', irl: 'IRL', historique: 'Historique', messages: 'Messages', cartes: 'Cartes', membre: 'Annuaire', recap: 'Récap' };
