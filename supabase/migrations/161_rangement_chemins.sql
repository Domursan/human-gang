-- ===== Humane Gang — migration 161 : chemins du rangement (pages /pages/<cat>/, illustrations /assets/cartes/) =====
-- à appliquer au moment de la mise en ligne du rangement.
-- Appliquée à la bascule du rangement (27 octobre 2026), juste après la première publication de site/
-- (a) données : cartes (assets/cards/ -> /assets/cartes/), liens de notifications déjà envoyés, réglages de saisons et de menu ;
-- (b) fonctions : les liens de page et les validations d'images écrits par la base prennent la forme nouvelle (hg__patch, migration 141).
-- Les migrations précédentes ne sont pas modifiées : tout passe par des mises à jour de données et des remplacements de texte.

-- ---------------------------------------------------------------------
-- 0. Outil : remplace toutes les occurrences d'un texte dans les fonctions de ce nom (appuie sur hg__patch)
-- ---------------------------------------------------------------------
create or replace function public.hg__rangement_tout(p_nom text, p_old text, p_new text)
returns void language plpgsql set search_path = public as $$
declare f regprocedure; n int;
begin
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = p_nom loop
    n := 0;
    while strpos(pg_get_functiondef(f), p_old) > 0 loop
      n := n + 1;
      if n > 20 then raise exception 'hg__rangement_tout : boucle sur % (%)', f, left(p_old, 60); end if;
      perform public.hg__patch(f, p_old, p_new);
    end loop;
  end loop;
end $$;
revoke all on function public.hg__rangement_tout(text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Données
-- ---------------------------------------------------------------------
-- Illustrations des cartes : même arborescence, dossier renommé.
update public.hg_cards set image_url = '/assets/cartes/' || substr(image_url, length('assets/cards/') + 1)
  where image_url like 'assets/cards/%';

-- Notifications déjà écrites avec l'adresse absolue de l'ancien site.
update public.hg_site_notifs n set lien = 'https://humane-gang.com/' || m.neuf || substr(n.lien, length('https://humane-gang.com/' || m.ancien) + 1)
  from (values
  ('accueil.html', 'pages/compte/accueil.html'),
  ('admin.html', 'pages/admin/admin.html'),
  ('aide.html', 'pages/infos/aide.html'),
  ('assistance.html', 'pages/infos/assistance.html'),
  ('blackjack.html', 'pages/jeux/blackjack.html'),
  ('calendrier.html', 'pages/irl/calendrier.html'),
  ('cartes.html', 'pages/cartes/cartes.html'),
  ('catan.html', 'pages/jeux/catan.html'),
  ('cine.html', 'pages/irl/cine.html'),
  ('citations.html', 'pages/irl/citations.html'),
  ('cluedo.html', 'pages/jeux/cluedo.html'),
  ('collection-a4.html', 'pages/cartes/collection-a4.html'),
  ('compte.html', 'pages/compte/compte.html'),
  ('destins.html', 'pages/jeux/destins.html'),
  ('duels.html', 'pages/jeux/duels.html'),
  ('evenements.html', 'pages/irl/evenements.html'),
  ('historique.html', 'pages/irl/historique.html'),
  ('irl.html', 'pages/irl/irl.html'),
  ('jeux.html', 'pages/jeux/jeux.html'),
  ('legal.html', 'pages/infos/legal.html'),
  ('loup-garou.html', 'pages/jeux/loup-garou.html'),
  ('membre.html', 'pages/compte/membre.html'),
  ('messages.html', 'pages/compte/messages.html'),
  ('monopoly.html', 'pages/jeux/monopoly.html'),
  ('nom-de-code.html', 'pages/jeux/nom-de-code.html'),
  ('pictionary.html', 'pages/jeux/pictionary.html'),
  ('playlist.html', 'pages/irl/playlist.html'),
  ('poker.html', 'pages/jeux/poker.html'),
  ('quiz.html', 'pages/jeux/quiz.html'),
  ('recap.html', 'pages/irl/recap.html'),
  ('rejoindre.html', 'pages/infos/rejoindre.html'),
  ('risk.html', 'pages/jeux/risk.html'),
  ('secret.html', 'pages/jeux/secret.html'),
  ('secret-santa.html', 'pages/irl/secret-santa.html'),
  ('shadow-hunters.html', 'pages/jeux/shadow-hunters.html'),
  ('simulateur.html', 'pages/jeux/simulateur.html'),
  ('uno.html', 'pages/jeux/uno.html')
  ) as m(ancien, neuf)
  where n.lien like 'https://humane-gang.com/' || m.ancien || '%';

-- Notifications déjà écrites avec un lien court (« cartes.html#… ») : même conversion, adresse depuis la racine du site.
update public.hg_site_notifs n set lien = '/' || m.neuf || substr(n.lien, length(m.ancien) + 1)
  from (values
  ('accueil.html', 'pages/compte/accueil.html'),
  ('admin.html', 'pages/admin/admin.html'),
  ('aide.html', 'pages/infos/aide.html'),
  ('assistance.html', 'pages/infos/assistance.html'),
  ('blackjack.html', 'pages/jeux/blackjack.html'),
  ('calendrier.html', 'pages/irl/calendrier.html'),
  ('cartes.html', 'pages/cartes/cartes.html'),
  ('catan.html', 'pages/jeux/catan.html'),
  ('cine.html', 'pages/irl/cine.html'),
  ('citations.html', 'pages/irl/citations.html'),
  ('cluedo.html', 'pages/jeux/cluedo.html'),
  ('collection-a4.html', 'pages/cartes/collection-a4.html'),
  ('compte.html', 'pages/compte/compte.html'),
  ('destins.html', 'pages/jeux/destins.html'),
  ('duels.html', 'pages/jeux/duels.html'),
  ('evenements.html', 'pages/irl/evenements.html'),
  ('historique.html', 'pages/irl/historique.html'),
  ('irl.html', 'pages/irl/irl.html'),
  ('jeux.html', 'pages/jeux/jeux.html'),
  ('legal.html', 'pages/infos/legal.html'),
  ('loup-garou.html', 'pages/jeux/loup-garou.html'),
  ('membre.html', 'pages/compte/membre.html'),
  ('messages.html', 'pages/compte/messages.html'),
  ('monopoly.html', 'pages/jeux/monopoly.html'),
  ('nom-de-code.html', 'pages/jeux/nom-de-code.html'),
  ('pictionary.html', 'pages/jeux/pictionary.html'),
  ('playlist.html', 'pages/irl/playlist.html'),
  ('poker.html', 'pages/jeux/poker.html'),
  ('quiz.html', 'pages/jeux/quiz.html'),
  ('recap.html', 'pages/irl/recap.html'),
  ('rejoindre.html', 'pages/infos/rejoindre.html'),
  ('risk.html', 'pages/jeux/risk.html'),
  ('secret.html', 'pages/jeux/secret.html'),
  ('secret-santa.html', 'pages/irl/secret-santa.html'),
  ('shadow-hunters.html', 'pages/jeux/shadow-hunters.html'),
  ('simulateur.html', 'pages/jeux/simulateur.html'),
  ('uno.html', 'pages/jeux/uno.html')
  ) as m(ancien, neuf)
  where n.lien like m.ancien || '%' and substr(n.lien, length(m.ancien) + 1, 1) in ('', '#', '?');

-- Réglages : la page des pronostics (saisons.worlds.pronos) et les libellés du menu gardent leur forme courte
-- « page.html#onglet » (validée par la base, convertie à l'affichage ; les anciennes adresses sont redirigées par 404.html).

-- Libellés du menu (site_textes.nav_libelles) : inchangés, la clé reste « page.html#onglet » (core/menu-def.js, menuKey).

-- ---------------------------------------------------------------------
-- 2. Fonctions (textes remplacés ; la signature et la logique ne changent pas)
-- ---------------------------------------------------------------------
-- Notifications du site : seul un lien absolu ou un chemin /pages/<cat>/… est gardé.
-- La forme courte « page.html » reste acceptée (anciennes fonctions qui l'écrivent : redirigée par 404.html).
select public.hg__rangement_tout('hg_site_notif', $o$'^[a-z0-9-]+\.html'$o$, $o$'^(/pages/[a-z]+/)?[a-z0-9-]+\.html'$o$);

-- Calendrier : liens des événements (sortie, ciné, calendrier, anniversaires, Secret Santa, événements).
select public.hg__rangement_tout('hg_calendar_items', $o$'irl.html#event-'$o$, $o$'/pages/irl/irl.html#event-'$o$);
select public.hg__rangement_tout('hg_calendar_items', $o$'cine.html'$o$, $o$'/pages/irl/cine.html'$o$);
select public.hg__rangement_tout('hg_calendar_items', $o$'calendrier.html'$o$, $o$'/pages/irl/calendrier.html'$o$);
select public.hg__rangement_tout('hg_calendar_items', $o$'membre.html?id='$o$, $o$'/pages/compte/membre.html?id='$o$);
select public.hg__rangement_tout('hg_calendar_items', $o$'secret-santa.html'$o$, $o$'/pages/irl/secret-santa.html'$o$);
select public.hg__rangement_tout('hg_calendar_items', $o$'evenements.html'$o$, $o$'/pages/irl/evenements.html'$o$);

-- Images : validation (chemin local /assets/…) et illustration des champions.
select public.hg__rangement_tout('hg_event_card_set', $o$'^(https://|assets/)'$o$, $o$'^(https://|/assets/)'$o$);
select public.hg__rangement_tout('hg_card_proposal_review', $o$'^(https://|assets/)'$o$, $o$'^(https://|/assets/)'$o$);
select public.hg__rangement_tout('hg_champion_review', $o$'assets/cards/champions/'$o$, $o$'/assets/cartes/champions/'$o$);

-- Saisons : liens des rappels de l'avent / du déballage.
select public.hg__rangement_tout('hg_saisons_bot_due', $o$'accueil.html#avent'$o$, $o$'/pages/compte/accueil.html#avent'$o$);
select public.hg__rangement_tout('hg_saisons_bot_due', $o$'secret-santa.html#deballage'$o$, $o$'/pages/irl/secret-santa.html#deballage'$o$);
select public.hg__rangement_tout('hg_saisons_bot_due', $o$'recap.html?retro=1'$o$, $o$'/pages/irl/recap.html?retro=1'$o$);

-- ---------------------------------------------------------------------
-- 3. Contrôle : plus aucun ancien chemin dans les données ni dans les fonctions touchées
-- ---------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from public.hg_cards where image_url like 'assets/cards/%';
  if n > 0 then raise exception 'rangement : % cartes gardent un ancien chemin', n; end if;
  select count(*) into n from public.hg_site_notifs where lien ~ 'humane-gang\.com/[a-z0-9-]+\.html';
  if n > 0 then raise exception 'rangement : % notifications gardent un ancien lien', n; end if;
  select count(*) into n from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('hg_calendar_items', 'hg_saisons_bot_due', 'hg_site_notif', 'hg_champion_review')
      and (p.prosrc ~ '''[a-z0-9-]+\.html' or p.prosrc ~ '''assets/cards/');
  if n > 0 then raise exception 'rangement : % fonctions gardent un ancien chemin', n; end if;
end $$;

drop function public.hg__rangement_tout(text, text, text);
