ARG NODE_VERSION=22
FROM mcr.microsoft.com/devcontainers/javascript-node:${NODE_VERSION}

# Install dependencies
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends \
    postgresql-client \
    && apt-get clean -y \
    && rm -rf /var/lib/apt/lists/*

# Set up development environment
USER node
WORKDIR /workspaces/stack-auth

# Enable corepack for pnpm
RUN corepack enable
RUN corepack prepare pnpm@9 --activate
