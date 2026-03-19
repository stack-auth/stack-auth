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

# https://turbo.build/repo/docs/guides/tools/docker
RUN turbo prune --scope=@stackframe/backend --scope=@stackframe/dashboard --docker



# Build stage
FROM base AS builder

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
      # Duplicate Next.js copies (keep only one for next/headers.js resolution)
      'next@16.1.5_@babel+core@7.29.0*' 'next@16.1.5_@babel+core@7.28.5*' \
      next@14* @next+swc-*@14* \
      # Native build binaries not needed at runtime
      @esbuild+*@* esbuild@* @rolldown+*@* \
      # Duplicate date-fns versions (keep v4 only)
      date-fns@2* date-fns@3*


# Final image
FROM node:${NODE_VERSION}-slim

WORKDIR /app

# Install packages needed for deployment
RUN apt-get update && \
    apt-get upgrade -y && \
    apt-get install -y curl openssl socat && \
    rm -rf /var/lib/apt/lists

# Copy built backend
COPY --from=builder --chown=node:node /app/apps/backend/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/backend/.next/static ./apps/backend/.next/static
COPY --from=builder --chown=node:node /app/apps/backend/prisma ./apps/backend/prisma
COPY --from=builder --chown=node:node /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder --chown=node:node /app/apps/backend/node_modules ./apps/backend/node_modules

# Copy built dashboard
COPY --from=builder --chown=node:node /app/apps/dashboard/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=builder --chown=node:node /app/apps/dashboard/public ./apps/dashboard/public

# Restore pruned workspace node_modules needed by non-Next runtime scripts (e.g. migrations)
COPY --from=migration-pruner --chown=node:node /pruned-node_modules ./node_modules
COPY --from=builder --chown=node:node /app/packages ./packages

# Add the entrypoint script
COPY ./docker/server/entrypoint.sh .
RUN chmod +x entrypoint.sh

WORKDIR /app

# Define environment variables for both services
ENV NODE_ENV=production
ENV BACKEND_PORT=8102
ENV DASHBOARD_PORT=8101

USER node

# Set entrypoint to run both backend and dashboard
ENTRYPOINT ["./entrypoint.sh"]
