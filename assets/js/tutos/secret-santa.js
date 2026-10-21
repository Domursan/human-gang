// ===== Humane Gang — tutos : groupe « Secret Santa » =====
// Données pures (aucun import), lisibles dans le navigateur ET dans Node.
// Libellés et chiffres vérifiés sur secret-santa.html / secret-santa.js / messages.js / membre.js,
// et en base (hg_badges, hg_settings.cards -> rewards : gift_sent = 250, badge = 500).

export default {
  id: 'secret-santa',
  title: 'Secret Santa',
  icon: '🎁',
  tutos: [
    {
      slug: 'sinscrire-a-une-edition',
      title: 'S’inscrire à une édition',
      summary: 'Rejoindre le tirage du Secret Santa pendant que les inscriptions sont ouvertes.',
      page: 'secret-santa.html',
      steps: [
        { title: 'Va sur la page Secret Santa', text: 'La carte « Inscription » indique le nombre d’inscrits et le statut de l’édition (« inscriptions ouvertes »).' },
        { title: 'Clique sur « S’inscrire »', text: 'Le bouton est dans la carte « Inscription ». Ton avatar apparaît dans « Les inscrits », avec le petit tag « toi ».' },
        { title: 'Attends la confirmation', text: 'Le message « Inscription enregistrée. Bienvenue dans le tirage ! » s’affiche en bas de l’écran.' },
        { title: 'Pour te retirer, clique sur « Se désinscrire »', text: 'Confirme avec « Me désinscrire ». Ta liste de souhaits est conservée si tu reviens.' },
      ],
      tips: [
        'Les inscriptions se ferment au tirage : après, tu ne peux plus t’inscrire ni te désinscrire.',
        'Si tu t’inscris trop tard, tu ne seras pas dans ce tirage : tu le verras dans la carte « Tirage en préparation ».',
      ],
      keywords: ['inscription', 's’inscrire', 'inscrit', 'désinscrire', 'secret santa', 'édition'],
    },
    {
      slug: 'remplir-sa-liste-de-souhaits',
      title: 'Remplir sa liste de souhaits',
      summary: 'Ajouter des idées de cadeaux, avec un lien si tu veux, pour aider ton Santa.',
      page: 'secret-santa.html',
      steps: [
        { title: 'Repère la carte « Ma liste de souhaits »', text: 'Elle est visible dès que tu es inscrit·e. Le rappel en dessous dit qu’elle n’est visible que par ton Santa.' },
        { title: 'Écris ton souhait dans le champ « Souhait »', text: 'Une idée, un titre de livre, une couleur préférée : 200 caractères maximum.' },
        { title: 'Ajoute un lien dans « Lien (facultatif) »', text: 'Seules les adresses http ou https sont acceptées. Le lien s’affiche avec le nom du site.' },
        { title: 'Clique sur « Ajouter »', text: 'Le souhait apparaît dans la liste. Pour en retirer un, clique sur l’icône poubelle à côté de lui.' },
        { title: 'Vérifie ce que voit ton Santa', text: 'Ton Santa voit ta liste de souhaits, et les infos diverses que l’admin a choisi de partager pour cette édition. Tu les gères dans « Mon compte » › « Informations diverses ».', },
      ],
      tips: [
        'Ajoute au moins un souhait avant le tirage : c’est ce qui débloque le badge « Liste parfaite ».',
        'Tes infos diverses ne sont visibles que par toi et l’admin, sauf les champs que l’admin transmet à ton Santa.',
      ],
      keywords: ['souhait', 'liste de souhaits', 'wishlist', 'lien', 'ajouter', 'santa', 'informations diverses'],
    },
    {
      slug: 'decouvrir-sa-cible',
      title: 'Découvrir sa cible après le tirage',
      summary: 'Retourner la carte pour savoir à qui tu offres ton cadeau, et voir sa liste de souhaits.',
      page: 'secret-santa.html',
      steps: [
        { title: 'Attends le tirage', text: 'Quand l’admin a fait le tirage, la carte « Ta cible » apparaît sur la page Secret Santa, avec le titre « Retourne la carte ».' },
        { title: 'Retourne la carte', text: 'Clique sur la carte, ou sur le bouton « Retourner la carte ». Le titre devient « Ta carte » et la section « Tu offres à » affiche ta cible.' },
        { title: 'Lis la liste de ta cible', text: 'Ses souhaits s’affichent sous son nom, avec ses liens. Si elle a rempli des infos diverses partagées, un bloc « Ce qu’il faut savoir sur … » apparaît aussi.' },
        { title: 'Télécharge ta carte si tu veux', text: 'Le bouton « Télécharger la carte » devient cliquable quand l’image est prête. Il enregistre la carte au format PNG.' },
      ],
      tips: [
        'Le fait d’avoir retourné la carte est mémorisé dans ce navigateur seulement : sur un autre appareil, la carte se retourne à nouveau.',
        'Ne montre pas ta carte à ta cible : le secret, c’est tout le jeu.',
      ],
      keywords: ['cible', 'carte', 'retourner', 'découvrir', 'tirage', 'qui offrir', 'télécharger'],
    },
    {
      slug: 'messages-secrets-cible-santa',
      title: 'Écrire à sa cible ou à son Santa, anonymement',
      summary: 'Poser une question ou dire un mot sans dévoiler son identité, grâce à la messagerie secrète.',
      page: 'secret-santa.html',
      steps: [
        { title: 'Ouvre la section « Messages secrets »', text: 'Elle est sur la page Secret Santa, à côté de la carte de ta cible.' },
        { title: 'Écris à ton Santa', text: 'Clique sur « Écrire à mon Santa ». Tu peux le faire dès maintenant : il reste anonyme.' },
        { title: 'Écris à ta cible', text: 'Le bouton « Écrire à ma cible (anonyme) » n’apparaît qu’après avoir retourné la carte. Tes messages s’affichent alors comme « Ton Santa ».' },
        { title: 'Continue dans la messagerie', text: 'Tu arrives sur la conversation Secret Santa, dans la page Messages. Écris dans le champ en bas et envoie.' },
      ],
      tips: [
        'Ta cible voit ton message comme « Ton Santa » : elle ne sait pas que c’est toi, et tu ne sais pas qui est ton Santa.',
        'La conversation se crée au premier clic. Elle reste dans ta messagerie après l’édition, et son titre garde l’année.',
      ],
      keywords: ['message', 'messagerie', 'anonyme', 'santa', 'cible', 'écrire', 'secret'],
    },
    {
      slug: 'marquer-son-cadeau-envoye-ou-recu',
      title: 'Marquer son cadeau envoyé ou reçu',
      summary: 'Signaler à tout le monde où en est ton envoi, et voir l’avancement du gang.',
      page: 'secret-santa.html',
      steps: [
        { title: 'Va à la section « Mon envoi »', text: 'Elle apparaît après le tirage, sous la carte de ta cible. Elle contient deux lignes : « Cadeau envoyé » et « Mon cadeau reçu ».' },
        { title: 'Clique sur « J’ai envoyé le cadeau »', text: 'La ligne passe à « Envoyé » avec la date et l’heure. Le bot Discord prévient ton destinataire, sans dire qui tu es.' },
        { title: 'Clique sur « J’ai reçu le mien » à la réception', text: 'La ligne passe à « Reçu ». Le bot prévient ton Santa, sans révéler qui tu es.' },
        { title: 'Suis l’avancement', text: 'La carte « Avancement » affiche le pourcentage de cadeaux envoyés et reçus, avec le total (par exemple « 3 / 8 cadeaux envoyés »).' },
      ],
      tips: [
        'Un clic est définitif : le bouton reste « Envoyé » ou « Reçu ». Seul l’admin, en mode sans limite, peut annuler.',
        'Marquer ton cadeau envoyé te rapporte 250 Paillettes.',
      ],
      keywords: ['envoi', 'envoyé', 'reçu', 'cadeau', 'avancement', 'paillettes', 'discord'],
    },
    {
      slug: 'revelation-qui-a-offert-a-qui',
      title: 'La révélation : qui a offert à qui',
      summary: 'Découvrir la chaîne des cadeaux une fois l’édition révélée.',
      page: 'secret-santa.html',
      steps: [
        { title: 'Attends la révélation', text: 'Quand l’admin passe l’édition à l’étape « Révélation », la section « Qui offrait à qui » apparaît en bas de la page Secret Santa.' },
        { title: 'Repère ta paire', text: 'Chaque ligne montre qui offre à qui. Ta propre paire est mise en avant.' },
        { title: 'Lis la fin de l’édition', text: 'Une fois l’édition terminée, le titre devient « Qui a offert à qui ». La liste reste visible.' },
        { title: 'Retrouve-la dans l’historique', text: 'Dans Historique, le filtre « Secret Santa » rassemble les éditions passées.' },
      ],
      tips: [
        'Tant que l’édition n’est pas en révélation, aucune paire n’est affichée : ne cherche pas ailleurs.',
      ],
      keywords: ['révélation', 'qui offre à qui', 'paires', 'chaîne', 'historique', 'secret santa'],
    },
    {
      slug: 'badges-et-paillettes-secret-santa',
      title: 'Badges et Paillettes du Secret Santa',
      summary: 'Ce qui rapporte un badge ou des Paillettes pendant une édition.',
      page: 'membre.html',
      steps: [
        { title: 'Envoie ton cadeau', text: 'Marquer « J’ai envoyé le cadeau » rapporte 250 Paillettes.' },
        { title: 'Écris une liste avant le tirage', text: 'Au moins un souhait ajouté avant le tirage donne le badge « Liste parfaite ».' },
        { title: 'Sois le premier ou le dernier à envoyer', text: '« Lutin express » : le premier cadeau envoyé de l’édition. « Sur le fil » : un cadeau envoyé le dernier jour de la date limite.' },
        { title: 'Reviens pour la durée', text: '« Premier Noël » : avoir participé à une édition révélée ou terminée. « Vétéran » : avoir participé à 5 éditions.' },
        { title: 'Regarde tes badges sur ta carte de membre', text: 'Ouvre « Carte de membre » : tes badges s’affichent avec leur nom.' },
      ],
      tips: [
        'Chaque badge obtenu rapporte 500 Paillettes.',
        'Le badge « Sur le fil » ne compte que si le cadeau a bien été marqué envoyé le dernier jour.',
      ],
      keywords: ['badge', 'paillettes', 'premier noël', 'vétéran', 'lutin express', 'sur le fil', 'liste parfaite', 'carte de membre'],
    },
  ],
};
