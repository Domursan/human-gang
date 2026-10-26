-- ===== Humane Gang — migration 131 : robots dans les jeux de plateau (tests d'un administrateur seul), et « Nom de code » renommé « Codenames » =====
-- Un administrateur hôte d'une salle d'attente peut y ajouter des robots : joueurs sans compte, toujours prêts,
-- marqués absents dès le départ. Le jeu joue donc pour eux au bout de 5 secondes, avec les coups automatiques
-- habituels (prudents : ils n'accusent pas au Cluedo, n'attaquent pas à Shadow Hunters ni au Risk).
-- Les robots ne gagnent ni Paillettes ni badges (pas de profil). On les retire comme un joueur (bouton ×).

create or replace function public.hg_plat_ajouter_robot(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; v_n int;
begin
  if not hg_is_admin() then raise exception 'Réservé aux administrateurs.' using errcode = '42501'; end if;
  p := hg_plat__partie(p_code, true);
  if p.hote <> auth.uid() then raise exception 'Seul l''hôte peut ajouter un robot.'; end if;
  if p.statut <> 'attente' then raise exception 'La partie a déjà commencé.'; end if;
  select count(*) into v_n from hg_plat_joueurs where partie = p.id;
  if v_n >= p.nb_places then raise exception 'La partie est complète (% places).', p.nb_places; end if;
  insert into hg_plat_joueurs(partie, user_id, pseudo, couleur, invite, place, pret, absent)
  values (p.id, gen_random_uuid(),
          'Robot ' || (select count(*) + 1 from hg_plat_joueurs where partie = p.id and pseudo like 'Robot %'),
          '#8A8F98', true, coalesce((select max(place) from hg_plat_joueurs where partie = p.id), 0) + 1, true, true);
  perform hg_plat__log(p.id, null, 'info', 'Un robot rejoint la partie.');
  perform hg_plat__bump(p.id);
end $$;

revoke all on function public.hg_plat_ajouter_robot(text) from public, anon;
grant execute on function public.hg_plat_ajouter_robot(text) to authenticated;

/* ---------- « Nom de code » devient « Codenames » (textes visibles ; identifiants et adresses inchangés) ---------- */
update public.hg_pages set label = 'Codenames' where slug = 'nom-de-code';
update public.hg_badges set description = replace(replace(description, 'au Nom de code', 'à Codenames'), 'Nom de code', 'Codenames')
  where code like 'ndc\_%';
do $$
declare v text;
begin
  v := pg_get_functiondef('public.hg_ndc_creer(jsonb)'::regprocedure);
  if position('Partie de Nom de code' in v) > 0 then execute replace(v, 'Partie de Nom de code', 'Partie de Codenames'); end if;
end $$;
