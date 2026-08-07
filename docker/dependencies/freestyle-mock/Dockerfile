FROM node:22-slim

# secure-exec publishes a Linux glibc sidecar, but no musl build. Keep this on
# Debian-based node:22-slim rather than switching the mock to an Alpine image.
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server.mjs ./
RUN mkdir -p /app/module-cache

EXPOSE 8080

CMD ["node", "server.mjs"]
