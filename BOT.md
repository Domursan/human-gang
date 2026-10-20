# Bot Discord Human Gang : guide d'installation

Ce guide explique comment créer le bot qui envoie les annonces et les messages privés (MP) du site Human Gang.
Compte environ 15 minutes. Tu n'as rien à installer ni à héberger : le bot ne « tourne » pas en continu,
ce sont les fonctions Supabase `hg-notify` et `hg-support` qui parlent à Discord quand quelque chose se passe sur le site.

Ce que fait le bot :

| Événement | Message |
|---|---|
| Tirage du Secret Santa | Annonce dans le salon + MP à chaque participant : « Le tirage est fait, va voir ta carte » |
| Un Santa a envoyé son cadeau | MP au destinataire : « Ton Santa a envoyé ton cadeau ! » (sans dire qui c'est) |
| Un cadeau est reçu | MP au Santa : « Ta cible a reçu son cadeau » |
| Nouvelle sortie IRL | Annonce dans le salon (titre, date, lieu, lien) |
| Demande d'assistance | MP à toi, avec le sujet, le pseudo, le contact et le message |

Le bot ne révèle jamais les paires du Secret Santa et désactive les mentions (pas de @everyone possible).

---

## 1. Créer l'application et le bot

1. Va sur le portail développeur : <https://discord.com/developers/applications> et connecte-toi.
2. Clique sur **New Application**, nomme-la `Human Gang`, accepte les conditions, **Create**.
3. Dans **General Information**, tu peux mettre le logo du gang en icône et une description.
4. Menu de gauche : **Bot**.
   - Donne-lui un nom d'utilisateur (`Human Gang`) et l'avatar du logo.
   - Désactive **Public Bot** : comme ça, toi seul peux l'inviter sur un serveur.
   - Laisse les trois **Privileged Gateway Intents** désactivés : le bot n'en a pas besoin.

## 2. Récupérer le token

1. Toujours dans **Bot**, clique sur **Reset Token**, confirme, puis **Copy**.
2. Garde-le de côté pour l'étape 4. **Ne le partage jamais**, ne le colle ni dans le code du site ni dans `admin.html` :
   avec ce token, n'importe qui peut parler au nom du bot. Si tu penses qu'il a fuité, refais **Reset Token**
   et mets le nouveau dans Supabase.

    ## 3. Inviter le bot sur le serveur du gang

    1. Menu de gauche : **OAuth2** → **URL Generator**.
    2. Dans **Scopes**, coche uniquement **bot**.
    3. Dans **Bot Permissions**, coche seulement les permissions minimales :
      - **View Channels**
      - **Send Messages**
      - **Embed Links**
    4. Copie l'URL générée en bas, ouvre-la dans ton navigateur, choisis le serveur du Human Gang, **Autoriser**.
    5. Vérifie que le bot a bien accès au salon d'annonces (si le salon est privé, ajoute le bot ou son rôle
      dans les permissions du salon avec « Voir le salon », « Envoyer des messages » et « Intégrer des liens »).

## 4. Ajouter les secrets dans Supabase

1. Ouvre le projet **Gestion_RP** sur <https://supabase.com/dashboard>.
2. Va dans **Edge Functions** → **Secrets** (ou *Manage secrets*).
3. Ajoute :

| Nom | Valeur |
|---|---|
| `DISCORD_BOT_TOKEN` | le token copié à l'étape 2 |
| `SITE_URL` | l'adresse du site, sans `/` final, par ex. `https://ton-pseudo.github.io/human-gang` (facultatif mais conseillé : sert aux liens dans les messages) |

`SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont fournis automatiquement, tu n'as rien à faire pour eux.
Les fonctions lisent les secrets à chaque appel : pas besoin de les redéployer après un changement.

## 5. Copier les ID Discord (mode développeur)

1. Dans Discord : **Paramètres utilisateur** → **Avancés** → active **Mode développeur**.
2. **ID du salon d'annonces** : clic droit sur le salon (appui long sur mobile) → **Copier l'identifiant du salon**.
3. **Ton ID utilisateur** : clic droit sur ton propre nom → **Copier l'identifiant de l'utilisateur**.

Ce sont des nombres de 17 à 20 chiffres.

## 6. Régler le bot dans le site

1. Connecte-toi au site, ouvre **Admin** → section **Bot Discord** (`admin.html#bot`).
2. Colle l'ID du salon d'annonces et ton ID Discord.
3. Choisis les notifications à activer, puis **Enregistrer**.
4. Clique sur **Envoyer un message de test** : tu dois voir un message dans le salon et recevoir un MP.
   Si l'un des deux échoue, regarde les points de la section 8.

## 7. Côté membres

Pour recevoir les MP (tirage, cadeaux), chaque membre doit :

- renseigner son **ID Discord** dans sa page **Compte** (même méthode qu'à l'étape 5) et laisser l'option
  « recevoir les messages du bot » activée ;
- avoir **au moins un serveur en commun avec le bot** (le serveur du gang) : Discord interdit à un bot d'écrire
  à quelqu'un avec qui il ne partage aucun serveur ;
- **accepter les messages privés** des membres de ce serveur : clic droit sur le serveur →
  **Paramètres de confidentialité** → activer **Messages privés**.

Un membre qui ne remplit pas ces conditions ne reçoit simplement pas de MP : le site fonctionne normalement.

## 8. En cas de problème

- **Rien ne part** : vérifie que le secret s'appelle exactement `DISCORD_BOT_TOKEN` et que le token est le dernier généré.
- **Le salon ne reçoit rien** : ID du salon incorrect, ou le bot n'a pas les permissions sur ce salon.
- **Un MP échoue** (erreur Discord 50007) : la personne n'a pas de serveur en commun avec le bot ou refuse les MP.
- **Assistance** : dans l'admin, chaque demande affiche « MP Discord envoyé » ou « non envoyé ». La demande est
  enregistrée dans tous les cas, même si Discord ne répond pas.
- **Journaux** : Supabase → Edge Functions → `hg-notify` ou `hg-support` → **Logs**.

## 9. Anniversaires (pas encore automatisés)

Le réglage « Anniversaires » existe déjà dans l'admin mais **aucun message n'est envoyé pour l'instant**.
Idée pour plus tard :

- une fonction edge `hg-birthdays` qui cherche les membres dont c'est l'anniversaire aujourd'hui
  (uniquement ceux qui ont activé « partager mon anniversaire ») et poste un message dans le salon ;
- appelée chaque matin par **pg_cron** (+ `pg_net`) depuis Supabase, par exemple à 8 h heure suisse ;
- en respectant le réglage `notify.birthday` et sans jamais afficher l'année de naissance.
