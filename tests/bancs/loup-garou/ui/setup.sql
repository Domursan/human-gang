-- Interface : la page passe en « liste » avec accès pour les joueurs 2 à 12 (le joueur 13 reste dehors).
update hg_pages set mode = 'liste' where slug = 'loup-garou';
insert into hg_page_access(page_slug, user_id, allowed) select 'loup-garou', t_uid(i), true from generate_series(2, 12) i on conflict do nothing;
update hg_profiles set color = (array['#E8B04B','#7E93C9','#C9677E','#6FA77A','#B07ED0','#5BB8C9','#D98E5A','#9AA65A','#C95B5B','#5A7FD9','#D0A0C0','#80C0A0','#AAAAAA'])[right(id::text,2)::int],
  pseudo = (array['Domursan','Lila','Brume','Kaïs','Nox','Sacha','Mélo','Tilo','Rubis','Azur','Perle','Sauge','Intrus'])[right(id::text,2)::int];
