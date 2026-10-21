/* Intro déjà vue : on file directement à l'accueil, avant tout rendu. */
try { if (localStorage.getItem('hg_intro_seen')) location.replace('accueil.html'); } catch (e) {}
