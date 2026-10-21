# Administrateur de secours

Pour l'organisation du panel et les permissions Staff, voir `docs/ADMIN-PANEL.md`.

Ce document explique comment garder un second administrateur et comment retrouver l'accès à
l'administration si le compte principal est perdu ou bloqué. Il ne contient aucune donnée
personnelle : les adresses, identifiants et mots de passe réels ne doivent jamais être écrits dans
le dépôt (il est publié sur GitHub Pages).

## Fonctionnement

- L'accès à l'administration dépend d'un seul drapeau : `hg_profiles.is_admin` (fonction `hg_is_admin()`).
- Depuis l'interface, seul un administrateur peut modifier ce drapeau. Le trigger `hg_profiles_guard`
  annule toute modification de `is_admin` faite par quelqu'un qui n'est pas déjà administrateur.
- L'éditeur SQL du tableau de bord Supabase n'a pas de session utilisateur (`auth.uid()` est nul) :
  il ne peut donc pas modifier `is_admin` sans désactiver ce trigger, le temps de la modification.
  C'est le seul cas où le trigger est désactivé, et la procédure ci-dessous le réactive dans la même transaction.

## Promouvoir un second administrateur

1. La personne crée son compte normalement, avec un code d'invitation. Elle doit avoir un pseudo.
2. Dans l'éditeur SQL (projet Supabase du Humane Gang), retrouver l'identifiant du compte à partir du pseudo :

   ```sql
   select id, pseudo, is_admin from public.hg_profiles where pseudo = '<pseudo>';
   ```

3. Promouvoir le compte, dans une seule transaction (le trigger est réactivé avant la validation) :

   ```sql
   begin;
   alter table public.hg_profiles disable trigger hg_profiles_guard;
   update public.hg_profiles set is_admin = true where id = '<identifiant>';
   alter table public.hg_profiles enable trigger hg_profiles_guard;
   commit;
   ```

4. Vérifier, puis demander à la personne de se reconnecter pour que le site relise son profil :

   ```sql
   select pseudo, is_admin from public.hg_profiles where id = '<identifiant>';
   ```

Pour retirer les droits : même procédure, avec `is_admin = false`. Ne jamais retirer le dernier administrateur
(vérifier avant : `select count(*) from public.hg_profiles where is_admin;` doit renvoyer au moins 2).

## Récupérer l'accès

Cas 1 : le mot de passe est perdu, mais l'adresse e-mail fonctionne. Utiliser « Mot de passe oublié ? »
sur la page de connexion.

Cas 2 : l'adresse e-mail n'est plus accessible, ou le compte est bloqué dans Supabase Auth. Dans le tableau de
bord Supabase, section Authentication : débloquer le compte ou changer son adresse. Si le compte ne peut pas être
récupéré, créer un nouveau compte (code d'invitation), puis appliquer la procédure « Promouvoir un second
administrateur ».

Cas 3 : le profil a été supprimé alors que le compte Auth existe encore. Recréer la ligne avec l'identifiant
Auth du compte (pas de trigger sur l'insertion) :

```sql
insert into public.hg_profiles (id, pseudo, is_admin)
values ('<identifiant>', '<pseudo>', true);
```

## Bonnes pratiques

- Désigner dès maintenant un second administrateur de secours, et vérifier qu'il peut se connecter.
- Conserver hors du dépôt, dans un gestionnaire de mots de passe, les accès au tableau de bord Supabase.
- Les opérations ci-dessus sont faites directement en SQL : elles ne passent pas par les fonctions admin et
  n'apparaissent donc pas dans le journal `hg_admin_log`. Noter la date et la raison dans un endroit privé.
- Ne pas coller d'adresse e-mail, d'identifiant ou de mot de passe dans le dépôt, ni dans les migrations.
  Le compte initial est créé à partir de `hg_settings` (clé `admin_initial`), voir la fin de la migration 002.
