#!/bin/bash
set -e

PGDATA=/data/postgres
PG_BIN=/usr/lib/postgresql/16/bin

if [ -z "$(ls -A "$PGDATA" 2>/dev/null)" ]; then
  gosu postgres "$PG_BIN/initdb" -D "$PGDATA" --no-sync --auth-local=trust --auth-host=md5

  {
    echo "host all all 0.0.0.0/0 md5"
    echo "host all all ::/0 md5"
  } >> "$PGDATA/pg_hba.conf"

  echo "shared_preload_libraries = 'pg_stat_statements'" >> "$PGDATA/postgresql.conf"
  echo "pg_stat_statements.track = all" >> "$PGDATA/postgresql.conf"

  gosu postgres "$PG_BIN/pg_ctl" -D "$PGDATA" start -w \
    -o "-c listen_addresses=127.0.0.1 -c shared_preload_libraries=pg_stat_statements"

  gosu postgres psql -c "ALTER USER postgres PASSWORD 'PASSWORD-PLACEHOLDER--uqfEC1hmmv';"
  gosu postgres psql -c "CREATE DATABASE stackframe;"
  gosu postgres psql -c "CREATE DATABASE svix;"
  gosu postgres psql -d stackframe -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"
  gosu postgres psql -d stackframe -c "CREATE ROLE anon NOLOGIN;"
  gosu postgres psql -d stackframe -c "CREATE ROLE authenticated NOLOGIN;"

  gosu postgres "$PG_BIN/pg_ctl" -D "$PGDATA" stop -w
fi

# Generate a fresh CRON_SECRET per container start. The cron endpoints are
# internal — nothing outside the container calls them — so we don't want the
# baked-in mock value from .env.development to be a usable credential against
# a running emulator. Overriding here propagates to both the backend and the
# run-cron-jobs.sh loop via supervisord's inherited environment.
export CRON_SECRET="$(openssl rand -hex 32)"

exec /usr/bin/supervisord -n -c /etc/supervisor/conf.d/supervisord.conf
