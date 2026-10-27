// Groupe « Sorties IRL & souvenirs » — données pures (aucun import), lisibles dans le navigateur ET dans Node.
/*
 * Structure d'un groupe : { id, title, icon, tutos: [...] }.
 * Structure d'un tuto : { slug, title, summary, page (page HTML concernée), steps: [{ title, text }], tips: [texte], keywords: [mots de recherche] }.
 * La page d'aide (aide.js) affiche ces données ; elle ne les modifie pas.
 */
export default {
  id: 'irl-historique',
  title: 'Sorties IRL & souvenirs',
  icon: '📍',
  tutos: [
    {
      slug: 'proposer-une-sortie',
      title: 'Proposer une sortie',
      summary: 'Lancer une sortie IRL avec une date fixe, ou un sondage pour caler la date à plusieurs.',
      page: '/pages/irl/irl.html',
      steps: [
        { title: 'Ouvre Sorties IRL', text: 'Clique sur « IRL » dans la barre du haut, puis reste sur l’onglet « Sorties ».' },
        { title: 'Clique sur « + Proposer une sortie »', text: 'Le bouton est en haut à droite de la page.' },
        { title: 'Remplis le titre', text: 'Le titre est obligatoire. Le lieu, la description et une image de couverture sont facultatifs.' },
        { title: 'Choisis « Quand ? »', text: '« Date fixée » demande une date et une heure. « Date à caler » demande entre {{irl.sondage_min|2}} et {{irl.sondage_max|6}} dates possibles : le gang votera ensuite.' },
        { title: 'Clique sur « Créer la sortie »', text: 'Le gang est prévenu et la sortie apparaît dans la liste. Tu peux la modifier ou la supprimer avec « Modifier » et « Supprimer » sous la carte.' },
      ],
      tips: [
        'Sans image de couverture, la carte affiche simplement le jour et le mois.',
        'Une date à caler apparaît dans « Dates à caler » tant qu’aucune date n’est fixée.',
      ],
      keywords: ['sortie', 'proposer', 'créer', 'date', 'sondage', 'caler', 'irl'],
    },
    {
      slug: 'repondre-a-une-sortie',
      title: 'Répondre à une sortie',
      summary: 'Dire si tu viens, si tu hésites ou si tu n’es pas dispo.',
      page: '/pages/irl/irl.html',
      steps: [
        { title: 'Repère la sortie', text: 'Elle est dans « Prochaine sortie » ou dans « À venir », sur Sorties IRL.' },
        { title: 'Clique sur ta réponse', text: 'Choisis « Je viens », « Peut-être » ou « Pas dispo », sous la date.' },
        { title: 'Vérifie ta coche', text: 'Le bouton choisi affiche une coche. Ton nom apparaît dans la liste « Présents » si tu viens.' },
        { title: 'Change d’avis si besoin', text: 'Clique sur une autre réponse pour la remplacer. Reclique sur la réponse déjà cochée pour la retirer.' },
      ],
      tips: [
        'Les compteurs « viennent · peut-être · pas dispo » se mettent à jour pour tout le gang.',
        'Le bouton « Ajouter à mon agenda » crée un fichier d’agenda pour la sortie.',
      ],
      keywords: ['viens', 'peut-être', 'pas dispo', 'répondre', 'présent', 'rsvp', 'inscription'],
    },
    {
      slug: 'voter-pour-une-date',
      title: 'Voter pour une date',
      summary: 'Indiquer les dates qui t’arrangent dans un sondage, et caler la sortie.',
      page: '/pages/irl/irl.html',
      steps: [
        { title: 'Ouvre « Dates à caler »', text: 'Cette section, sur Sorties IRL, liste les sorties dont la date n’est pas encore fixée.' },
        { title: 'Clique sur « Je suis dispo »', text: 'Fais-le pour chaque date qui t’arrange : tu peux en choisir plusieurs.' },
        { title: 'Vérifie ton vote', text: 'Le bouton devient « Dispo » avec une coche. Reclique dessus pour retirer ton vote.' },
        { title: 'Fixe la date (organisateur)', text: 'Le créateur de la sortie, ou un admin, clique sur « Fixer cette date », puis sur « Fixer la date » pour confirmer.' },
      ],
      tips: [
        'La date qui a le plus de votes porte le badge « En tête ».',
        'Une fois la date fixée, la sortie passe dans « Prochaine sortie » ou « À venir » et tout le gang peut répondre.',
      ],
      keywords: ['vote', 'voter', 'dispo', 'date', 'sondage', 'caler', 'fixer'],
    },
    {
      slug: 'ajouter-photos-album',
      title: 'Ajouter des photos à l’album d’une sortie',
      summary: 'Partager ses photos d’une sortie passée dans son album.',
      page: '/pages/irl/irl.html',
      steps: [
        { title: 'Ouvre la sortie', text: 'Va dans « Sorties passées » sur Sorties IRL. La prochaine sortie a aussi son album une fois commencée.' },
        { title: 'Clique sur « Ajouter des photos »', text: 'Le bouton est dans la section « Album » de la sortie. Tu peux choisir plusieurs images d’un coup.' },
        { title: 'Attends la fin de l’envoi', text: 'Le compteur « Compression et envoi 1 / 3… » défile. Les photos sont compressées automatiquement.' },
        { title: 'Vérifie l’album', text: 'Un message confirme « photos ajoutées à l’album ». Tes photos apparaissent dans la grille.' },
      ],
      tips: [
        'Clique sur une miniature pour l’agrandir et la faire défiler.',
        '« Tout télécharger » récupère toutes les photos de l’album dans un fichier ZIP.',
      ],
      keywords: ['photo', 'album', 'ajouter', 'upload', 'image', 'sortie', 'zip', 'télécharger'],
    },
    {
      slug: 'ajouter-rencontre-passee',
      title: 'Ajouter une rencontre passée',
      summary: 'Rattraper une sortie oubliée ou faite avant le site, avec ses photos et ses présents.',
      page: '/pages/irl/irl.html',
      steps: [
        { title: 'Clique sur « + Ajouter une rencontre passée »', text: 'Le bouton est en haut de la page Sorties IRL, à côté de « + Proposer une sortie ».' },
        { title: 'Renseigne le titre et la date', text: 'Le titre et la date sont obligatoires. L’heure et le lieu sont facultatifs.' },
        { title: 'Coche « Qui était là ? »', text: 'Cherche les membres avec « Chercher un membre… » puis coche ceux qui étaient présents.' },
        { title: 'Ajoute des photos si tu veux', text: 'Le champ « Photos (facultatif) » accepte plusieurs images. Tu peux aussi ajouter une image de couverture.' },
        { title: 'Clique sur « Ajouter la rencontre »', text: 'La rencontre part directement dans « Sorties passées » et dans l’historique. Le gang n’est pas notifié.' },
      ],
      tips: [
        'Une rencontre ajoutée après coup reste classée parmi les passées, même si elle est récente.',
      ],
      keywords: ['rencontre', 'passée', 'retro', 'ajouter', 'oublié', 'avant le site', 'photos'],
    },
    {
      slug: 'dire-qui-etait-la',
      title: 'Dire qui était là',
      summary: 'Renseigner les présents d’une sortie passée, si tu l’as créée.',
      page: '/pages/irl/irl.html',
      steps: [
        { title: 'Va dans « Sorties passées »', text: 'Ouvre la sortie concernée sur Sorties IRL.' },
        { title: 'Clique sur « Qui était là ? »', text: 'Ce bouton apparaît sous la sortie. Il n’est visible que pour son créateur et pour un admin.' },
        { title: 'Coche les présents', text: 'Les membres du gang sont listés. Coche ceux qui étaient là.' },
        { title: 'Clique sur « Enregistrer les présents »', text: 'La ligne « présents » de la sortie et de l’historique est mise à jour.' },
      ],
      tips: [
        'Tant que personne n’est renseigné, la sortie affiche « Présents non renseignés ».',
      ],
      keywords: ['présent', 'qui était là', 'présence', 'participants', 'passée'],
    },
    {
      slug: 'historique-des-rencontres',
      title: 'Parcourir l’historique des rencontres',
      summary: 'Filtrer toutes les rencontres par année, lieu ou personne, et voir les lieux sur la carte.',
      page: '/pages/irl/irl.html',
      steps: [
        { title: 'Ouvre l’onglet « Historique des rencontres »', text: 'Il est à côté de l’onglet « Sorties », en haut de la page Sorties IRL.' },
        { title: 'Filtre par année', text: 'Les puces d’année, à côté de « Toutes », ne gardent que les rencontres de cette année.' },
        { title: 'Affine avec la recherche et les listes', text: 'Tape dans « Recherche » (titre, lieu, description, pseudo) ou choisis un « Lieu » ou une « Personne présente ».' },
        { title: 'Ouvre la carte', text: 'Clique sur « Voir la carte » pour afficher les lieux de rencontre. Le bouton devient « Masquer la carte ».' },
        { title: 'Parcours « Toutes nos rencontres »', text: 'Les rencontres sont listées par année. « Voir l’album · N photos » (ou « Ouvrir l’album » s’il n’y a pas de photo) ouvre les photos de la sortie.' },
      ],
      tips: [
        'Le bouton « Réinitialiser » efface tous les filtres d’un coup.',
      ],
      keywords: ['historique', 'rencontres', 'filtre', 'recherche', 'carte', 'lieu', 'année', 'personne'],
    },
    {
      slug: 'frise-historique',
      title: 'Parcourir la frise de l’historique',
      summary: 'Voir d’un coup d’œil les Secret Santa, les sorties et les moments cultes, année après année.',
      page: '/pages/irl/historique.html',
      steps: [
        { title: 'Ouvre Historique', text: 'Clique sur « Historique » dans la barre du haut. La frise s’affiche du plus récent au plus ancien.' },
        { title: 'Choisis un filtre', text: 'Les boutons « Tout », « Secret Santa », « IRL & albums » et « Moments cultes » ne gardent qu’une catégorie.' },
        { title: 'Ouvre un album', text: 'Sur une sortie, « Voir l’album (N photos) » ou « Ajouter des photos à l’album » ouvre la sortie sur la page Sorties IRL.' },
        { title: 'Lis les années', text: 'Chaque année a son titre et le nombre de souvenirs qu’elle contient.' },
      ],
      tips: [
        'Les miniatures de photos sur une sortie ouvrent directement son album.',
      ],
      keywords: ['historique', 'frise', 'timeline', 'filtre', 'année', 'archives', 'souvenirs'],
    },
    {
      slug: 'secret-santa-qui-offre-a-qui',
      title: 'Voir qui a offert à qui (Secret Santa)',
      summary: 'Retrouver la chaîne des cadeaux d’une édition passée du Secret Santa.',
      page: '/pages/irl/historique.html',
      steps: [
        { title: 'Trouve l’édition', text: 'Sur Historique, repère la carte « Secret Santa » de l’année voulue dans la frise.' },
        { title: 'Clique sur « Qui a offert à qui ? »', text: 'Pour une édition en cours de révélation, le libellé est « Qui offrait à qui ? ». Le bloc ne s’affiche que si les attributions sont enregistrées.' },
        { title: 'Lis la chaîne des cadeaux', text: 'Chaque ligne va de celui qui offre à celui qui reçoit. Ta ligne est mise en avant.' },
      ],
      tips: [
        'Le filtre « Secret Santa » ne garde que les éditions du Secret Santa.',
      ],
      keywords: ['secret santa', 'offre', 'qui a offert', 'cadeau', 'attribution', 'édition', 'archives'],
    },
    {
      slug: 'publier-moment-culte',
      title: 'Publier un moment culte',
      summary: 'Raconter un souvenir marquant et l’ajouter à la frise de l’historique.',
      page: '/pages/irl/historique.html',
      steps: [
        { title: 'Clique sur « + Ajouter un moment culte »', text: 'Le bouton est en haut à droite de la page Historique.' },
        { title: 'Donne un titre et une date', text: 'Le titre est obligatoire. La date est celle du moment : elle vaut aujourd’hui par défaut.' },
        { title: 'Raconte dans « Le récit »', text: 'Ce champ est facultatif. Tu peux aussi ajouter une image avec « Image (optionnelle) ».' },
        { title: 'Clique sur « Ajouter »', text: 'Le moment apparaît dans la frise, à sa date, et dans le filtre « Moments cultes ».' },
      ],
      tips: [
        'Tu peux modifier ou supprimer ton moment avec « Modifier » et « Supprimer » sous la carte.',
      ],
      keywords: ['moment culte', 'publier', 'ajouter', 'récit', 'souvenir', 'image', 'historique'],
    },
    {
      slug: 'reagir-moment-culte',
      title: 'Réagir à un moment culte',
      summary: 'Ajouter une réaction à un moment culte, ou la retirer.',
      page: '/pages/irl/historique.html',
      steps: [
        { title: 'Trouve le moment', text: 'Sur Historique, repère la carte « Moment culte » (filtre « Moments cultes » si besoin).' },
        { title: 'Repère la barre « Réactions »', text: 'Elle propose ❤️ Cœur, 😂 Rire, 😮 Surprise, 🔥 Feu, 👏 Bravo et 🎉 Fête, sous le récit.' },
        { title: 'Clique sur une réaction', text: 'Le compteur de la réaction augmente et son bouton est marqué comme choisi.' },
        { title: 'Retire ta réaction si besoin', text: 'Reclique sur la même réaction pour la retirer.' },
      ],
      tips: [
        'Clique sur l’image du moment pour l’agrandir.',
      ],
      keywords: ['réaction', 'réagir', 'cœur', 'rire', 'feu', 'bravo', 'fête', 'moment culte'],
    },
    {
      slug: 'attraper-image-evenement',
      title: 'Attraper l’image d’un événement',
      summary: 'Cliquer sur l’image spéciale qui traverse le site pendant un événement, avant qu’elle ne disparaisse.',
      page: '/pages/irl/evenements.html',
      steps: [
        { title: 'Ouvre la page Événements', text: 'Clique sur « Événements » dans le pied de page. La page liste les événements en cours et passés.' },
        { title: 'Surveille les pages du site', text: 'Pendant un événement en cours, une image spéciale peut apparaître sur n’importe quelle page du site, à un moment aléatoire.' },
        { title: 'Clique sur « Attraper »', text: 'Quand l’image apparaît, appuie sur son bouton « Attraper ». Au clavier, la touche Entrée fonctionne aussi.' },
        { title: 'Vérifie la capture', text: 'Un message confirme « Tu as attrapé … » avec ton nombre de captures. Ton total et le classement se mettent à jour sur la page Événements.' },
      ],
      tips: [
        'L’image ne reste pas longtemps à l’écran : il faut être rapide.',
        'Chaque événement limite le nombre de captures par personne (« Tes captures / max »).',
        'Les événements à venir ne sont pas affichés, pour garder la surprise.',
      ],
      keywords: ['événement', 'image', 'attraper', 'capture', 'classement', 'badge', 'chasse'],
    },
  ],
};
