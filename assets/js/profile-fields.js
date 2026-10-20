// ===== Informations diverses (Secret Santa) — liste unique des champs =====
// Stockées dans hg_profile_info.data (jsonb, clé = id). Visibles par la personne et l'admin uniquement.
// L'admin choisit, par édition, les clés transmises au Santa (hg_ss_editions.shared_fields).
// type : 'text' (une ligne) | 'textarea' (plusieurs lignes)
export const INFO_GROUPS = [
  { id: 'livraison', label: 'Livraison', fields: [
    { id: 'nom_complet', label: 'Nom et prénom (pour le colis)', type: 'text' },
    { id: 'adresse', label: 'Adresse postale', type: 'textarea', placeholder: 'Rue, numéro\nNPA Ville\nPays' },
    { id: 'telephone', label: 'Téléphone (pour le livreur)', type: 'text' },
    { id: 'point_relais', label: 'Point relais / préférences de livraison', type: 'text' },
    { id: 'remise_main_propre', label: 'Remise en main propre possible ? Où / quand', type: 'text' },
  ] },
  { id: 'tailles', label: 'Tailles', fields: [
    { id: 'taille_haut', label: 'Haut (t-shirt, pull)', type: 'text', placeholder: 'Ex. M' },
    { id: 'taille_bas', label: 'Bas (pantalon)', type: 'text', placeholder: 'Ex. 32/32 ou 40' },
    { id: 'pointure', label: 'Pointure', type: 'text', placeholder: 'Ex. 42' },
    { id: 'taille_bague', label: 'Taille de bague', type: 'text' },
    { id: 'taille_autre', label: 'Autres tailles (chapeau, gants…)', type: 'text' },
  ] },
  { id: 'gouts', label: 'Goûts', fields: [
    { id: 'couleurs', label: 'Couleurs préférées', type: 'text' },
    { id: 'style', label: 'Style (vêtements, déco…)', type: 'text' },
    { id: 'hobbies', label: 'Hobbies et passions', type: 'textarea' },
    { id: 'univers', label: 'Univers préférés (films, séries, jeux, musique, livres…)', type: 'textarea' },
    { id: 'gourmandises', label: 'Gourmandises, boissons, snacks préférés', type: 'text' },
    { id: 'parfums', label: 'Parfums / odeurs aimés', type: 'text' },
    { id: 'adore', label: 'J\'adore…', type: 'textarea' },
    { id: 'naime_pas', label: 'Je n\'aime pas…', type: 'textarea' },
  ] },
  { id: 'reseaux', label: 'Réseaux sociaux & gaming', fields: [
    { id: 'discord_pseudo', label: 'Discord', type: 'text', placeholder: 'pseudo' },
    { id: 'instagram', label: 'Instagram', type: 'text', placeholder: '@pseudo' },
    { id: 'tiktok', label: 'TikTok', type: 'text', placeholder: '@pseudo' },
    { id: 'snapchat', label: 'Snapchat', type: 'text' },
    { id: 'x_twitter', label: 'X (Twitter)', type: 'text', placeholder: '@pseudo' },
    { id: 'facebook', label: 'Facebook', type: 'text' },
    { id: 'youtube', label: 'YouTube', type: 'text' },
    { id: 'twitch', label: 'Twitch', type: 'text' },
    { id: 'steam', label: 'Steam', type: 'text', placeholder: 'pseudo ou code ami' },
    { id: 'epic', label: 'Epic Games', type: 'text' },
    { id: 'psn', label: 'PlayStation Network', type: 'text' },
    { id: 'xbox', label: 'Xbox (Gamertag)', type: 'text' },
    { id: 'nintendo', label: 'Nintendo (code ami)', type: 'text', placeholder: 'SW-0000-0000-0000' },
    { id: 'battlenet', label: 'Battle.net', type: 'text', placeholder: 'Pseudo#1234' },
    { id: 'riot', label: 'Riot ID', type: 'text', placeholder: 'Pseudo#TAG' },
    { id: 'rockstar', label: 'Rockstar Social Club / FiveM', type: 'text' },
    { id: 'ea', label: 'EA / Ubisoft', type: 'text' },
    { id: 'autres_reseaux', label: 'Autres plateformes', type: 'textarea' },
  ] },
  { id: 'contraintes', label: 'À savoir', fields: [
    { id: 'allergies', label: 'Allergies ou intolérances (alimentaires, matières…)', type: 'text' },
    { id: 'regime', label: 'Régime alimentaire', type: 'text', placeholder: 'Ex. végétarien, sans alcool' },
    { id: 'animaux', label: 'Animaux à la maison', type: 'text' },
    { id: 'deja_possede', label: 'Ce que j\'ai déjà / à éviter', type: 'textarea' },
    { id: 'idees_libres', label: 'Autres idées ou remarques', type: 'textarea' },
  ] },
];
export const INFO_FIELDS = INFO_GROUPS.flatMap((g) => g.fields.map((f) => ({ ...f, group: g.id, groupLabel: g.label })));
export const INFO_LABEL = Object.fromEntries(INFO_FIELDS.map((f) => [f.id, f.label]));
