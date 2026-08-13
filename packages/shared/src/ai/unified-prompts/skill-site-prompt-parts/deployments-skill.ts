import { deindent } from "../../../utils/strings";

// The Deployments-specific addendum served at https://skill.hexclave.com/deployments.
// It is appended verbatim after the full base skill, so this section assumes the
// reader already has the general Hexclave skill (CLI auth, config format, SDKs) in
// context and only teaches what is specific to the Deployments app.
export const deploymentsSkillSection = deindent`
  # Hexclave Deployments

  The Deployments app runs your services as containers built remotely from your source — by default the build is auto-detected with Railpack (https://railpack.com), or you can point a service at your own Dockerfile. You can define multiple services per Hexclave project (e.g. a backend and a frontend). Services are private by default and reach each other over an internal network. Mark a port \`public: true\` to give the service a built-in public URL without requiring a custom domain.

  Every service is either a \`"server"\` or a \`"serverless"\`. A \`server\` is a single instance that SUSPENDS when idle and resumes with its memory intact, and it is the only type that may have a persistent disk. A \`serverless\` scales out between \`minInstances\` and \`maxInstances\` and STOPS on scale-down, so each start is a cold start and it can have no disk. Use \`server\` for anything stateful (a database, a queue, anything writing to a volume) and \`serverless\` for stateless web apps and APIs.

  Enable the app by adding \`"deployments-alpha"\` under \`apps.installed\` in your config (quote it — it contains a hyphen). Services themselves are NOT part of the \`config\` export: they are defined by a separate \`deployment\` export in \`hexclave.config.ts\`.

  ## The deployment export

  \`\`\`ts title="hexclave.config.ts"
  export const config = {
    apps: {
      installed: {
        authentication: { enabled: true },
        "deployments-alpha": { enabled: true },
      },
    },
  };

  export const deployment: HexclaveDeploymentConfig = {
    services: ({ isDev, secret, service, hexclave }) => ({
      web: {
        type: "serverless",
        ports: [{ port: 3000, public: true }],
        devCommand: "pnpm dev",
        env: {
          MY_ENV_VAR: "true",
          OPENAI_API_KEY: isDev ? null : secret("OPENAI_API_KEY"),
          API_URL: isDev ? "http://localhost:3001" : service("api").internalUrl(),
          DATABASE_HOST: isDev ? "localhost" : service("database").internalHost,
          DATABASE_PORT: "5432",
          NEXT_PUBLIC_HEXCLAVE_PROJECT_ID: hexclave.projectId,
        },
      },
      api: { type: "serverless", ports: [{ port: 8080 }], rootDirectory: "./api" },
      database: {
        type: "server",
        ports: [{ port: 5432, transport: "tcp" }],
        rootDirectory: "./database",
        dockerfilePath: "Dockerfile",
        persistentVolumes: { pgdata: { path: "/data", sizeGb: 10 } },
        env: { POSTGRES_PASSWORD: secret("POSTGRES_PASSWORD") },
      },
    }),
  };
  \`\`\`

  \`deployment.services\` is normally a FUNCTION returning a record of services keyed by service id (a plain record works when you need no secrets, connections, or \`hexclave.*\` outputs). \`type\` (required) is \`"server"\` or \`"serverless"\` as above. \`ports\` (required) lists the ports the container listens on, each \`{ port, public?, transport? }\`; use \`ports: []\` for a worker that only dials out, which needs \`type: "server"\` (or \`minInstances\` above zero) since nothing inbound can wake it. \`public\` (default false) gives that port a stable platform URL. A service with a public port may declare ONLY that port: a port is served on every address the service has, so a private sibling would be reachable from the internet too — put private ports on their own service and reach them with \`internalHost\`. \`transport\` (default \`"http"\`) may be \`"tcp"\` for a raw daemon — TCP ports are private-only and a service with no HTTP port cannot have custom domains. \`rootDirectory\` (relative to the config file, default \`./\`) is where the service's code lives; \`dockerfilePath\` (optional, relative to \`rootDirectory\`) selects a Dockerfile to build from — omit it to build with Railpack auto-detection; \`minInstances\`/\`maxInstances\` (serverless only, defaults 0/1, max 5) are the scaling bounds — \`minInstances: 0\` scales to zero and cold-starts on the next connection; \`persistentVolumes\` (server only) attaches a persistent disk; \`devCommand\` is what \`hexclave dev --service-id <id>\` runs.

  \`minInstances\` above 0 requires a paid plan. On the Free plan the deploy fails naming the offending services; set \`minInstances: 0\` (or remove it) so they scale to zero, or upgrade.

  ## Network model: HTTP and private TCP

  Use the default HTTP transport for web applications and APIs. \`internalUrl()\` gives the private URL including the port, and requires exactly one HTTP port so it is unambiguous; \`internalUrl(9090)\` names one when there are several. \`internalHost\` always works. There is no \`internalPort\` — write the number (e.g. \`DATABASE_PORT: "5432"\`), which you already declared in the target's \`ports\`. A \`public: true\` port additionally gets a public platform URL. The process must listen on each configured port and bind to \`0.0.0.0\`.

  Use \`transport: "tcp"\` on a port for a database, cache, queue, SMTP server, or other raw TCP daemon such as PostgreSQL, MySQL, Redis, or RabbitMQ. TCP ports are reachable only from other services in the same project: pass \`service("database").internalHost\` and the port as a literal, as separate env vars. A TCP port cannot be public, and a service with no HTTP port exposes no \`url\` or \`internalUrl\` and cannot take custom domains. The daemon must bind to \`0.0.0.0\`, not only localhost. Do not manually change generated Fly infrastructure; Hexclave reconciliation owns it and can replace out-of-band changes.

  A service with \`minInstances: 0\` autostarts when a connection reaches its Flycast host and port. Make clients retry initial DNS/connect/auth failures with a bounded backoff: an HTTP app and its TCP dependency may be cold-starting simultaneously. If startup latency is unacceptable, use \`minInstances: 1\` on a paid plan.

  ## Storage: the container filesystem is ephemeral

  By default anything a service writes to disk is lost on every deploy, restart, and scale-to-zero. Give a \`server\` service a persistent disk with \`persistentVolumes: { pgdata: { path: "/data", sizeGb: 10 } }\` — the key (\`pgdata\`) is the volume's id, \`path\` is an absolute mount point inside the container, \`sizeGb\` is gigabytes (1–500). Everything written under \`path\` then survives deploys and restarts. One disk per service for now; a second entry is rejected.

  The volume id names the disk within its service. Two services may never claim the same id at once. Moving an id to a different service does NOT move the data: a Fly volume lives inside one service's app, so the new service gets a fresh empty disk and the old one keeps its data, detached and still billed. Renaming a service does the same thing. To move data, copy it out (object storage, a database dump) before the move and restore it after.

  A volume mount replaces whatever the image had at that exact path, and a newly formatted filesystem is not guaranteed to be literally empty (it may contain provider/filesystem metadata). Prefer a neutral mount point such as \`/data\`, then configure the application to store its files in a child directory such as \`/data/app\`; do not mount directly over an image's built-in data/config directory or point software that requires an empty directory at the mount root.

  The container's runtime user must also be able to write to the mounted filesystem. In a Dockerfile, explicitly end with the intended non-root \`USER\`, make the mount point owned by that user in the image, and configure the application/entrypoint to create its child data directory. Do not assume an entrypoint will run as root and repair permissions after the volume is mounted. For a third-party image, inspect its user and data-directory requirements first; if they are incompatible, derive a small Dockerfile that establishes an explicit writable user/path rather than patching the running machine after deployment.

  For example, keep PostgreSQL's data in a child of the neutral mount and make the runtime user explicit:

  \`\`\`dockerfile title="database/Dockerfile"
  FROM postgres:17-alpine
  USER root
  RUN mkdir -p /data && chown postgres:postgres /data
  ENV PGDATA=/data/postgres
  USER postgres
  \`\`\`

  Apply the same pattern generically: learn the base image's intended runtime user and data-directory environment setting; create and own a neutral mount point; configure data into a child directory; and leave the final \`USER\` set correctly. Never bake mutable data into the image path that the volume will cover.

  A volume is a single disk on a single machine, which is why only a \`server\` may have one — a \`serverless\` fleet would give each instance its own separate copy. It is NOT replicated and NOT a backup; a host failure can lose it. Use it for caches, uploads, SQLite, and similar — keep anything you cannot lose in a managed database or object storage.

  Disks only grow: raising \`sizeGb\` expands them in place, but LOWERING it fails the deploy rather than silently ignoring you. Removing a volume from a service detaches the disk without deleting it — the data stays (re-declaring the same id remounts it) and so does the billing, so a disk you truly want gone has to be deleted deliberately. \`hexclave dev\` ignores \`persistentVolumes\` entirely; locally your app just writes to your own filesystem.

  Env var values may be: a plain string; \`null\` (omit the var — useful with \`isDev\`); \`secret(key, defaultValue?)\` — the value is stored per project in the dashboard (Project Settings > Secrets), never in the config; \`service("<id>").internalUrl()\` for an HTTP target (or \`.internalUrl(9090)\` to name a port); \`.internalHost\` for either transport (pair it with a literal port for TCP clients); \`service("<id>").url\` — an HTTP target's PUBLIC URL, available immediately for a service with a public port or once a custom domain verifies otherwise (until then the depending service is \`blocked\` and its deploy FAILS — make the target public, verify its domain first, or prefer \`internalUrl\`); or \`hexclave.projectId\` / \`.apiUrl\` / \`.jwksUrl\` / \`.publishableClientKey\` / \`.secretServerKey\` for the managed Hexclave backend. A target with no HTTP port has no URL, so \`.url\` or \`.internalUrl()\` on it fails with guidance to use host and port, as does a bare \`.internalUrl()\` on a target whose several HTTP ports make it ambiguous. References must be the WHOLE value — string interpolation with them throws. During \`hexclave dev\`, \`secret()\` resolves to its default value (error if it has none and isn't guarded by \`isDev\`) and \`service()\` returns \`null\`.

  ## How services are built

  Each service is built remotely — Docker is never required locally. By default (no \`dockerfilePath\`) the build is auto-detected with [Railpack](https://railpack.com), which handles Node, Python, Go, PHP, Java, Ruby, and more out of the box; either way, the image's default command must start a server listening on each configured port on \`0.0.0.0\` and speaking that port's transport. Set \`dockerfilePath\` to build from your own Dockerfile instead — a Dockerfile in the source is deliberately NOT picked up unless \`dockerfilePath\` names it. Stateful third-party server images should generally use a small explicit Dockerfile so their runtime user and child data path are unambiguous. To adjust Railpack's detection (custom install/build/start commands, static output dirs), add a \`railpack.json\` to the service's source, or set the equivalent \`RAILPACK_*\` env var on the service. If detection can't work at all, add a Dockerfile and set \`dockerfilePath\`; the remote build's logs are available if a build fails.

  ## Env vars during the build

  A service's env vars are readable during the remote build as well as at runtime — you do not declare them twice, and secrets are not withheld from the build. That is what lets a framework that INLINES values at compile time (\`NEXT_PUBLIC_*\` for Next.js, \`VITE_*\` for Vite, and their equivalents) see them. Two consequences worth understanding: an inlined value is copied into the JavaScript your users download, permanently and by construction, so a var whose name starts with a public prefix must never hold a secret; and \`service(...)\` connection values are the one thing a build cannot see, because the target service has no address until it is rolled out — read those at runtime only.

  With a \`dockerfilePath\`, nothing reaches your build automatically: declare \`ARG MY_VAR\` to receive one (needed when a framework must inline it), or read it without baking it into a layer with \`RUN --mount=type=secret,id=MY_VAR\`, which is what anything sensitive should use. Railpack builds need neither — every var is already exported into each build step. Changing only an env var deploys the new value to the running containers but does NOT rebuild the image, so an inlined value keeps whatever it was compiled with until the next source deploy.

  A successful image build only proves that the image was produced; it does not prove that the service can boot, listen on its configured ports, reach its dependencies, or read/write its volume. After every first deploy or infrastructure change, request a real application endpoint and exercise at least one dependency-backed operation. For services with \`minInstances: 0\`, make dependency connection startup retry-safe: the application and a dependency can cold-start at the same time, so fail-fast one-shot connection initialization can turn a healthy cold start into a 500.

  ## Secrets

  Secret values are write-only, stored per project, and read server-side at deploy time. Humans set them in the dashboard under Project Settings > Secrets; agents set them via \`exec\`:

  \`\`\`sh title="Terminal"
  npx @hexclave/cli@latest exec --cloud-project-id <project-id> \\
    "const p = await hexclaveServerApp.getProject(); \\
     await p.setProjectSecret('OPENAI_API_KEY', process.env.OPENAI_API_KEY);"
  \`\`\`

  \`listProjectSecrets()\` returns keys and timestamps only — values can never be read back, and the dashboard lists only keys that have a value. \`defaultValue\` lives purely in the config file: it is sent with the deploy and never stored, so it never shows up as a set secret. A deploy fails up front and names every \`secret()\` without a default that has no stored value. Note that \`exec\` requires a \`hexclave login\` session — a server-key-only environment (typical CI) can DEPLOY using stored secrets but cannot SET them; set secrets beforehand from a logged-in machine or the dashboard.

  ## Agent workflow (do this — do not drive the dashboard UI)

  AI agents must deploy and manage Deployments through the CLI and \`hexclave.config.ts\`, not by clicking around \`app.hexclave.com\` in a browser. The dashboard is a human fallback only.

  1. **Read this skill** and ensure \`deployments-alpha\` is enabled and the \`deployment\` export exists as above.
  2. **Authenticate for cloud deploys** (pick the first that works):
     - If \`HEXCLAVE_SECRET_SERVER_KEY\` (or \`STACK_SECRET_SERVER_KEY\`) **and** \`HEXCLAVE_PROJECT_ID\` (or \`STACK_PROJECT_ID\`) are already in the environment, use them. No login step.
     - Else if \`npx @hexclave/cli@latest whoami\` succeeds, you already have a CLI login session — proceed.
     - Else confirm with the user first, then run \`npx @hexclave/cli@latest login\` yourself. It does not open a browser — it prints a one-time confirmation URL (\`https://app.hexclave.com/handler/cli-auth-confirm?login_code=...\`) and waits. Either open that URL in the user's browser or hand it to them to open, but either way tell them to complete the login themselves; you can't do it for them. Once the command returns successfully, continue immediately with the CLI. Do **not** use the browser yourself to open the Deployments dashboard or configure anything in the UI.
  3. **Set any needed secrets** (previous section), then **deploy** (next section).

  \`deploy\` auth: \`HEXCLAVE_SECRET_SERVER_KEY\` if set, otherwise the \`hexclave login\` session. \`exec --cloud-project-id\` needs the login session (not the secret server key alone).

  ## Deploying

  From the directory containing your config file:

  \`\`\`sh title="Terminal"
  npx @hexclave/cli@latest deploy
  \`\`\`

  This pushes the config file's \`config\` export to the project (skip with \`--no-config-push\`), syncs the service definitions, then deploys EVERY defined service in dependency order (services connected via \`service(...)\` deploy after their dependencies; circular dependencies fail up front). It packages each service's root directory (respecting \`.gitignore\`/\`.dockerignore\`, always excluding \`node_modules\` and \`.git\`) and uploads it — the container image is built remotely, so Docker is not needed locally. It always targets production, never prompts, and WAITS for the remote builds — per service it prints the run id, build status, and final URL (if the service has one), and exits non-zero if any build fails (dependents of a failed service are skipped). A JSON summary of all services is printed to stdout.

  Options: \`--service-id <id>\` (deploy just one service; its connections resolve against already-deployed services), \`--config-file <path>\` (default: auto-discover \`hexclave.config.ts\` in the current directory; a config file is required), \`--cloud-project-id <id>\` (default: the \`HEXCLAVE_PROJECT_ID\` env var), \`--no-config-push\`.

  GitHub Actions example:

  \`\`\`yaml title=".github/workflows/deploy.yaml"
  - run: npm i -g @hexclave/cli
  - run: hexclave deploy
    env:
      HEXCLAVE_PROJECT_ID: \${{ secrets.HEXCLAVE_PROJECT_ID }}
      HEXCLAVE_SECRET_SERVER_KEY: \${{ secrets.HEXCLAVE_SECRET_SERVER_KEY }}
  \`\`\`

  ## Local development

  \`hexclave dev --config-file hexclave.config.ts --service-id web\` runs the service's \`devCommand\` with its env vars injected (plus the development-environment credentials) — services run directly on your machine during development, never in containers. Passing \`-- <command>\` instead (or additionally) overrides the devCommand.

  ## Checking status and debugging failures

  \`deploy\` already waits and reports per-service success/failure and URLs. To inspect later:

  \`\`\`sh title="Terminal"
  npx @hexclave/cli@latest exec --cloud-project-id <project-id> \\
    "const p = await hexclaveServerApp.getProject(); \\
     const svc = (await p.listDeploymentServices()).find(s => s.id === 'web'); \\
     return { status: svc.status, url: svc.url, run: svc.latest_run };"
  \`\`\`

  A service's \`status\` is one of \`not_deployed\`, \`queued\`, \`building\`, \`deployed\`, \`failed\`, or \`canceled\`; a run's is \`queued\`, \`building\`, \`ready\`, \`error\`, or \`canceled\`.

  A failed run's \`error\` field is only a one-line summary. Do not guess the cause from it — fetch the actual build output by run id (printed by \`deploy\`; or \`listDeploymentRuns('web', { limit: 5 })\`):

  \`\`\`sh title="Terminal"
  npx @hexclave/cli@latest exec --cloud-project-id <project-id> \\
    "const p = await hexclaveServerApp.getProject(); \\
     return p.getDeploymentRunLogs('<run-id>');"
  \`\`\`

  ## Domains

  Services with a public port already have a platform URL; a verified custom domain becomes their preferred user-facing URL. A custom domain is also how a private HTTP service can expose a public URL. A service with no HTTP port rejects domains. Internal HTTP traffic uses \`service("<id>").internalUrl()\`; internal TCP traffic uses \`.internalHost\` plus a literal port. Prefer the CLI to attach an HTTP domain:

  \`\`\`sh title="Terminal"
  npx @hexclave/cli@latest exec --cloud-project-id <project-id> \\
    "const p = await hexclaveServerApp.getProject(); \\
     await p.addDeploymentServiceDomain('api', 'app.example.com'); \\
     return p.getDeploymentServiceDomain('api', 'app.example.com');"
  \`\`\`

  The returned \`dns_records\` are what the user must create at their DNS provider; poll \`getDeploymentServiceDomain\` to see verification flip. A hostname can only be attached to one service across all of Hexclave. Humans can also add domains in the dashboard (service → Domains). Agents should not do that in a browser.

  ## Removing a service

  Removing a service from \`deployment.services\` stops it from being deployed, but does not (yet) tear down its existing deployment — automatic cleanup of removed services is planned.
`;
