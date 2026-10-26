-- ===== Humane Gang — migration 150 : accès des nouveaux jeux réglables dans « Accès aux pages » =====
-- Chaque nouveau jeu a sa ligne dans hg_pages (mode 'admin' au départ, hors menu) : l'admin l'ouvre à tous ('membres')
-- ou à une liste ('liste') dans le panel, comme une page. Slugs :
--   jeux du jour et grilles : nj-<jeu> (nj-carte, nj-jv, nj-pochette, nj-replique, nj-pays, nj-plat, nj-connexions,
--     nj-motscroises, nj-motmele, nj-anagramme, nj-nerdle) ; solo : nj-demineur, nj-sudoku, nj-2048 ;
--   arcade : arcade-<jeu> (flappy, briques, snake, tetris, invaders, taupe) ; duels : duel-<jeu> (dames, echecs, othello, pfc) ;
--   jeux de plateau : leur page (blackjack, poker, catan, pictionary, déjà déclarées par la migration 143).
-- hg_nj_acces(p_jeu) = hg_page_ok(moi, slug du jeu) remplace hg_nj_acces() (admins seulement) dans toutes les fonctions.
insert into public.hg_pages(slug, label, mode, in_nav, sort) values
  ('nj-carte', 'Jeu · Carte mystère', 'admin', false, 40), ('nj-jv', 'Jeu · Jeu vidéo du jour', 'admin', false, 41),
  ('nj-pochette', 'Jeu · Pochette du jour', 'admin', false, 42), ('nj-replique', 'Jeu · Réplique du jour', 'admin', false, 43),
  ('nj-pays', 'Jeu · Pays du jour', 'admin', false, 44), ('nj-plat', 'Jeu · Plat du jour', 'admin', false, 45),
  ('nj-connexions', 'Jeu · Connexions', 'admin', false, 46), ('nj-motscroises', 'Jeu · Mots croisés', 'admin', false, 47),
  ('nj-motmele', 'Jeu · Mot mêlé', 'admin', false, 48), ('nj-anagramme', 'Jeu · Anagramme', 'admin', false, 49),
  ('nj-nerdle', 'Jeu · Nerdle du gang', 'admin', false, 50), ('nj-demineur', 'Jeu · Démineur', 'admin', false, 51),
  ('nj-sudoku', 'Jeu · Sudoku du jour', 'admin', false, 52), ('nj-2048', 'Jeu · 2048 Paillettes', 'admin', false, 53),
  ('arcade-flappy', 'Arcade · Flappy Domu', 'admin', false, 54), ('arcade-briques', 'Arcade · Casse-briques', 'admin', false, 55),
  ('arcade-snake', 'Arcade · Snake', 'admin', false, 56), ('arcade-tetris', 'Arcade · Tetris du gang', 'admin', false, 57),
  ('arcade-invaders', 'Arcade · Space Invaders', 'admin', false, 58), ('arcade-taupe', 'Arcade · Tape-taupe', 'admin', false, 59),
  ('duel-dames', 'Duel · Dames', 'admin', false, 60), ('duel-echecs', 'Duel · Échecs', 'admin', false, 61),
  ('duel-othello', 'Duel · Othello', 'admin', false, 62), ('duel-pfc', 'Duel · Pierre-feuille-ciseaux', 'admin', false, 63)
on conflict (slug) do nothing;

-- Slug de la page d'accès d'un jeu (identifiant interne du jeu → slug de hg_pages).
create or replace function public.hg_nj__page(p_jeu text)
returns text language sql immutable set search_path = public as $$
  select case
    when p_jeu in ('flappy', 'briques', 'snake', 'tetris', 'invaders', 'taupe') then 'arcade-' || p_jeu
    when p_jeu in ('dames', 'echecs', 'othello', 'pfc') then 'duel-' || p_jeu
    when p_jeu in ('blackjack', 'poker', 'catan', 'pictionary') then p_jeu
    else 'nj-' || p_jeu end $$;

-- Vrai si le compte connecté peut jouer à ce jeu (réglage « Accès aux pages » ; un admin a toujours accès).
create or replace function public.hg_nj_acces(p_jeu text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.hg_page_ok(auth.uid(), public.hg_nj__page(p_jeu)) $$;
revoke all on function public.hg_nj__page(text), public.hg_nj_acces(text) from public, anon;
grant execute on function public.hg_nj__page(text), public.hg_nj_acces(text) to authenticated;

-- Raccordement : chaque fonction vérifie l'accès du jeu concerné.
select public.hg__patch('public.hg_arcade_pick(text)'::regprocedure,
  $o$and public.hg_nj_acces() then p_game$o$, $n$and public.hg_nj_acces(p_game) then p_game$n$);

select public.hg__patch(f::regprocedure,
  $o$if not hg_nj_acces() then raise exception 'Jeu en développement : réservé aux admins pour l''instant.'; end if;$o$,
  $n$if not hg_nj_acces(p_jeu) then raise exception 'Ce jeu n''est pas encore ouvert pour toi.'; end if;$n$)
from unnest(array['public.hg_nj_etat(text)', 'public.hg_nj_essai(text, text)', 'public.hg_nj_solo_etat(text, text)',
  'public.hg_nj_solo_debut(text, text)', 'public.hg_nj_grille_etat(text)', 'public.hg_nj_grille_essai(text, jsonb)']) f;

select public.hg__patch('public.hg_nj_solo_fin(uuid, jsonb)'::regprocedure,
  $o$  if not hg_nj_acces() then raise exception 'Jeu en développement : réservé aux admins pour l''instant.'; end if;
  perform hg_eco_lock(me);
  select * into r from hg_nj_solo where id = p_run and user_id = me for update;
  if not found then raise exception 'Partie introuvable'; end if;$o$,
  $n$  perform hg_eco_lock(me);
  select * into r from hg_nj_solo where id = p_run and user_id = me for update;
  if not found then raise exception 'Partie introuvable'; end if;
  if not hg_nj_acces(r.jeu) then raise exception 'Ce jeu n''est pas encore ouvert pour toi.'; end if;$n$);

select public.hg__patch('public.hg_duel_creer(jsonb)'::regprocedure,
  $o$if v_jeu in ('dames', 'echecs', 'othello', 'pfc') and not hg_nj_acces() then raise exception 'Jeu en développement : réservé aux admins pour l''instant.'; end if;$o$,
  $n$if v_jeu in ('dames', 'echecs', 'othello', 'pfc') and not hg_nj_acces(v_jeu) then raise exception 'Ce jeu n''est pas encore ouvert pour toi.'; end if;$n$);

select public.hg__patch('public.hg_duel_rejoindre(text)'::regprocedure,
  $o$  if exists (select 1 from hg_duel_parties x where x.code = upper(btrim(p_code)) and x.jeu in ('dames', 'echecs', 'othello', 'pfc') and x.statut = 'attente')
     and not hg_nj_acces() then
    raise exception 'Jeu en développement : réservé aux admins pour l''instant.';$o$,
  $n$  if exists (select 1 from hg_duel_parties x where x.code = upper(btrim(p_code)) and x.jeu in ('dames', 'echecs', 'othello', 'pfc') and x.statut = 'attente'
       and not hg_nj_acces(x.jeu)) then
    raise exception 'Ce jeu n''est pas encore ouvert pour toi.';$n$);

select public.hg__patch('public.hg_plat_creer(jsonb)'::regprocedure,
  $o$if v_jeu in ('blackjack', 'poker', 'catan', 'pictionary') and not hg_nj_acces() then raise exception 'Jeu en développement : réservé aux admins pour l''instant.'; end if;$o$,
  $n$if v_jeu in ('blackjack', 'poker', 'catan', 'pictionary') and not hg_nj_acces(v_jeu) then raise exception 'Ce jeu n''est pas encore ouvert pour toi.'; end if;$n$);

-- Plus aucune fonction n'utilise l'ancienne version sans paramètre.
do $d$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.prosrc ~ 'hg_nj_acces\(\s*\)') then
    raise exception 'hg_nj_acces() encore utilisée : %', (select string_agg(p.proname, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosrc ~ 'hg_nj_acces\(\s*\)');
  end if;
end $d$;
drop function if exists public.hg_nj_acces();
