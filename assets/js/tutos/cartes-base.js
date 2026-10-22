// Tutos « Jeu de cartes : les bases ». Données pures (aucun import) : lisibles dans le navigateur et dans Node.
// Chiffres issus de hg_card_cfg() (réglage « cards ») : prix, taux, recyclage, fabrication, récompenses.
/*
 * Structure d'un groupe : { id, title, icon, tutos: [...] }.
 * Structure d'un tuto : { slug, title, summary, page (page HTML concernée), steps: [{ title, text }], tips: [texte], keywords: [mots de recherche] }.
 * La page d'aide (aide.js) affiche ces données ; elle ne les modifie pas.
 */
export default {
  id: 'cartes-base',
  title: 'Jeu de cartes : les bases',
  icon: '🃏',
  tutos: [
    {
      slug: 'paillettes-passage-du-jour',
      title: 'Les Paillettes et le passage du jour',
      summary: 'Les Paillettes sont la monnaie du jeu, et le passage du jour t’en donne chaque jour.',
      page: 'cartes.html',
      steps: [
        { title: 'Regarde ton solde', text: 'En haut de la page Cartes, la pastille lumineuse affiche ton solde de Paillettes. Tu démarres avec 1 000 Paillettes.' },
        { title: 'Prends le passage du jour', text: 'Une fois par jour, le bouton « Passage du jour (+100) » apparaît en haut de la page. Clique dessus pour encaisser les Paillettes. Le jour se compte à l’heure de Zurich.' },
        { title: 'Garde ta série', text: 'Chaque jour d’affilée ajoute 20 Paillettes : 120 le deuxième jour, 140 le troisième, et ainsi de suite jusqu’à 680 au trentième jour. Si tu sautes un jour, la série repart de 1 (« Série actuelle : N j »).' },
        { title: 'Gagne-en d’autres façons', text: 'Tu reçois aussi des Paillettes quand tu réponds « oui » à une sortie (+50), que tu es présent à une sortie (+100), que tu partages une photo (+100) ou un moment culte (+100), que tu crées une sortie (+100), que tu participes à une capture d’événement (+150) ou que tu obtiens un badge (+500). Envoyer ton cadeau Secret Santa rapporte +250, et compléter une série de cartes +300.' },
        { title: 'Lis ton historique', text: 'Sous la page, la zone « Historique des Paillettes (30 derniers mouvements) » montre d’où vient chaque gain et où part chaque dépense.' },
      ],
      tips: [
        'Les Paillettes sont uniquement du jeu : aucun argent réel n’est en jeu.',
      ],
      keywords: ['paillettes', 'solde', 'passage du jour', 'série', 'gagner', 'historique'],
    },
    {
      slug: 'ouvrir-un-booster',
      title: 'Ouvrir un booster',
      summary: 'Un booster contient 5 cartes : un gratuit toutes les 24 h, un payant à 100 Paillettes, ou un offert par le gang.',
      page: 'cartes.html',
      steps: [
        { title: 'Va sur Cartes, onglet Boosters', text: 'Ouvre Cartes dans le menu du haut. L’onglet « Boosters » s’affiche par défaut.' },
        { title: 'Ouvre le booster gratuit', text: 'Dans la tuile « Booster gratuit », clique sur « Ouvrir le booster gratuit » quand il est disponible. Sinon, un compte à rebours « Disponible dans … » s’affiche. Le gratuit revient 24 h après ton dernier booster gratuit.' },
        { title: 'Ouvre un booster payant', text: 'Dans la tuile « Booster payant », clique sur « Ouvrir un booster · 100 ». Il coûte 100 Paillettes. Si ton solde est trop bas, le bouton reste grisé et le site indique « Il te manque … ».' },
        { title: 'Ouvre cinq boosters d’un coup', text: 'Le bouton « Ouvrir 5 boosters · 500 » ouvre cinq boosters payants à la suite, pour 500 Paillettes. Si l’ouverture s’arrête (solde insuffisant, coupure du réseau), le bouton propose ensuite les boosters restants, sans jamais en ouvrir deux fois.' },
        { title: 'Ouvre un booster offert', text: 'Si le gang t’en a offert, la section « Boosters offerts » apparaît avec « Ouvrir un booster offert (N restants) ». Il s’ouvre sans Paillettes et sans délai.' },
        { title: 'Révèle tes cartes', text: 'L’animation montre les cartes une à une. Clique sur « Tout révéler » pour sauter l’animation, puis sur « Fermer ». Tes cartes rejoignent ta collection.' },
      ],
      tips: [
        'Les chances de chaque rareté sont affichées dans le tableau « Chances », plus bas sur l’onglet Boosters.',
        'Chaque carte tirée a 3 % de chance d’être brillante.',
      ],
      keywords: ['booster', 'ouvrir', 'gratuit', 'payant', 'offert', 'cinq', 'chances', 'cartouche'],
    },
    {
      slug: 'lire-une-carte',
      title: 'Lire une carte',
      summary: 'Chaque carte indique sa rareté, sa famille, sa série et son numéro. Les brillantes et les numérotées se repèrent vite.',
      page: 'cartes.html',
      steps: [
        { title: 'Ouvre la fiche', text: 'Dans Cartes, onglet Collection, clique sur une carte. Sa fiche s’ouvre dans une fenêtre.' },
        { title: 'Lis la rareté et la famille', text: 'La ligne sous le nom donne la rareté (Commune, Peu commune, Rare, Épique, Légendaire, Mythique ou Identité), la famille (Membre, Moment, Lieu, Objet, Événement ou Jeu vidéo) et le numéro « n° … ».' },
        { title: 'Repère la série', text: 'Le nom de la série est indiqué dans la carte agrandie (voir le tuto sur la Collection) et en titre de groupe quand tu choisis « Toutes les séries ».' },
        { title: 'Repère les numéros d’exemplaire', text: 'Une carte à tirage limité indique son total (« N exemplaires au total »). Dans « Mes exemplaires », chaque exemplaire porte son numéro, du type « N° 03/50 ».' },
        { title: 'Repère les brillantes', text: 'Une version brillante a un effet holographique et porte la mention « Brillante » dans « Mes exemplaires ».' },
      ],
      tips: [
        'Le badge « ×N » sur une carte indique combien d’exemplaires tu possèdes.',
        'Une carte pas encore obtenue s’affiche en version manquante.',
      ],
      keywords: ['carte', 'rareté', 'famille', 'série', 'numéro', 'brillante', 'exemplaire', 'fiche'],
    },
    {
      slug: 'collection-filtres-et-loupe',
      title: 'La Collection : filtres, carte agrandie et loupe',
      summary: 'La Collection range toutes tes cartes, avec des filtres, la progression de chaque série et une carte agrandie.',
      page: 'cartes.html',
      steps: [
        { title: 'Ouvre l’onglet Collection', text: 'Sur la page Cartes, clique sur l’onglet « Collection ».' },
        { title: 'Choisis une série', text: 'Le menu « Série » propose chaque série ouverte. Avec « Toutes les séries », toutes les cartes sont affichées groupées par série, avec une barre de progression pour chacune.' },
        { title: 'Filtre les cartes', text: 'Trois menus affinent la liste : « Rareté », « Famille » et « Afficher » (Toutes les cartes, Possédées, Manquantes ou Doublons).' },
        { title: 'Agrandis une carte', text: 'Le petit bouton loupe, en haut à droite de chaque carte, ouvre la carte agrandie. « Précédent » et « Suivant » passent d’une carte à l’autre dans l’ordre affiché.' },
        { title: 'Utilise la loupe', text: 'Sur ordinateur, survole la carte agrandie pour la voir ×2,5. Sur téléphone, pince pour zoomer, ou fais un appui long pour une loupe ×2,5 sous ton doigt.' },
      ],
      tips: [
        'La progression compte les cartes à obtenir. Les cartes Identité n’y figurent pas.',
        'Le bouton « Recycler les doublons » est juste sous les filtres.',
      ],
      keywords: ['collection', 'filtres', 'série', 'toutes les séries', 'loupe', 'agrandir', 'zoom', 'manquantes', 'doublons'],
    },
    {
      slug: 'recycler-ses-doublons',
      title: 'Recycler ses doublons',
      summary: 'Transforme un exemplaire en Paillettes, une carte à la fois ou tous les doublons d’un coup.',
      page: 'cartes.html',
      steps: [
        { title: 'Repère les doublons', text: 'Dans Cartes, onglet Collection, choisis « Afficher : Doublons ». La liste ne montre que les cartes que tu possèdes en plusieurs exemplaires.' },
        { title: 'Recycle un exemplaire', text: 'Ouvre la fiche d’une carte. Dans « Mes exemplaires », le bouton « Recycler · N » indique ce que rapporte cet exemplaire. Clique dessus pour le recycler.' },
        { title: 'Recycle tous les doublons', text: 'Clique sur « Recycler les doublons ». La fenêtre annonce le nombre de doublons et le total en Paillettes. Le bouton « Recycler » confirme, « Annuler » ferme la fenêtre sans rien faire.' },
        { title: 'Garde un exemplaire', text: 'Il reste toujours un exemplaire de chaque carte. Le recyclage d’un coup garde la version brillante si tu en as une. Les cartes Identité et celles en cours d’échange ne sont pas touchées.' },
        { title: 'Vérifie ce que ça rapporte', text: 'Un exemplaire vaut : Commune 5, Peu commune 10, Rare 25, Épique 60, Légendaire 150 et Mythique 400 Paillettes. Une version brillante rapporte trois fois plus.' },
      ],
      tips: [
        'Le recyclage est définitif : une carte recyclée ne revient pas.',
        'Les cartes Identité ne se recyclent pas.',
      ],
      keywords: ['recycler', 'doublons', 'paillettes', 'exemplaire', 'brillante', 'valeur'],
    },
    {
      slug: 'fabriquer-une-carte',
      title: 'Fabriquer une carte',
      summary: 'Fabriquer une carte te la donne directement, contre des Paillettes, sans passer par un booster.',
      page: 'cartes.html',
      steps: [
        { title: 'Ouvre la fiche de la carte', text: 'Dans Cartes, onglet Collection, clique sur la carte voulue. Tu peux la fabriquer même si tu ne l’as pas encore.' },
        { title: 'Trouve la section Fabriquer', text: 'La section « Fabriquer » de la fiche indique si la carte peut être fabriquée et ce qu’elle coûte.' },
        { title: 'Fabrique la version normale', text: 'Le bouton « Fabriquer · N » coûte : 100 Paillettes (Commune), 150 (Peu commune), 200 (Rare), 750 (Épique) ou 2 000 (Légendaire). Il reste grisé si ton solde est trop bas, avec « Il te manque … ».' },
        { title: 'Fabrique la version brillante', text: 'Si la carte peut être brillante, « Version brillante » coûte six fois plus : 600, 900, 1 200, 4 500 ou 12 000 Paillettes selon la rareté.' },
        { title: 'Retrouve ta carte', text: 'La carte fabriquée rejoint ta collection, avec la source « Fabriquée » dans « Mes exemplaires ».' },
      ],
      tips: [
        'Les cartes Mythique et Identité ne se fabriquent pas. La fiche l’indique.',
        'La version brillante n’est proposée que pour les cartes qui peuvent être brillantes.',
      ],
      keywords: ['fabriquer', 'craft', 'paillettes', 'brillante', 'coût', 'carte'],
    },
    {
      slug: 'liste-de-souhaits',
      title: 'La liste de souhaits et ses alertes',
      summary: 'Mets de côté les cartes que tu veux, et demande à être prévenu quand un membre les obtient.',
      page: 'cartes.html',
      steps: [
        { title: 'Ouvre la fiche de la carte', text: 'Dans Cartes, onglet Collection, clique sur la carte que tu veux.' },
        { title: 'Ajoute-la à ta liste', text: 'Clique sur « Ajouter à ma liste de souhaits ». Le bouton passe à « Dans ma liste de souhaits ».' },
        { title: 'Retire-la si besoin', text: 'Clique de nouveau sur le même bouton pour retirer la carte de ta liste.' },
        { title: 'Active les alertes Discord', text: 'Va sur la page Compte, dans le bloc « Profil », coche « M’avertir sur Discord quand une carte de ma liste de souhaits est obtenue par un membre », puis clique sur « Enregistrer ».' },
        { title: 'Repère les correspondances', text: 'Dans l’onglet Échanges, les correspondances montrent les membres qui ont une carte que tu souhaites, et ceux qui souhaitent une carte que tu as en double.' },
      ],
      tips: [
        'Tes souhaits sont visibles par les autres membres dans les correspondances de l’onglet Échanges.',
      ],
      keywords: ['souhaits', 'liste de souhaits', 'alerte', 'discord', 'wishlist', 'correspondance', 'échanges'],
    },
  ],
};
