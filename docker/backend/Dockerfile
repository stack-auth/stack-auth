# Backend only, no migrations or entrypoint script.
# Connects to the same AWS services (RDS, S3, KMS) as the Vercel deployment.
#
# Build:  docker build -f docker/backend/Dockerfile -t stack-backend .
# Run:    docker run -p 8102:8102 --env-file .env stack-backend

ARG NODE_VERSION=22.21.1

# Base
FROM node:${NODE_VERSION} AS base

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


# Prune stage
FROM base AS pruner

COPY . .

RUN tsx ./scripts/generate-sdks.ts

# Only prune backend (no dashboard)
RUN turbo prune --scope=@stackframe/backend --docker


# Build stage
FROM base AS builder

COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml .
COPY .gitignore .
COPY pnpm-workspace.yaml .
COPY turbo.json .
COPY configs ./configs
RUN --mount=type=cache,id=pnpm,target=/pnpm/store STACK_SKIP_TEMPLATE_GENERATION=true pnpm install --frozen-lockfile

COPY --from=pruner /app/out/full/ .

# Docs are required for the NextJS backend build
COPY docs ./docs

ENV NEXT_CONFIG_OUTPUT=standalone

# Build backend only
RUN pnpm turbo run docker-build --filter=@stackframe/backend...

# Build the migration script
RUN cd apps/backend && pnpm build-self-host-migration-script


# Final image
FROM node:${NODE_VERSION}-slim

WORKDIR /app

RUN apt-get update && \
    apt-get upgrade -y && \
    apt-get install -y openssl && \
    rm -rf /var/lib/apt/lists

# Copy built backend (standalone)
COPY --from=builder --chown=node:node /app/apps/backend/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/backend/.next/static ./apps/backend/.next/static
COPY --from=builder --chown=node:node /app/apps/backend/prisma ./apps/backend/prisma
COPY --from=builder --chown=node:node /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder --chown=node:node /app/apps/backend/node_modules ./apps/backend/node_modules

# Restore workspace node_modules needed by non-Next runtime scripts (e.g. migrations)
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/packages ./packages

ENV NODE_ENV=production
ENV PORT=8102
ENV HOSTNAME=0.0.0.0

USER node

EXPOSE 8102

CMD ["node", "apps/backend/server.js"]
