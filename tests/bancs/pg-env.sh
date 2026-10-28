# Connexion PostgreSQL commune aux bancs SQL (sourcée par les rebuild.sh, run.sh et start.sh de chaque banc).
# Par défaut : le serveur local, socket dans /tmp, port 54329, utilisateur postgres. Pour un autre serveur (service
# postgres:16 de la CI, par exemple), définir PGHOST, PGPORT, PGUSER et PGPASSWORD avant de lancer le banc.
export PGHOST="${PGHOST:-/tmp}" PGPORT="${PGPORT:-54329}" PGUSER="${PGUSER:-postgres}"
