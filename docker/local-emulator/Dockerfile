# Stack Auth Local Emulator — All-in-One Image
# Packages: PostgreSQL 16, Redis 7, Inbucket, Svix, ClickHouse, MinIO, QStash
# + built Stack Auth backend and dashboard

ARG NODE_VERSION=22.21.1

# ── Node.js build stages ──────────────────────────────────────────────────────

FROM node:${NODE_VERSION} AS node-base

WORKDIR /app

RUN apt-get update && \
    apt-get upgrade -y && \
    rm -rf /var/lib/apt/lists

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable
RUN corepack prepare pnpm@10.23.0 --activate
RUN pnpm add -g turbo
RUN pnpm add -g tsx


FROM node-base AS pruner

COPY . .

RUN tsx ./scripts/generate-sdks.ts

# https://turbo.build/repo/docs/guides/tools/docker
RUN turbo prune --scope=@stackframe/backend --scope=@stackframe/dashboard --docker


FROM node-base AS builder

# copy over package.json files and install dependencies
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml .
COPY .gitignore .
COPY pnpm-workspace.yaml .
COPY turbo.json .
COPY configs ./configs
RUN --mount=type=cache,id=pnpm,target=/pnpm/store STACK_SKIP_TEMPLATE_GENERATION=true pnpm install --frozen-lockfile

# copy over the rest of the code for the build
COPY --from=pruner /app/out/full/ .

# docs are currently required for the NextJS backend build, but won't exist in the final image
COPY docs ./docs

# https://nextjs.org/docs/pages/api-reference/next-config-js/output
ENV NEXT_CONFIG_OUTPUT=standalone
ENV NEXT_PUBLIC_STACK_STRIPE_PUBLISHABLE_KEY=pk_test_mock_publishable_key_for_local_emulator

# Build the backend NextJS app
RUN pnpm turbo run docker-build --filter=@stackframe/backend... --filter=@stackframe/dashboard...

# Build the self-host seed script
RUN cd apps/backend && pnpm build-self-host-migration-script


# Prune node_modules for runtime: remove dev tools, heavy UI packages,
# duplicate framework copies, and native binaries not needed by the
# migration script or server at runtime.
FROM builder AS migration-pruner
RUN cp -a /app/node_modules /pruned-node_modules && \
    cd /pruned-node_modules/.pnpm && \
    rm -rf \
      # Dev tools (never needed at runtime)
      typescript@* eslint@* eslint-*@* @typescript-eslint+*@* \
      prettier@* vitest@* jsdom@* turbo@* turbo-*@* \
      tsdown@* @changesets+*@* codebuff@* \
      @testing-library+*@* vite@* vite-*@* @vitejs+*@* \
      # Heavy UI packages (already traced into Next.js standalone bundles)
      monaco-editor@* \
      three@* three-globe@* globe.gl@* react-globe*@* \
      react-icons@* lucide-react@* @phosphor-icons+*@* \
      # Large optional packages not needed by migration script
      posthog-js@* \
      @prisma+studio-core@* @prisma+dev@* @prisma+query-plan-executor@* \
      convex@* @electric-sql+*@* \
      next@14* @next+swc-*@14* \
      # Native build binaries not needed at runtime
      @esbuild+*@* esbuild@* @rolldown+*@* \
      # Duplicate date-fns versions (keep v4 only)
      date-fns@2* date-fns@3*


# ── Freestyle mock build ─────────────────────────────────────────────────────

FROM node-base AS freestyle-mock-builder
WORKDIR /freestyle-mock
COPY docker/dependencies/freestyle-mock/Dockerfile /tmp/freestyle-mock-dockerfile
# Extract the inline package.json and server.mjs from the Dockerfile's RUN cat commands,
# then install dependencies. This avoids duplicating the source.
RUN node -e " \
  const fs = require('fs'); \
  const df = fs.readFileSync('/tmp/freestyle-mock-dockerfile', 'utf8'); \
  const pkgMatch = df.match(/cat <<'EOF' > package\\.json\\n([\\s\\S]*?)\\nEOF/); \
  fs.writeFileSync('package.json', pkgMatch[1]); \
  const srvMatch = df.match(/cat <<'EOF' > server\\.mjs\\n([\\s\\S]*?)\\nEOF/); \
  let server = srvMatch[1]; \
  server = server.replace('server.listen(8080)', 'server.listen(process.env.PORT || 8080)'); \
  server = server.replace( \
    'from \"fs/promises\"', \
    'from \"fs/promises\"; import { symlinkSync } from \"fs\"' \
  ); \
  server = server.replace( \
    'await mkdir(workDir, { recursive: true });', \
    'await mkdir(workDir, { recursive: true }); try { symlinkSync(\"/app/freestyle-mock/node_modules\", join(workDir, \"node_modules\")); } catch {}' \
  ); \
  fs.writeFileSync('server.mjs', server); \
"
RUN npm install


# ── Mock OAuth server build ───────────────────────────────────────────────────

FROM node-base AS mock-oauth-builder
WORKDIR /mock-oauth
COPY apps/mock-oauth-server/package.json .
RUN pnpm install && pnpm add esbuild --save-dev
COPY apps/mock-oauth-server/src ./src
RUN npx esbuild src/index.ts --bundle --platform=node --target=node22 --outfile=dist/index.cjs


# ── Service binary stages ─────────────────────────────────────────────────────

FROM stripe/stripe-mock:v0.195.0 AS stripe-mock-bin
FROM inbucket/inbucket:3.1.0 AS inbucket-bin
FROM svix/svix-server:v1.88.0 AS svix-bin
FROM clickhouse/clickhouse-server:25.10 AS clickhouse-bin
FROM minio/minio:RELEASE.2025-09-07T16-13-09Z AS minio-bin
FROM minio/mc:RELEASE.2025-02-21T16-00-46Z AS mc-bin

FROM bgodil/qstash:latest AS qstash-bin
RUN cp $(which qstash) /qstash-binary 2>/dev/null || \
    cp $(find / -name 'qstash' -type f -executable 2>/dev/null | head -1) /qstash-binary || \
    { echo "ERROR: qstash binary not found" >&2; exit 1; }


# ── Strip / compress service binaries (parallel stages) ──────────────────────

FROM debian:trixie-slim AS upx-compress
RUN apt-get update && apt-get install -y --no-install-recommends upx-ucl binutils && \
    rm -rf /var/lib/apt/lists/*
COPY --from=clickhouse-bin /usr/bin/clickhouse /out/clickhouse
COPY --from=svix-bin /usr/local/bin/svix-server /out/svix-server
COPY --from=minio-bin /usr/bin/minio /out/minio
COPY --from=mc-bin /usr/bin/mc /out/mc
COPY --from=qstash-bin /qstash-binary /out/qstash
RUN chmod u+w /out/* && \
    # Intentionally NOT stripping /out/clickhouse. The clickhouse binary is a
    # self-extracting compressed executable (a small loader with a ZSTD
    # payload appended after the section table); strip rewrites the ELF and
    # can invalidate the loader's "find my payload" lookup, causing the
    # decompressor to spin on garbage with zero log output — the exact
    # symptom seen on cross-arch TCG runs. Savings from stripping would be
    # only the tiny bootstrap anyway since the payload isn't in any section.
    strip --strip-all /out/minio /out/svix-server /out/mc /out/qstash && \
    upx -9 /out/minio /out/svix-server /out/mc /out/qstash


# ── Final image ───────────────────────────────────────────────────────────────

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
      openssl \
      socat \
    && apt-get purge -y --auto-remove gnupg2 lsb-release \
    && rm -rf /var/lib/apt/lists/* /usr/share/doc /usr/share/man /usr/share/i18n

# Node.js runtime (binary only — app bundles include all JS dependencies)
COPY --from=node-base /usr/local/bin/node /usr/local/bin/node

# Inbucket
COPY --from=inbucket-bin /opt/inbucket /opt/inbucket

# Stripe mock
COPY --from=stripe-mock-bin /bin/stripe-mock /usr/local/bin/stripe-mock

# Svix (UPX-compressed)
COPY --from=upx-compress /out/svix-server /usr/local/bin/svix-server

# ClickHouse (stripped only)
COPY --from=upx-compress /out/clickhouse /usr/bin/clickhouse
RUN ln -sf /usr/bin/clickhouse /usr/bin/clickhouse-server && \
    ln -sf /usr/bin/clickhouse /usr/bin/clickhouse-client

# MinIO (UPX-compressed)
COPY --from=upx-compress /out/minio /usr/local/bin/minio
COPY --from=upx-compress /out/mc /usr/local/bin/mc

# QStash (UPX-compressed)
COPY --from=upx-compress --chmod=755 /out/qstash /usr/local/bin/qstash

# App
WORKDIR /app
COPY --from=builder /app/apps/backend/.next/standalone ./
COPY --from=builder /app/apps/backend/.next/static ./apps/backend/.next/static
COPY --from=builder /app/apps/backend/prisma ./apps/backend/prisma
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=builder /app/apps/dashboard/.next/standalone ./
COPY --from=builder /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=builder /app/apps/dashboard/public ./apps/dashboard/public
# Save the standalone-traced node_modules (runtime deps only) before the full
# migration-pruner copy overwrites it. The slim-docker-image step in the QEMU
# build restores this after migrations are baked in.
RUN cp -a /app/node_modules /app/node_modules.standalone 2>/dev/null || mkdir -p /app/node_modules.standalone
COPY --from=migration-pruner /pruned-node_modules ./node_modules
COPY --from=builder /app/packages ./packages

# Mock OAuth server (bundled single file)
COPY --from=mock-oauth-builder /mock-oauth/dist/index.cjs /app/mock-oauth-server/index.cjs

# Freestyle mock (JS execution for email rendering)
COPY --from=freestyle-mock-builder /freestyle-mock /app/freestyle-mock
COPY --from=node-base /usr/local/bin/npm /usr/local/bin/npm
COPY --from=node-base /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm

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

COPY docker/local-emulator/supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY docker/local-emulator/run-cron-jobs.sh /run-cron-jobs.sh
COPY docker/local-emulator/entrypoint.sh /entrypoint.sh
COPY docker/local-emulator/init-services.sh /init-services.sh
COPY docker/local-emulator/start-app.sh /start-app.sh
COPY docker/local-emulator/rotate-secrets.sh /usr/local/bin/rotate-secrets
COPY docker/local-emulator/clickhouse-config.xml /etc/clickhouse-server/config.xml
COPY docker/local-emulator/clickhouse-users.xml /etc/clickhouse-server/users.xml
COPY docker/server/entrypoint.sh /app-entrypoint.sh
RUN chmod +x /entrypoint.sh /init-services.sh /start-app.sh /app-entrypoint.sh /run-cron-jobs.sh /usr/local/bin/rotate-secrets

# PostgreSQL: 5432, Redis: 6379, Inbucket: 2500/9001/1100,
# Svix: 8071, ClickHouse: 8123/9009, MinIO: 9090, QStash: 8080
# Backend: 8102, Dashboard: 8101, Mock OAuth: 8114
EXPOSE 5432 6379 2500 9001 1100 8071 8123 9009 9090 8080 8101 8102 8114

ENTRYPOINT ["/entrypoint.sh"]
