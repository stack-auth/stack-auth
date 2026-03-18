# Stack Auth Local Emulator — All-in-One Dependencies Image
# Packages: PostgreSQL 16, Redis 7, Inbucket, Svix, ClickHouse, MinIO, QStash

FROM inbucket/inbucket:3.1.0 AS inbucket-bin
FROM svix/svix-server:latest AS svix-bin
FROM clickhouse/clickhouse-server:25.10 AS clickhouse-bin
FROM minio/minio:latest AS minio-bin
FROM minio/mc:latest AS mc-bin

FROM bgodil/qstash:latest AS qstash-bin
RUN cp $(which qstash) /qstash-binary 2>/dev/null || \
    cp $(find / -name 'qstash' -type f -executable 2>/dev/null | head -1) /qstash-binary || \
    { echo "ERROR: qstash binary not found" >&2; exit 1; }

FROM debian:trixie-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      gnupg2 \
      lsb-release \
      curl \
      ca-certificates \
    && echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      | gpg --dearmor -o /etc/apt/trusted.gpg.d/postgresql.gpg \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
      postgresql-16 \
      postgresql-client-16 \
      redis-server \
      supervisor \
      gosu \
      procps \
      libssl3 \
    && rm -rf /var/lib/apt/lists/*

# Inbucket
COPY --from=inbucket-bin /opt/inbucket /opt/inbucket

# Svix
COPY --from=svix-bin /usr/local/bin/svix-server /usr/local/bin/svix-server

# ClickHouse
COPY --from=clickhouse-bin /usr/bin/clickhouse /usr/bin/clickhouse
RUN ln -sf /usr/bin/clickhouse /usr/bin/clickhouse-server && \
    ln -sf /usr/bin/clickhouse /usr/bin/clickhouse-client

# MinIO
COPY --from=minio-bin /usr/bin/minio /usr/local/bin/minio
COPY --from=mc-bin /usr/bin/mc /usr/local/bin/mc

# QStash
COPY --from=qstash-bin /qstash-binary /usr/local/bin/qstash
RUN chmod +x /usr/local/bin/qstash

RUN mkdir -p \
    /data/postgres \
    /data/redis \
    /data/clickhouse \
    /data/clickhouse/access \
    /data/clickhouse/tmp \
    /data/clickhouse/user_files \
    /data/clickhouse/format_schemas \
    /data/minio \
    /data/inbucket \
    /var/log/supervisor \
    /var/log/clickhouse \
    /etc/clickhouse-server \
  && chown -R postgres:postgres /data/postgres

COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY entrypoint.sh /entrypoint.sh
COPY init-services.sh /init-services.sh
COPY clickhouse-config.xml /etc/clickhouse-server/config.xml
COPY clickhouse-users.xml /etc/clickhouse-server/users.xml
RUN chmod +x /entrypoint.sh /init-services.sh

# PostgreSQL: 5432, Redis: 6379, Inbucket: 2500/9001/1100,
# Svix: 8071, ClickHouse: 8123/9009, MinIO: 9090, QStash: 8080
EXPOSE 5432 6379 2500 9001 1100 8071 8123 9009 9090 8080

ENTRYPOINT ["/entrypoint.sh"]
