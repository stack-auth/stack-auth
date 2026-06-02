# Backend for Cloud Run / self-hosted deployment (fallback backend server).
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
    rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PNPM_HOME/bin:$PATH

RUN corepack enable
RUN corepack prepare pnpm@11.5.0 --activate
RUN pnpm add -g turbo
RUN pnpm add -g tsx


# Prune stage
FROM base AS pruner

COPY . .

RUN tsx ./scripts/generate-sdks.ts

# Only prune backend (no dashboard)
RUN turbo prune --scope=@hexclave/backend --docker


# Build stage
FROM base AS builder

# Skip generate-sdks.ts in preinstall hook (file not available in pruned output)
ENV STACK_SKIP_TEMPLATE_GENERATION=true

COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml .
COPY .gitignore .
COPY pnpm-workspace.yaml .
COPY turbo.json .
COPY configs ./configs
COPY --from=pruner /app/scripts/postinstall-patch-next-async-debug-info.mjs ./scripts/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

COPY --from=pruner /app/out/full/ .

# Docs are required for the NextJS backend build
COPY docs ./docs

ENV NEXT_CONFIG_OUTPUT=standalone

# Build backend only
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm turbo run docker-build --filter=@hexclave/backend...


# Final image
FROM node:${NODE_VERSION}-slim

WORKDIR /app

RUN apt-get update && \
    apt-get upgrade -y && \
    apt-get install -y --no-install-recommends openssl && \
    rm -rf /var/lib/apt/lists/*

# Copy Next.js standalone output — this includes a traced, minimal copy of
# node_modules/ and packages/ (only the files the server actually imports).
COPY --from=builder --chown=node:node /app/apps/backend/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/backend/.next/static ./apps/backend/.next/static

# Prisma schema (needed at runtime by Prisma client)
COPY --from=builder --chown=node:node /app/apps/backend/prisma ./apps/backend/prisma

ENV NODE_ENV=production
ENV PORT=8102
ENV HOSTNAME=0.0.0.0

USER node

EXPOSE 8102

CMD ["node", "apps/backend/server.js"]
