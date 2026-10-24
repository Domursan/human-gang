// Réglages du lot 1 : identité, textes, pages légales, menu, pied de page, intro et bandeau cookies.
// Stockés dans hg_settings sous site_identite et site_textes (écarts aux valeurs par défaut uniquement).
// Les valeurs par défaut vivent dans core/site-defaults.js, lues par le site et par ce formulaire.
// Les deux clés sont saisies dans le formulaire « Identité et textes » (formulaire: true) : elles n'apparaissent pas dans la liste.

export const KEYS_LOT1 = {
  site_identite: { label: 'Identité du site', help: 'Nom, initiales, logo, éditeur, contact, intro, bandeau cookies, maintenance et bandeau d’annonce. Se règle dans le formulaire « Identité et textes ».', formulaire: true },
  site_textes: { label: 'Textes et menu du site', help: 'Textes des pages, libellés du menu et du pied de page, paragraphes ajoutés aux pages légales. Se règle dans le formulaire « Identité et textes ».', formulaire: true },
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
  { id: 'visite', titre: 'Visite guidée', aide: 'Les bulles montrées à la première connexion d’un membre (menu, Cartes, loupe, Aide). Une étape dont la page est masquée est sautée.', champs: [
    { k: 'site_identite.visite_active', kind: 'bool', label: 'Visite automatique au premier passage', aide: 'Coupée : la visite ne se lance plus d’elle-même ; « Revoir la visite » reste sur la page Aide.' },
    { k: 'site_textes.visite_bienvenue', kind: 'text', max: 200, label: 'Bulle de bienvenue', aide: '{n} est remplacé par le nombre d’étapes.' },
    { k: 'site_textes.visite_menu', kind: 'text', max: 200, label: 'Étape « menu »' },
    { k: 'site_textes.visite_cartes', kind: 'text', max: 200, label: 'Étape « Cartes »' },
    { k: 'site_textes.visite_recherche', kind: 'text', max: 200, label: 'Étape « recherche »' },
    { k: 'site_textes.visite_aide', kind: 'text', max: 200, label: 'Étape « Aide et tutos »' },
    { k: 'site_textes.visite_bandeau', kind: 'text', max: 120, label: 'Bandeau des membres déjà inscrits', aide: 'Après « Nouveau : ». Proposé une seule fois.' },
  ] },
  { id: 'hors_ligne', titre: 'Collection hors ligne', aide: 'Copie de la collection de cartes et de sa carte de membre sur l’appareil, pour la montrer sans réseau (lecture seule).', champs: [
    { k: 'site_identite.cartes_hors_ligne', kind: 'bool', label: 'Garder une copie hors ligne', aide: 'Coupée : plus aucune copie n’est gardée, et la copie existante est effacée à la visite suivante de la page Cartes.' },
  ] },
  { id: 'navigation', titre: 'Menu et pied de page', aide: 'Libellés du menu (en-tête) et liens du pied de page.', champs: [
    { k: 'site_textes.nav_libelles', kind: 'nav', label: 'Libellés du menu', aide: 'Vide = nom automatique de la page. Le libellé s\'affiche dans l\'en-tête.' },
    { k: 'site_textes.footer_liens', kind: 'footer', label: 'Liens du pied de page', aide: 'Décoche pour masquer un lien. « Événements » reste réservé aux membres qui y ont accès.' },
  ] },
  { id: 'etat', titre: 'État du site', aide: 'Mode maintenance et bandeau d’annonce affiché en haut de chaque page. C’est un affichage, pas une protection : les données restent protégées par la base.', champs: [
    { k: 'site_identite.maintenance_active', kind: 'bool', label: 'Mode maintenance', aide: 'Activé : les membres voient un écran « en maintenance » à la place des pages (sauf admin, compte et mentions légales). L’administrateur et le Staff naviguent normalement.' },
    { k: 'site_identite.maintenance_message', kind: 'area', vide: true, max: 400, label: 'Message de maintenance', aide: 'Vide : « Le site est en maintenance, reviens un peu plus tard. »' },
    { k: 'site_identite.bandeau_actif', kind: 'bool', label: 'Bandeau d’annonce', aide: 'Activé et texte rempli : un bandeau s’affiche en haut de chaque page. Chacun peut le fermer pour sa visite.' },
    { k: 'site_identite.bandeau_texte', kind: 'area', vide: true, max: 300, label: 'Texte du bandeau', aide: 'Une ou deux phrases courtes. Vide : aucun bandeau, même activé.' },
  ] },
];

/** Parties du formulaire (sous-sections de Site) : groupes affichés et adresse de chaque partie. */
export const PARTS_LOT1 = {
  identite: { label: 'Identité et mentions légales', groups: ['identite', 'legal'], route: '#pilotage/identite' },
  textes: { label: 'Textes et intro', groups: ['textes', 'affichage', 'visite', 'hors_ligne'], route: '#pilotage/textes' },
  menu: { label: 'Menu et pied de page', groups: ['navigation'], route: '#pilotage/menu' },
  etat: { label: 'État du site', groups: ['etat'], route: '#pilotage/etat' },
};

/** Libellés automatiques du menu (pour le placeholder du champ). */
export const NAV_AUTO_LABELS = { 'secret-santa': 'Secret Santa', irl: 'IRL', historique: 'Historique', messages: 'Messages', cartes: 'Cartes', membre: 'Annuaire', recap: 'Récap' };
