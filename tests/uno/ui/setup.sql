-- Interface : la page « uno » passe en « liste » avec accès pour les joueurs 2 à 12 (le 13 reste dehors), pseudos et couleurs.
update hg_pages set mode = 'liste' where slug = 'uno';
insert into hg_page_access(page_slug, user_id, allowed) select 'uno', t_uid(i), true from generate_series(2, 12) i on conflict do nothing;
update hg_profiles set color = (array['#E8B04B','#6FB3F2','#7E93C9','#6FA77A','#B07ED0','#5BB8C9','#D98E5A','#9AA65A','#C95B5B','#5A7FD9','#D0A0C0','#80C0A0','#AAAAAA'])[right(id::text,2)::int],
  pseudo = (array['Domu','Wae','Lila','Kaïs','Nox','Sacha','Mélo','Tilo','Rubis','Azur','Perle','Sauge','Intrus'])[right(id::text,2)::int]
  where right(id::text,2)::int <= 13;
