#!/bin/bash
# Démarre PostgreSQL local s'il ne répond pas
psql -h /tmp -p 54329 -U postgres -c "select 1" >/dev/null 2>&1 && exit 0
rm -f /tmp/.s.PGSQL.54329* /home/postgres/pg/data/postmaster.pid
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /home/postgres/pg/data -o '-p 54329 -k /tmp' -l /home/postgres/pg/log start" >/dev/null; sleep 2
