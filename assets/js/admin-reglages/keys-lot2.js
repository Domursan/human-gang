// Réglages « Comptes et invitations » (lot 2) : libellés et aides des clés de hg_settings.
// Importé et fusionné par keys.js.
export const KEYS_LOT2 = {
  invites: {
    label: 'Codes et liens d\'invitation',
    help: 'Durée d\'un code (48 h), codes par heure et par lien (30), durée d\'un compte fantôme (60 jours) et préfixe des codes (HG-). Se règle dans Membres · Invitations.',
    managed: '#membres/invitations',
    managedLabel: 'Membres · Invitations',
  },
  profile_fields: {
    label: 'Champs d\'informations personnelles',
    help: 'Groupes et champs du profil (livraison, tailles, goûts, réseaux, à savoir), au format { "groups": [ { "id", "label", "fields": [ { "id", "label", "type": "text" | "textarea", "placeholder"? } ] } ] }. Un identifiant de champ ne doit jamais changer : les réponses déjà saisies en dépendent. Sans cette clé, la liste d\'origine est utilisée.',
  },
};
