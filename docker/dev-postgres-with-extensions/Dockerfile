FROM postgres:15

RUN apt-get update && apt-get install -y \
    git \
    build-essential \
    libpq-dev \
    postgresql-server-dev-15

# Install HypoPG
RUN git clone https://github.com/HypoPG/hypopg.git /hypopg
RUN cd /hypopg && make install

# Install index_advisor
RUN git clone https://github.com/supabase/index_advisor.git /index_advisor
RUN cd /index_advisor && make install

# Write initialization SQL
RUN echo "CREATE EXTENSION pg_stat_statements;" >> /docker-entrypoint-initdb.d/init.sql
RUN echo "CREATE EXTENSION hypopg;" >> /docker-entrypoint-initdb.d/init.sql
RUN echo "CREATE EXTENSION index_advisor;" >> /docker-entrypoint-initdb.d/init.sql
RUN echo "CREATE ROLE anon;" >> /docker-entrypoint-initdb.d/init.sql
RUN echo "CREATE ROLE authenticated;" >> /docker-entrypoint-initdb.d/init.sql

# Create a read-only user for read replica emulation in development
RUN echo "CREATE USER readonly WITH PASSWORD 'PASSWORD-PLACEHOLDER--readonlyuqfEC1hmmv';" >> /docker-entrypoint-initdb.d/init.sql
RUN echo "GRANT CONNECT ON DATABASE stackframe TO readonly;" >> /docker-entrypoint-initdb.d/init.sql
RUN echo "GRANT USAGE ON SCHEMA public TO readonly;" >> /docker-entrypoint-initdb.d/init.sql
RUN echo "GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly;" >> /docker-entrypoint-initdb.d/init.sql
RUN echo "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO readonly;" >> /docker-entrypoint-initdb.d/init.sql

# Add args to Postgres entrypoint
ENTRYPOINT ["sh", "-c", "\
  # Add delay if POSTGRES_DELAY_MS is set \
  if [ $POSTGRES_DELAY_MS -gt 0 ]; then \
    apt-get update && apt-get install -y iproute2 && tc qdisc add dev eth0 root netem delay ${POSTGRES_DELAY_MS}ms; \
  fi; \
  \
  # Start Postgres with extensions enabled \
  exec docker-entrypoint.sh postgres -c shared_preload_libraries='pg_stat_statements' -c pg_stat_statements.track=all \
"]
