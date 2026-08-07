FROM node:22-slim

# secure-exec publishes a Linux glibc sidecar, but no musl build. Keep this on
# Debian-based node:22-slim rather than switching the mock to an Alpine image.
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY guest-package.json guest-package-lock.json /app/guest-node-modules/
RUN mkdir -p /app/guest-node-modules \
  && cd /app/guest-node-modules \
  && mv guest-package.json package.json \
  && mv guest-package-lock.json package-lock.json \
  && npm ci --omit=dev --no-audit --no-fund

COPY server.mjs ./
RUN mkdir -p /app/module-cache

EXPOSE 8080

CMD ["node", "server.mjs"]
