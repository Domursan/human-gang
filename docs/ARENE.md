# L'Arène v2 : règles, chiffres et raisons

Statut : **conçue, visible seulement des administrateurs** (aperçu). Les membres gardent l'Arène actuelle
(`hg_battle_*`, « Arène de cartes ») tant que le réglage `arena.v2_public` n'est pas vrai. Tous les chiffres
ci-dessous sont les valeurs par défaut ; ils se modifient dans le panel admin, section Arène, et sont bornés
par le serveur.

## En une phrase

Chacun a un deck de défense de 5 cartes. On attaque un membre proche de soi en points avec 5 cartes ; les 5 duels
décident du combat. Gagner fait monter sa cote d'Arène, perdre la fait baisser. Ligues, saison d'un mois,
petites récompenses en Paillettes et boosters en fin de saison.

## 1. Points d'Arène (la cote)

- **Départ : 1000 points** pour tout membre qui n'a encore jamais combattu.
- **Calcul : cote Elo simplifiée.** Le gain de l'attaquant est `K × (résultat − attendu)`, avec `K = 32`, `résultat` = 1
  (victoire), 0,5 (égalité), 0 (défaite), et `attendu = 1 / (1 + 10^((cote défenseur − cote attaquant) / 400))`.
  Le défenseur perd ou gagne l'inverse.
- **Exemples** (à cote égale) : victoire +16, égalité 0, défaite −16. Battre un membre 200 points au-dessus rapporte
  environ +24 ; battre un membre 200 points en dessous rapporte environ +8.
- **Plancher : 500 points.** Personne ne descend plus bas, ce qui évite les comptes condamnés à perdre.
- **Ligues** (seuils sur la cote) :

| Ligue | Cote |
|---|---|
| Bronze | moins de 1050 |
| Argent | 1050 à 1199 |
| Or | 1200 à 1399 |
| Diamant | 1400 à 1599 |
| Légende | 1600 et plus |

## 2. Combats

- **Mise en place** : le deck de défense est celui de l'Arène actuelle (5 cartes, dans l'ordre, une seule carte de
  puissance 6). Il est partagé entre les deux versions.
- **Duels** : identiques à l'Arène actuelle. Puissance = rareté (1 à 6) + 1 si brillante, + 2 si la famille a
  l'avantage. Membre bat objet, objet bat lieu, lieu bat moment, moment bat membre. Victoire = plus de duels gagnés
  que l'adversaire. Égalité = autant de duels gagnés de part et d'autre.
- **Attaques par jour : 5** (le jour se termine à minuit, heure de Zurich). Les défenses ne comptent pas.
- **Même membre : 2 attaques par jour au plus.** Empêche de passer ses journées sur une même personne.
- **Défenses reçues : 4 par jour au plus pour un même deck.** Un membre ne peut pas être harcelé : après quatre
  attaques reçues, les suivantes sont refusées jusqu'au lendemain.
- **Adversaires proposés** : les 8 membres les plus proches en points (ceux qui ont un deck sont attaquables). Ça
  garde des combats serrés, donc utiles, et évite de chercher les plus faibles.
- **Pas de combat sans deck** : un membre sans deck de défense ne peut pas être attaqué.
- **Égalité** : aucun gain pour personne (en points comme en Paillettes) ; le résultat compte dans l'historique.

## 3. Récompenses quotidiennes (en Paillettes)

- **1re victoire du jour en attaque : +5 ✦.**
- **Défense tenue** (l'attaquant perd) : **+3 ✦**, pour 3 défenses payées par jour au plus.
- **Plafond Arène : 20 ✦ par jour et par membre**, toutes sources confondues. C'est un garde-fou pour l'économie ; il
  ne devrait presque jamais bloquer.
- Les points d'Arène ne sont pas des Paillettes : monter en cote ne rapporte rien en soi. Seul le classement de fin
  de saison paie les points.

## 4. Saisons et fin de saison

- **Durée : 30 jours.** Une saison est une période de classement distincte de la saison trimestrielle
  (`hg_seasons`, migration 086), qui n'est pas modifiée.
- **Remise à niveau en début de saison : 50 %.** La nouvelle cote part de `1000 + (cote finale − 1000) × 50 %`, avec
  le plancher de 500. Une cote de 1600 repart à 1300 ; une cote de 600 repart à 800.
- **Classé** : au moins **3 combats** dans la saison (attaques et défenses). Les autres figurent dans
  l'historique, sans rang ni récompense.
- **Récompenses de fin de saison** (selon la ligue finale) :

| Ligue finale | Paillettes | Boosters Classique |
|---|---|---|
| Bronze | 0 | 0 |
| Argent | 10 ✦ | 0 |
| Or | 25 ✦ | 0 |
| Diamant | 50 ✦ | 1 |
| Légende | 100 ✦ | 2 |

- **Podium général, en plus** : 1er 150 ✦, 2e 100 ✦, 3e 60 ✦.
- **Plafond : 300 ✦ par membre et par saison** (ligue et podium ensemble). Les boosters ne sont pas comptés dans ce
  plafond, mais leur nombre est limité par la table ci-dessus.
- **Clôture** : par le Staff « cartes » ou l'administrateur, depuis le panel (bouton « Clôturer la saison »). Clôturer
  verse les récompenses, remet les cotes à niveau, crée la saison suivante et écrit une ligne dans le journal admin.
  Aucune clôture automatique pour l'instant (voir les points à valider).

## 5. Historique et notifications

- **Historique** : les 30 derniers combats (attaques et défenses), avec le score, les 5 duels, les points gagnés ou
  perdus et les Paillettes reçues. Les anciennes saisons affichent la ligue, le rang et les récompenses.
- **Notifications légères** (dans l'application seulement) : « Ton deck a été attaqué » en « Nouveau » dans
  l'historique et sur l'accueil, marqué comme vu à l'ouverture. Pas de notification push ni Discord.

## 6. Réglages admin

Tous les chiffres sont dans le panel (Jeux et cartes › Arène). Bornes entre parenthèses ; le serveur refuse ce qui
sort des bornes.

- Ouvrir l'Arène v2 aux membres (**administrateur seulement**), activer l'Arène, activer les gains.
- Départ (100 à 3000), plancher (0 à 2000), facteur K (4 à 64), remise à niveau (0 à 100 %), durée d'une saison
  (7 à 120 jours), combats minimum pour être classé (0 à 50).
- Attaques par jour (1 à 10), même membre (1 à 3), défenses reçues par jour (1 à 20).
- Victoire du jour en Paillettes (0 à 100), défense payée en Paillettes (0 à 100), défenses payées par jour (0 à 20),
  plafond Arène par jour (0 à 500), plafond de saison (0 à 2000).
- Seuils des ligues (0 à 5000), Paillettes par ligue (0 à 1000), boosters Diamant et Légende (0 à 10), podium
  (0 à 1000 chacun).

Chaque enregistrement est journalisé (avant, après) dans le journal admin.

## 7. Pourquoi ces choix (équilibre)

- **Pas d'avantage écrasant pour les grosses collections.** Une collection plus grande offre plus de choix de 5 cartes,
  mais la puissance vient de la rareté, et une seule carte de puissance 6 par main. Une grosse collection gagne
  surtout en variété de deck, pas en force brute.
- **Pas de farm.** Cinq attaques par jour, deux par membre, et les points sont échangés entre deux joueurs (ce que
  gagne l'un, l'autre le perd) : il n'y a rien à créer en tournant en rond. Le plancher empêche seulement de tomber
  à zéro, pas de remonter sans limite. Les récompenses en Paillettes sont plafonnées par jour et par saison.
- **Pas de harcèlement.** Deux attaques maximum sur un même membre et quatre défenses reçues par jour : une personne
  ne peut pas être visée en boucle, même par un groupe.
- **Le classement récompense la régularité, pas la chance.** Les adversaires proposés sont proches en points, donc
  les combats restent serrés. Battre un plus fort rapporte plus, mais la différence reste limitée (K = 32).
- **Lisible.** Une formule Elo, cinq duels comme aujourd'hui, et des chiffres ronds : tout tient dans cette page.

## Points à valider par le propriétaire

1. Les valeurs par défaut (K = 32, départ 1000, plancher 500, ligues, plafonds). Tout se change dans le panel.
2. Remise à niveau à 50 % ou autre ? Plancher à 500 ?
3. Récompenses de fin de saison : les paillettes par ligue, les boosters Classique (Diamant et Légende) et le podium.
4. Clôture **manuelle** seulement, ou aussi **automatique** à la date de fin ?
5. Les défenses comptent-elles dans les 3 combats minimum pour être classé ? (Oui par défaut.)
6. Le plafond de 4 défenses reçues par jour : trop fort, trop faible ?
7. Faut-il un badge de fin de saison, ou seulement le classement et les Paillettes ?
8. Le Staff « cartes » peut régler l'Arène ; seul l'administrateur peut l'ouvrir aux membres. Est-ce voulu ?
9. Les points d'Arène ne sont pas comptés dans la saison trimestrielle `hg_seasons`. Est-ce voulu ?
