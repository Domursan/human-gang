// Groupe de tutos « premiers-pas » : données pures (aucun import), lisibles dans le navigateur et dans Node.
// Groupe visible sans compte. Démonstration : le tuto de la page d'aide elle-même.
export default {
  id: 'premiers-pas',
  title: 'Premiers pas',
  icon: '👋',
  tutos: [
    {
      slug: 'utiliser-la-page-aide',
      title: "Utiliser la page d'aide",
      summary: "Trouve un tuto en quelques secondes, ouvre-le et va directement sur la bonne page du site.",
      page: 'aide.html',
      steps: [
        { title: 'Ouvre la page d\'aide', text: 'Clique sur le bouton « ? » de la colonne d\'outils : à droite de l\'en-tête sur ordinateur, dans la rangée d\'outils sur téléphone. Tu peux aussi passer par « Aide & tutos » dans le menu.', img: 'assets/tutos/utiliser-la-page-aide-1.png' },
        { title: 'Cherche un tuto', text: 'Tape un mot dans le champ « Rechercher un tuto ». La recherche regarde le titre, le résumé et les mots-clés de chaque tuto.' },
        { title: 'Ouvre le tuto', text: 'Clique sur son titre : les étapes numérotées s\'affichent. L\'adresse de la page devient alors aide.html suivie du nom du tuto, tu peux donc l\'envoyer à quelqu\'un.' },
        { title: 'Va sur la page concernée', text: 'Clique sur le bouton « Y aller » en bas du tuto pour ouvrir directement la page dont il parle.' },
        { title: 'Demande de l\'aide si besoin', text: 'Tout en bas de la page d\'aide, « Besoin d\'aide ? » ouvre l\'assistance, pour signaler un bug ou proposer une idée.' },
      ],
      tips: ['Sans compte, seuls les tutos « Premiers pas » sont visibles. Connecte-toi pour voir les autres.', 'Le bouton « ← Tous les tutos » revient à la liste.'],
      keywords: ['aide', 'tuto', 'tutos', 'mode d\'emploi', 'recherche', 'bouton ?', 'assistance'],
    },
  ],
};
