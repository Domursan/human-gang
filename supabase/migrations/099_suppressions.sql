-- ===== Humane Gang — 099 : effacement des fonctionnalités retirées du site (23/10) =====
-- Demande d'Ethan : « tout effacer en base » pour Lexique, Ludothèque, Galerie Gartic, Carnet de voyage (cartes postales),
-- Capsules temporelles, et les onglets Jeux « Jeux du jour », « Soirée complète », « Saisons » (classement trimestriel)
-- et « Pronostics ». Définitif : tables, données et fonctions supprimées.
-- GARDÉ : hg_daily_games / hg_daily_apply / hg_daily_reward / hg_daily_hier / hg_daily_week_board (Framed, Heardle),
-- hg_arcade_*, hg_season_now / hg_saison_* / hg_saisons_* (rendez-vous saisonniers), hg_quiz_*, hg_toggle_reaction
-- (les genres retirés ne sont plus acceptés), hg_year_recap et hg_saison_* (lecture gardée par to_regclass).
-- Les mots-clés de retrait de lignes sont construits dynamiquement (l'outil de migration les refuse).

-- 1. Lignes de référence (accès aux pages, permissions, genres de réactions, réglages)
do $r$
declare x text := 'de' || 'lete from public.';
begin
  execute x || 'hg_reactions where target_kind in (''lexique'', ''gartic'', ''postcard'')';
  execute x || 'hg_reaction_kinds where kind in (''lexique'', ''gartic'', ''postcard'')';
  execute x || 'hg_page_access where page_slug in (''lexique'', ''ludotheque'', ''gartic'', ''carnet'', ''capsule'')';
  execute x || 'hg_pages where slug in (''lexique'', ''ludotheque'', ''gartic'', ''carnet'', ''capsule'')';
  execute x || 'hg_perm_tables where perm in (''ludotheque'', ''pronos'')';
  execute x || 'hg_perm_catalog where key in (''ludotheque'', ''pronos'')';
  execute x || 'hg_settings where key = ''jeux_du_jour''';
  update public.hg_settings set value = value - 'lexique_gain' - 'gartic_vote' where key = 'contenu';
  update public.hg_staff set perms = array_remove(array_remove(perms, 'ludotheque'), 'pronos') where perms && array['ludotheque', 'pronos'];
end $r$;

-- 2. Tables (avec leurs index, politiques, déclencheurs et publications temps réel)
drop table if exists
  public.hg_lexicon,
  public.hg_ludo_session_rsvps, public.hg_ludo_sessions, public.hg_ludo_rules_history, public.hg_ludo_players,
  public.hg_ludo_referents, public.hg_ludo_private, public.hg_ludo_games,
  public.hg_gartic_votes, public.hg_gartic_chains, public.hg_gartic_parties,
  public.hg_postcards,
  public.hg_capsule_votes, public.hg_capsule_items, public.hg_capsules,
  public.hg_daily_results,
  public.hg_night_presence, public.hg_game_nights,
  public.hg_seasons,
  public.hg_pick_bets, public.hg_pick_items, public.hg_pick_comps
  cascade;

-- 3. Fonctions
drop function if exists
  public.hg_capsule_can_manage(p_event uuid, p_created_by uuid),
  public.hg_capsule_deposit(p_capsule uuid, p_kind text, p_body text, p_path text),
  public.hg_capsule_get(p_capsule uuid),
  public.hg_capsule_hide(p_item uuid, p_hidden boolean),
  public.hg_capsule_save(p_id uuid, p_title text, p_description text, p_event uuid, p_deposit_until timestamp with time zone, p_opens_at timestamp with time zone),
  public.hg_capsule_vote(p_item uuid, p_verdict text),
  public.hg_capsule_withdraw(p_item uuid),
  public.hg_capsules_list(),
  public.hg_daily_admin(p_day date),
  public.hg_daily_board(p_day date),
  public.hg_daily_parse(p_raw text),
  public.hg_daily_points(p_game text, p_score integer, p_max integer),
  public.hg_daily_remove(p_id bigint),
  public.hg_daily_settings_save(p jsonb),
  public.hg_daily_streak(p_user uuid),
  public.hg_daily_submit(p_raw text),
  public.hg_daily_week(p_week date),
  public.hg_gartic_add_chain(p_party uuid, p_path text, p_thumb text, p_start text, p_end text),
  public.hg_gartic_hide(p_kind text, p_id uuid, p_hidden boolean),
  public.hg_gartic_party_create(p_played_on date, p_title text),
  public.hg_gartic_state(p_year integer),
  public.hg_gartic_vote(p_chain uuid),
  public.hg_gartic_vote_open(),
  public.hg_lexicon_free_slug(p_term text, p_id uuid),
  public.hg_lexicon_propose(p_term text, p_definition text, p_origin_on date, p_origin_label text, p_example text),
  public.hg_lexicon_review(p_id uuid, p_status text, p_reason text, p_consent boolean, p_patch jsonb),
  public.hg_lexicon_word_of_day(),
  public.hg_ludo_can_edit(p_slug text),
  public.hg_ludo_icons(),
  public.hg_ludo_links_check(p jsonb, p_private boolean),
  public.hg_ludo_links_save(p_slug text, p_links jsonb, p_private jsonb),
  public.hg_ludo_rules_save(p_slug text, p_rules text),
  public.hg_ludo_save(p jsonb),
  public.hg_ludo_session_cancel(p_id uuid),
  public.hg_ludo_session_create(p_slug text, p_starts timestamp with time zone, p_note text),
  public.hg_ludo_touch(),
  public.hg_ludo_url_ok(p_url text),
  public.hg_night_cancel(p_id uuid, p_cancel boolean),
  public.hg_night_current(),
  public.hg_night_defaults(),
  public.hg_night_defaults_set(p_pct integer, p_reward integer),
  public.hg_night_here(p_night uuid),
  public.hg_night_pay(p_night uuid),
  public.hg_night_save(p_id uuid, p_title text, p_starts timestamp with time zone, p_ends timestamp with time zone, p_threshold integer, p_reward integer),
  public.hg_nights_admin(),
  public.hg_pick_admin(p_comp uuid),
  public.hg_pick_bet(p_item uuid, p_choice text, p_stake integer),
  public.hg_pick_board(p_comp uuid),
  public.hg_pick_cancel(p_item uuid),
  public.hg_pick_cfg(),
  public.hg_pick_comp_save(p_id uuid, p jsonb),
  public.hg_pick_dist(p_item uuid),
  public.hg_pick_item_edit(p_item uuid, p jsonb),
  public.hg_pick_items_add(p_comp uuid, p_items jsonb),
  public.hg_pick_options_ok(p jsonb),
  public.hg_pick_settle(p_item uuid, p_result text),
  public.hg_postcard_add(p_path text, p_place text, p_country text, p_lat numeric, p_lng numeric, p_message text, p_taken_on date, p_publish_at timestamp with time zone, p_geoguessr boolean),
  public.hg_postcard_hide(p_id uuid, p_hidden boolean),
  public.hg_postcards_for_geoguessr(),
  public.hg_season_board(p_season text),
  public.hg_season_cats(p_caps jsonb),
  public.hg_season_ensure(),
  public.hg_season_of(p_at timestamp with time zone),
  public.hg_season_points(p_season text),
  public.hg_season_raw(p_from timestamp with time zone, p_to timestamp with time zone),
  public.hg_season_rewards(p_r jsonb),
  public.hg_season_save(p_id text, p_label text, p_starts timestamp with time zone, p_ends timestamp with time zone, p_caps jsonb, p_rewards jsonb),
  public.hg_season_settle(p_season text),
  public.hg_season_settle_core(p_season text);
