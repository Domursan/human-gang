#!/bin/bash
# Vérifie que le PostgreSQL des bancs répond (voir pg-env.sh). S'il ne répond pas et que HG_PG_DATA désigne un dossier
# de données local, le démarre (HG_PG_BIN : dossier des binaires, par défaut /usr/lib/postgresql/16/bin, lancé en
# tant que l'utilisateur postgres). Sinon, indique quoi faire et échoue.
. "$(dirname "$0")/../pg-env.sh"
psql -X -c "select 1" >/dev/null 2>&1 && exit 0
if [ -z "$HG_PG_DATA" ]; then
  echo "PostgreSQL ne répond pas sur $PGHOST:$PGPORT. Lancer un serveur (service postgres:16 en CI) ou définir HG_PG_DATA (dossier de données local) pour le démarrer." >&2
  exit 1
fi
PG_BIN="${HG_PG_BIN:-/usr/lib/postgresql/16/bin}"
[ -d "$PGHOST" ] && rm -f "$PGHOST"/.s.PGSQL."$PGPORT"* "$HG_PG_DATA/postmaster.pid"
su postgres -c "$PG_BIN/pg_ctl -D '$HG_PG_DATA' -o '-p $PGPORT -k $PGHOST' -l '$(dirname "$HG_PG_DATA")/log' start" >/dev/null
sleep 2
