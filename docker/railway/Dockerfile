# syntax=docker/dockerfile:1
#
# Railway overlay for the Hexclave self-host image.
#
# This is deliberately a thin layer on top of an already-built server image
# rather than a second way to build the monorepo. Two reasons:
#
#   * It keeps the Railway integration purely additive. docker/server/Dockerfile
#     and everything under apps/ and packages/ stay untouched, so merging
#     upstream changes never conflicts with the Railway support.
#
#   * It builds in seconds. Iterating on the proxy or the cron runner does not
#     pay for a turbo prune plus a full Next.js build, which the base image does.
#
# Build against your fork's published image:
#
#   docker build -f docker/railway/Dockerfile \
#     --build-arg BASE_IMAGE=yourrepo/server:dev -t yourrepo/server-railway:dev .
#
# The build context must be the repository root: the cron runner's schedule is
# copied from apps/backend/vercel.json.

ARG BASE_IMAGE=stackauth/server:latest
FROM ${BASE_IMAGE}

# Listed file by file rather than copying the directory, so the tests and README
# alongside them stay out of the runtime image. The base image ends on USER node;
# COPY runs as root regardless, and --chmod avoids a RUN layer entirely, which
# keeps multi-platform builds free of any emulated execution.
COPY --chmod=755 \
  railway/entrypoint.sh \
  railway/proxy.mjs \
  railway/cron.mjs \
  railway/cron-schedule.mjs \
  /railway/

# The cron runner reads the same schedule the backend bundles at build time
# (apps/backend/src/server/cron-monitor.ts imports this file directly), so the
# self-hosted scheduler cannot drift from what the application expects. Build the
# overlay from the same commit as its base image to keep the two in step.
COPY --chmod=644 apps/backend/vercel.json /railway/vercel.json

# Default for plain `docker run`; Railway overrides PORT at deploy time. EXPOSE
# lets Railway's port detection pick this as the target port automatically
# instead of offering a choice between the two internal ports.
ENV PORT=8080
EXPOSE 8080

USER node

ENTRYPOINT ["/railway/entrypoint.sh"]
