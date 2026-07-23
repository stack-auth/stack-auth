import { deindent } from "../../../utils/strings";

// The Deployments-specific addendum served at https://skill.hexclave.com/deployments.
// It is appended verbatim after the full base skill, so this section assumes the
// reader already has the general Hexclave skill (CLI auth, config format, SDKs) in
// context and only teaches what is specific to the Deployments app.
export const deploymentsSkillSection = deindent`
  # Hexclave Deployments

  The Deployments app makes deploying a service very easy. You select a type of service to deploy and provide your code, build instructions, run instructions, environment variables, and the code framework. You can set up multiple deployments per Hexclave project — for example, a backend service and a frontend service. Once a service is deployed, it is publicly accessible.

  For this iteration of the Deployments app, only the \`vercel\` service type is available. It can be used to set up serverless deployments.

  To use Hexclave Deployments, you must do a few things. First, the Deployments app must be enabled, by adding \`deployments\` under \`apps.installed\`. Second, you must edit your \`hexclave.config.ts\` file to add the relevant configuration, as specified below.

  ## Config

  \`\`\`ts title="hexclave.config.ts"
  import type { HexclaveConfig } from "@hexclave/js/config"; // replace \`js\` with the correct framework SDK package

  export const config: HexclaveConfig = {
    apps: {
      installed: {
        authentication: { enabled: true },
        deployments: { enabled: true },
      },
    },
    deployments: {
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

  ## Deleting a service

  If you want to delete a deployed service, you can do so through the dashboard, or through the CLI like so:

  \`\`\`sh title="Terminal"
  npx @hexclave/cli@latest exec --cloud-project-id <project-id> \\
    "const p = await hexclaveServerApp.getProject(); \\
     await p.deleteDeploymentService('api');"
  \`\`\`
`;
