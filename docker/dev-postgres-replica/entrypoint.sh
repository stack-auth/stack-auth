#!/bin/bash
set -e

# Configuration from environment variables
PRIMARY_HOST="${PRIMARY_HOST:-db}"
PRIMARY_PORT="${PRIMARY_PORT:-5432}"
REPLICATOR_USER="${REPLICATOR_USER:-replicator}"
REPLICATOR_PASSWORD="${REPLICATOR_PASSWORD:-PASSWORD-PLACEHOLDER--replicatorpass}"
RECOVERY_MIN_APPLY_DELAY="${RECOVERY_MIN_APPLY_DELAY:-100ms}"

echo "Starting PostgreSQL replica with ${RECOVERY_MIN_APPLY_DELAY} apply delay..."

# Wait for primary to be ready
echo "Waiting for primary at ${PRIMARY_HOST}:${PRIMARY_PORT}..."
until PGPASSWORD="${REPLICATOR_PASSWORD}" pg_isready -h "${PRIMARY_HOST}" -p "${PRIMARY_PORT}" -U "${REPLICATOR_USER}" 2>/dev/null; do
    echo "Primary not ready yet, waiting..."
    sleep 2
done
echo "Primary is ready!"

# If PGDATA is empty, do a base backup from primary
if [ -z "$(ls -A ${PGDATA} 2>/dev/null)" ]; then
    echo "PGDATA is empty, performing base backup from primary..."
    
    # Perform base backup
    PGPASSWORD="${REPLICATOR_PASSWORD}" pg_basebackup \
        -h "${PRIMARY_HOST}" \
        -p "${PRIMARY_PORT}" \
        -U "${REPLICATOR_USER}" \
        -D "${PGDATA}" \
        -Fp \
        -Xs \
        -P \
        -R
    
    echo "Base backup completed!"
    
    # Configure recovery settings with apply delay
    cat >> "${PGDATA}/postgresql.auto.conf" <<EOF

# Replica configuration
primary_conninfo = 'host=${PRIMARY_HOST} port=${PRIMARY_PORT} user=${REPLICATOR_USER} password=${REPLICATOR_PASSWORD}'
recovery_min_apply_delay = ${RECOVERY_MIN_APPLY_DELAY}
hot_standby = on

# pg_stat_statements for query stats
shared_preload_libraries = 'pg_stat_statements'
pg_stat_statements.track = all
EOF
    
    # Create standby.signal to indicate this is a standby
    touch "${PGDATA}/standby.signal"
    
    # Set proper permissions
    chmod 700 "${PGDATA}"
    chown -R postgres:postgres "${PGDATA}"
    
    echo "Replica configured with ${RECOVERY_MIN_APPLY_DELAY} apply delay"
else
    echo "PGDATA already initialized, starting replica..."
fi

# Start PostgreSQL
exec gosu postgres postgres
