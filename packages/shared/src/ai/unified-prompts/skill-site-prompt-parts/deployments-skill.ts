import { deindent } from "../../../utils/strings";

// The Deployments-specific addendum served at https://skill.hexclave.com/deployments.
// It is appended verbatim after the full base skill, so this section assumes the
// reader already has the general Hexclave skill (CLI auth, config format, SDKs) in
// context and only teaches what is specific to the Deployments app.
export const deploymentsSkillSection = deindent`
  # Hexclave Deployments

  The Deployments app makes deploying a service very easy. You select a type of service to deploy and provide your code, build instructions, run instructions, environment variables, and the code framework. You can set up multiple deployments per Hexclave project — for example, a backend service and a frontend service. Once a service is deployed, it is publicly accessible.

  For this iteration of the Deployments app, only the \`vercel\` service type is available. It can be used to set up serverless deployments.

  To use Hexclave Deployments, you must do a few things. First, the Deployments app must be enabled, by adding \`deployments-alpha\` under \`apps.installed\`. Second, you must edit your \`hexclave.config.ts\` file to add the relevant configuration, as specified below. Both keys are \`deployments-alpha\`, not \`deployments\` — the app is in alpha and its id says so. Because of the hyphen, quote it.

  ## Config

  \`\`\`ts title="hexclave.config.ts"
  import type { HexclaveConfig } from "@hexclave/js/config"; // replace \`js\` with the correct framework SDK package

  export const config: HexclaveConfig = {
    apps: {
      installed: {
        authentication: { enabled: true },
        "deployments-alpha": { enabled: true },
      },
    },
    "deployments-alpha": {
      services: {
        web: {
          type: "vercel",
          rootDirectory: "./",
          framework: "nextjs",
          installCommand: "pnpm install",
          buildCommand: "pnpm build",
          outputDirectory: ".next",
          env: {
            "MY_ENV_VAR": { value: "true" },
            "DATABASE_CONNECTION_STRING": { type: "secret", key: "db_connection" },
            "NEXT_PUBLIC_HEXCLAVE_PROJECT_ID": { type: "connection", value: "hexclave.projectId" },
          },
        },
      },
    },
  };
  \`\`\`

  Here, \`web\` is the name of your service. \`type\` refers to the type of service you want to set up; for now, as mentioned earlier, only \`vercel\` is supported. \`rootDirectory\` is the directory in which the install and build commands are run, and where the code for your service is found. \`installCommand\` is the command run to install your application's dependencies, and \`buildCommand\` is what is run to build the necessary packages and files. \`framework\` is the framework used by your service; from it and \`outputDirectory\`, the run command is inferred.

  The \`HexclaveConfig\` annotation requires the SDK package it is imported from to be a dependency of the project. If it isn't, either install it or drop the annotation (the config is plain TypeScript — the CLI does not type-check it).

  Note also that the config file usually sits inside \`rootDirectory\`, which means it is uploaded with your source and compiled by the remote build like any other file. If the deployed app doesn't depend on the Hexclave SDK, add \`hexclave.config.ts\` to \`.vercelignore\`: the CLI reads the config from disk before packaging, so the build itself never needs it, and excluding it keeps an SDK import in the config from breaking a build that is otherwise unrelated to Hexclave.

  ## Domains

  Every Vercel service gets a Vercel domain autoprovisioned. If you want to attach a custom domain, there are two ways to do so.

  **Option 1 — the dashboard.** Visit \`https://app.hexclave.com/projects/<project-id>/deployments\`, click the service of choice, go to the Domains tab, add your domain, and then create the returned DNS records at your DNS provider.

  **Option 2 — the CLI.** Here is an example of adding \`app.example.com\` to the service \`api\` and receiving the DNS records that then need to be set with your DNS provider:

  \`\`\`sh title="Terminal"
  npx @hexclave/cli@latest exec --cloud-project-id <project-id> \\
    "const p = await hexclaveServerApp.getProject(); \\
     await p.addDeploymentServiceDomain('api', 'app.example.com'); \\
     return p.getDeploymentServiceDomain('api', 'app.example.com');"
  \`\`\`

  ## Deploying

  Before deploying, run the service's \`installCommand\` and \`buildCommand\` locally and confirm they succeed. The remote build runs the same commands, but \`deploy\` exits before the build finishes, so a broken build does not fail the command — it surfaces only when you check the run afterwards.

  From the directory containing your config file:

  \`\`\`sh title="Terminal"
  npx @hexclave/cli@latest deploy web --secret db_connection="$DATABASE_URL"
  \`\`\`

  The CLI packages the service's root directory (respecting \`.gitignore\` and \`.vercelignore\`, and always excluding \`node_modules\` and \`.git\`), uploads it, and starts a remote build. Without a config file, the configuration stored in Hexclave governs the deploy, with the root directory resolved against the current directory. It always deploys to production, never prompts, and exits as soon as the build is queued, printing the run id. Follow the build in the dashboard's Deployments tab.

  Every secret defined in the service's \`env\` must be passed via \`--secret\` on every deploy — a missing (or misspelled) one fails the deploy before anything is uploaded.

  Options: \`--config <path>\` (default: auto-discover \`hexclave.config.ts\` in the current directory, dashboard configuration otherwise), \`--cloud-project-id <id>\` (default: the \`HEXCLAVE_PROJECT_ID\` env var), and \`--secret KEY=VALUE\` (repeatable, see above).

  You can also deploy through GitHub Actions, like so:

  \`\`\`yaml title=".github/workflows/deploy.yaml"
  - run: npm i -g @hexclave/cli
  - run: hexclave deploy web --secret db_connection="$DATABASE_URL"
    env:
      HEXCLAVE_PROJECT_ID: \${{ secrets.HEXCLAVE_PROJECT_ID }}
      HEXCLAVE_SECRET_SERVER_KEY: \${{ secrets.HEXCLAVE_SECRET_SERVER_KEY }}
      DATABASE_URL: \${{ secrets.DATABASE_URL }}
  \`\`\`

  ## Checking status and debugging failures

  Because \`deploy\` returns as soon as the build is queued, a successful exit does not mean the deploy succeeded. Check the service to find out:

  \`\`\`sh title="Terminal"
  npx @hexclave/cli@latest exec --cloud-project-id <project-id> \\
    "const p = await hexclaveServerApp.getProject(); \\
     const svc = (await p.listDeploymentServices()).find(s => s.id === 'web'); \\
     return { status: svc.status, url: svc.url, run: svc.latest_run };"
  \`\`\`

  A service's \`status\` is one of \`not_deployed\`, \`queued\`, \`building\`, \`deployed\`, \`failed\`, or \`canceled\`; a run's is \`queued\`, \`building\`, \`ready\`, \`error\`, or \`canceled\`. Poll until the run leaves \`queued\`/\`building\`.

  A failed run's \`error\` field is only a one-line summary (for example \`Command "npm run build" exited with 1\`). Do not try to guess the cause from it, and do not reproduce the build locally to find out — fetch the actual build output by run id:

  \`\`\`sh title="Terminal"
  npx @hexclave/cli@latest exec --cloud-project-id <project-id> \\
    "const p = await hexclaveServerApp.getProject(); \\
     return p.getDeploymentRunLogs('<run-id>');"
  \`\`\`

  \`deploy\` prints the run id it started. If you don't have one, \`listDeploymentRuns('web', { limit: 5 })\` returns the most recent runs, newest first — call it through \`exec\` like the snippets above.

  ## Deleting a service

  If you want to delete a deployed service, you can do so through the dashboard, or through the CLI like so:

  \`\`\`sh title="Terminal"
  npx @hexclave/cli@latest exec --cloud-project-id <project-id> \\
    "const p = await hexclaveServerApp.getProject(); \\
     await p.deleteDeploymentService('api');"
  \`\`\`
`;
