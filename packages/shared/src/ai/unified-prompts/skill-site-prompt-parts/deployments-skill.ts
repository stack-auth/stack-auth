import { deindent } from "../../../utils/strings";

// The Deployments-specific addendum served at https://skill.hexclave.com/deployments.
// It is appended verbatim after the full base skill, so this section assumes the
// reader already has the general Hexclave skill (CLI auth, config format, SDKs) in
// context and only teaches what is specific to the Deployments app.
export const deploymentsSkillSection = deindent`
  # Hexclave Deployments

  The Deployments app deploys your services. You provide your code, build instructions, environment variables, and framework per service; you can define multiple services per Hexclave project (e.g. a backend and a frontend). Once deployed, a service is publicly accessible. Only the \`vercel\` service type (serverless deployments) exists for now.

  Enable the app by adding \`"deployments-alpha"\` under \`apps.installed\` in your config (quote it — it contains a hyphen). Services themselves are NOT part of the \`config\` export: they are defined by a separate \`services\` export in \`hexclave.config.ts\`.

  ## The services export

  \`\`\`ts title="hexclave.config.ts"
  export const config = {
    apps: {
      installed: {
        authentication: { enabled: true },
        "deployments-alpha": { enabled: true },
      },
    },
  };

  export const services = ({ isDev, secret, service, hexclave }) => ({
    web: {
      type: "vercel",
      rootDirectory: "./",
      framework: "nextjs",
      installCommand: "pnpm install",
      buildCommand: "pnpm build",
      outputDirectory: ".next",
      devCommand: "pnpm dev",
      env: {
        MY_ENV_VAR: "true",
        OPENAI_API_KEY: isDev ? null : secret("OPENAI_API_KEY"),
        API_URL: service("api").url,
        NEXT_PUBLIC_HEXCLAVE_PROJECT_ID: hexclave.projectId,
      },
    },
    api: { type: "vercel", rootDirectory: "./api" },
  });
  \`\`\`

  It is a FUNCTION returning a record of services keyed by service id. \`rootDirectory\` (relative to the config file) is where the code lives and commands run; \`framework\` + \`outputDirectory\` infer the run command; \`devCommand\` is what \`hexclave dev --service-id <id>\` runs. Optional \`includeFiles\`/\`excludeFiles\` predicates (\`(relativePath) => boolean\`) narrow what gets packaged on top of \`.gitignore\`/\`.vercelignore\`.

  Env var values may be: a plain string; \`null\` (omit the var — useful with \`isDev\`); \`secret(key, defaultValue?)\` — the value is stored per project in the dashboard (Project Settings > Secrets), never in the config; \`service("<id>").url\` — resolved to another service's deployed URL at deploy time (the id must be a defined service); or \`hexclave.projectId\` / \`.apiUrl\` / \`.jwksUrl\` / \`.publishableClientKey\` / \`.secretServerKey\` for the managed Hexclave backend. References must be the WHOLE value — string interpolation with them throws. During \`hexclave dev\`, \`secret()\` resolves to its default value (error if it has none and isn't guarded by \`isDev\`) and \`service()\` returns \`null\`.

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

  1. **Read this skill** and ensure \`deployments-alpha\` is enabled and the \`services\` export exists as above.
  2. **Authenticate for cloud deploys** (pick the first that works):
     - If \`HEXCLAVE_SECRET_SERVER_KEY\` (or \`STACK_SECRET_SERVER_KEY\`) **and** \`HEXCLAVE_PROJECT_ID\` (or \`STACK_PROJECT_ID\`) are already in the environment, use them. No login step.
     - Else if \`npx @hexclave/cli@latest whoami\` succeeds, you already have a CLI login session — proceed.
     - Else confirm with the user first, then run \`npx @hexclave/cli@latest login\` yourself. It does not open a browser — it prints a one-time confirmation URL (\`https://app.hexclave.com/handler/cli-auth-confirm?login_code=...\`) and waits. Either open that URL in the user's browser or hand it to them to open, but either way tell them to complete the login themselves; you can't do it for them. Once the command returns successfully, continue immediately with the CLI. Do **not** use the browser yourself to open the Deployments dashboard or configure anything in the UI.
  3. **Set any needed secrets** (previous section), then **deploy** (next section).

  \`deploy\` auth: \`HEXCLAVE_SECRET_SERVER_KEY\` if set, otherwise the \`hexclave login\` session. \`exec --cloud-project-id\` needs the login session (not the secret server key alone).

  ## Deploying

  Before deploying, run each service's \`installCommand\` and \`buildCommand\` locally and confirm they succeed. From the directory containing your config file:

  \`\`\`sh title="Terminal"
  npx @hexclave/cli@latest deploy
  \`\`\`

  This pushes the config file's \`config\` export to the project (skip with \`--no-config-push\`), syncs the service definitions, then deploys EVERY defined service in dependency order (services connected via \`service(...)\` deploy after their dependencies; circular dependencies fail up front). It packages each service's root directory (respecting \`.gitignore\`/\`.vercelignore\`, always excluding \`node_modules\` and \`.git\`), always targets production, never prompts, and WAITS for the remote builds — per service it prints the run id, build status, and final URL, and exits non-zero if any build fails (dependents of a failed service are skipped). A JSON summary of all services is printed to stdout.

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

  \`hexclave dev --config-file hexclave.config.ts --service-id web\` runs the service's \`devCommand\` with its env vars injected (plus the development-environment credentials). Passing \`-- <command>\` instead (or additionally) overrides the devCommand.

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

  Every Vercel service gets a Vercel domain autoprovisioned. Prefer the CLI to attach a custom domain:

  \`\`\`sh title="Terminal"
  npx @hexclave/cli@latest exec --cloud-project-id <project-id> \\
    "const p = await hexclaveServerApp.getProject(); \\
     await p.addDeploymentServiceDomain('api', 'app.example.com'); \\
     return p.getDeploymentServiceDomain('api', 'app.example.com');"
  \`\`\`

  Humans can also add domains in the dashboard (service → Domains). Agents should not do that in a browser.

  ## Removing a service

  Removing a service from the \`services\` export stops it from being deployed, but does not (yet) tear down its existing deployment — automatic cleanup of removed services is planned.
`;
