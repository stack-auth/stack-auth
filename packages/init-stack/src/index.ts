import * as child_process from "child_process";
import { Command } from "commander";
import * as crypto from 'crypto';
import * as fs from "fs";
import inquirer from "inquirer";
import open from "open";
import * as os from 'os';
import * as path from "path";
import { PostHog } from 'posthog-node';
import packageJson from '../package.json';
import { scheduleMcpConfiguration } from "./mcp";
import { Colorize, configureVerboseLogging, logVerbose, templateIdentity } from "./util";

export { templateIdentity } from "./util";

const jsLikeFileExtensions: string[] = [
  "mtsx",
  "ctsx",
  "tsx",
  "mts",
  "cts",
  "ts",
  "mjsx",
  "cjsx",
  "jsx",
  "mjs",
  "cjs",
  "js",
];

class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

class UnansweredQuestionError extends UserError {
  constructor(message: string) {
    super(message + ", or use --on-question <guess|ask> to answer questions automatically or interactively");
    this.name = "UnansweredQuestionError";
  }
}

type OnQuestionMode = "ask" | "guess" | "error";

function isTruthyEnv(name: string): boolean {
  const v = process.env[name];
  if (!v) return false;
  const s = String(v).toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function isNonInteractiveEnv(): boolean {
  if (isTruthyEnv("CI")) return true;
  if (isTruthyEnv("GITHUB_ACTIONS")) return true;
  if (isTruthyEnv("NONINTERACTIVE")) return true;
  if (isTruthyEnv("NO_INTERACTIVE")) return true;
  if (isTruthyEnv("PNPM_NON_INTERACTIVE")) return true;
  if (isTruthyEnv("YARN_ENABLE_NON_INTERACTIVE")) return true;
  if (isTruthyEnv("CURSOR_AGENT")) return true;
  if (isTruthyEnv("CLAUDECODE")) return true;
  return false;
}

function resolveOnQuestionMode(opt: string): OnQuestionMode {
  if (!opt || opt === "default") {
    return isNonInteractiveEnv() ? "error" : "ask";
  }
  if (opt === "ask" || opt === "guess" || opt === "error") {
    return opt;
  }
  throw new UserError(`Invalid argument for --on-question: "${opt}". Valid modes are: "ask", "guess", "error", "default".`);
}

// Setup command line parsing
const program = new Command();
program
  .name(packageJson.name)
  .description("Stack Auth Initialization Tool")
  .version(packageJson.version)
  .argument("[project-path]", "Path to your project")
  .usage(`[project-path] [options]`)
  .option("--dry-run", "Run without making any changes")
  .option("--neon", "Use Neon database")
  .option("--js", "Initialize for JavaScript project")
  .option("--next", "Initialize for Next.js project")
  .option("--react", "Initialize for React project")
  .option("--npm", "Use npm as package manager")
  .option("--yarn", "Use yarn as package manager")
  .option("--pnpm", "Use pnpm as package manager")
  .option("--bun", "Use bun as package manager")
  .option("--client", "Initialize client-side only")
  .option("--server", "Initialize server-side only")
  .option("--project-id <project-id>", "Project ID to use in setup")
  .option("--publishable-client-key <publishable-client-key>", "Publishable client key to use in setup")
  .option("--no-browser", "Don't open browser for environment variable setup")
  .option("--on-question <mode>", "How to handle interactive questions: ask | guess | error | default", "default")
  .option("--no-warn-uncommitted-changes", "Don't warn about uncommitted changes in the Git repository")
  .addHelpText('after', `
For more information, please visit https://docs.stack-auth.com/getting-started/setup`);

program.parse();

const options = program.opts();

// Keep existing variables but assign from Commander
let savedProjectPath: string | undefined = program.args[0] || undefined;
const verboseEnvRaw = process.env.STACK_VERBOSE;
const parsedVerboseLevel = typeof verboseEnvRaw === "string" && verboseEnvRaw.trim().length > 0
  ? Number.parseInt(verboseEnvRaw.trim(), 10)
  : 0;
const verboseLevel: number = Number.isFinite(parsedVerboseLevel) ? Math.max(0, parsedVerboseLevel) : 0;
const isVerbose: boolean = verboseLevel > 0;
const isDryRun: boolean = options.dryRun || isTruthyEnv("STACK_DRY_RUN") || false;
const isNeon: boolean = options.neon || false;
const typeFromArgs: "js" | "next" | "react" | undefined = options.js ? "js" : options.next ? "next" : options.react ? "react" : undefined;
const packageManagerFromArgs: string | undefined = options.npm ? "npm" : options.yarn ? "yarn" : options.pnpm ? "pnpm" : options.bun ? "bun" : undefined;
const isClient: boolean = options.client || false;
const isServer: boolean = options.server || false;
const projectIdFromArgs: string | undefined = options.projectId;
const publishableClientKeyFromArgs: string | undefined = options.publishableClientKey;
const onQuestionMode: OnQuestionMode = resolveOnQuestionMode(options.onQuestion);
const warnUncommittedChanges: boolean = options.warnUncommittedChanges ?? true;

// Commander negates the boolean options with prefix `--no-`
// so `--no-browser` becomes `browser: false`
const noBrowser: boolean = !options.browser;

type Ansis = {
  red: string,
  blue: string,
  green: string,
  yellow: string,
  clear: string,
  bold: string,
};

const ansis: Ansis = {
  red: "\x1b[31m",
  blue: "\x1b[34m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",

  clear: "\x1b[0m",
  bold: "\x1b[1m",
};

const colorize: Colorize = {
  red: (strings, ...values) => ansis.red + templateIdentity(strings, ...values) + ansis.clear,
  blue: (strings, ...values) => ansis.blue + templateIdentity(strings, ...values) + ansis.clear,
  green: (strings, ...values) => ansis.green + templateIdentity(strings, ...values) + ansis.clear,
  yellow: (strings, ...values) => ansis.yellow + templateIdentity(strings, ...values) + ansis.clear,
  bold: (strings, ...values) => ansis.bold + templateIdentity(strings, ...values) + ansis.clear,
};

configureVerboseLogging({
  level: verboseLevel,
  formatter: (message) => colorize.blue`[verbose] ${message}`,
});

const filesCreated: string[] = [];
const filesModified: string[] = [];
const commandsExecuted: string[] = [];

const packagesToInstall: string[] = [];
const writeFileHandlers: Array<() => Promise<void>> = [];
const deferredCommandHandlers: Array<() => Promise<void>> = [];
const nextSteps: string[] = [
  `Create an account and Stack Auth API key for your project on https://app.stack-auth.com`,
];


const STACK_AUTH_PUBLIC_HOG_KEY = "phc_vIUFi0HzHo7oV26OsaZbUASqxvs8qOmap1UBYAutU4k";
const EVENT_PREFIX = "stack-init-";
const ph_client = new PostHog(STACK_AUTH_PUBLIC_HOG_KEY, {
  host: "https://eu.i.posthog.com",
  flushAt: 1,
  flushInterval: 0,
});
const distinctId = crypto.randomUUID();


async function capture(event: string, properties: Record<string, any>) {
  logVerbose("capture event", { event, properties });
  ph_client.capture({
    event: `${EVENT_PREFIX}${event}`,
    distinctId,
    properties,
  });
}


async function main(): Promise<void> {
  // Welcome message
  console.log();
  console.log(`
       ██████
   ██████████████
████████████████████
████████████████████                WELCOME TO
█████████████████        ╔═╗╔╦╗╔═╗╔═╗╦╔═  ┌─┐┬ ┬┌┬┐┬ ┬
█████████████            ╚═╗ ║ ╠═╣║  ╠╩╗  ├─┤│ │ │ ├─┤
█████████████   ████     ╚═╝ ╩ ╩ ╩╚═╝╩ ╩  ┴ ┴└─┘ ┴ ┴ ┴
   █████████████████
       ██████     ██
████            ████
   █████    █████
       ██████
  `);
  console.log();

  logVerbose("Initialization run metadata", {
    version: packageJson.version,
    cwd: process.cwd(),
    args: program.args,
    options: {
      isDryRun,
      isVerbose,
      isNeon,
      typeFromArgs,
      packageManagerFromArgs,
      isClient,
      isServer,
      projectIdFromArgs: Boolean(projectIdFromArgs),
      publishableClientKeyFromArgs: Boolean(publishableClientKeyFromArgs),
      noBrowser,
      onQuestionMode,
      verboseLevel,
    },
  });

  await capture("start", {
    version: packageJson.version,
    isDryRun,
    isNeon,
    typeFromArgs,
    packageManagerFromArgs,
    isClient,
    isServer,
    noBrowser,
    platform: os.platform(),
    arch: os.arch(),
    nodeVersion: process.version,
  });

  // Wait just briefly so we can use `Steps` in here (it's defined only after the call to `main()`)
  await new Promise<void>((resolve) => resolve());


  // Prepare some stuff
  await clearStdin();
  const projectPath = await getProjectPath();
  await ensureGitWorkspaceIsReady(projectPath);
  logVerbose("Project path prepared", { projectPath, isDryRun, isVerbose });
  scheduleMcpConfiguration({
    projectPath,
    isDryRun,
    colorize,
    registerWriteHandler: (handler) => writeFileHandlers.push(handler),
    registerCommandHandler: (handler) => deferredCommandHandlers.push(handler),
    recordFileChange,
    runScheduledCommand,
  });
  nextSteps.push("Restart your MCP-enabled editors so they pick up the Stack Auth MCP.");
  logVerbose("MCP configuration scheduled", {
    writeHandlers: writeFileHandlers.length,
    deferredCommands: deferredCommandHandlers.length,
  });


  // Steps
  const { packageJson: projectPackageJson } = await Steps.getProject();
  const type = await Steps.getProjectType({ packageJson: projectPackageJson });
  logVerbose("Project inspection complete", {
    detectedType: type,
    dependencies: {
      hasReact: Boolean(projectPackageJson.dependencies?.["react"]),
      hasNext: Boolean(projectPackageJson.dependencies?.["next"]),
    },
  });

  await capture("project-type-selected", {
    type,
    wasSpecifiedInArgs: !!typeFromArgs,
  });

  await Steps.addStackPackage(type);
  if (isNeon) packagesToInstall.push('@neondatabase/serverless');

  await Steps.writeEnvVars(type);
  const convexIntegration = await Steps.maybeInstallConvexIntegration({ packageJson: projectPackageJson, type });
  if (convexIntegration) {
    nextSteps.push(...convexIntegration.instructions);
    logVerbose("Convex integration detected", convexIntegration);
  }

  if (type === "next") {
    const projectInfo = await Steps.getNextProjectInfo({ packageJson: projectPackageJson });
    await Steps.updateNextLayoutFile(projectInfo);
    await Steps.writeStackAppFile(projectInfo, "client", true);
    await Steps.writeStackAppFile(projectInfo, "server", true);
    await Steps.writeNextHandlerFile(projectInfo);
    await Steps.writeNextLoadingFile(projectInfo);
    nextSteps.push(`Copy the environment variables from the new API key into your .env.local file`);
  } else if (type === "react") {
    const defaultExtension = await Steps.guessDefaultFileExtension();
    const srcPath = await Steps.guessSrcPath();
    const hasReactRouterDom = !!(projectPackageJson.dependencies?.["react-router-dom"] || projectPackageJson.devDependencies?.["react-router-dom"]);
    const { fileName } = await Steps.writeReactClientFile({
      srcPath,
      defaultExtension,
      indentation: "  ",
      hasReactRouterDom,
    });
    nextSteps.push(
      `Copy the environment variables from the new API key into your own environment and reference them in ${fileName}`,
    );
  } else {
    const defaultExtension = await Steps.guessDefaultFileExtension();
    const where = await Steps.getServerOrClientOrBoth();
    const srcPath = await Steps.guessSrcPath();
    const appFiles: string[] = [];
    for (const w of where) {
      const { fileName } = await Steps.writeStackAppFile({
        type,
        defaultExtension,
        indentation: "  ",
        srcPath,
      }, w, where.includes("client"));
      appFiles.push(fileName);
    }
    nextSteps.push(
      `Copy the environment variables from the new API key into your own environment and reference them in ${appFiles.join(" and ")}`,
      `Follow the instructions on how to use Stack Auth's vanilla SDK at http://docs.stack-auth.com/others/js-client`,
    );
  }
  logVerbose("Primary integration steps completed", { type, nextStepsCount: nextSteps.length });

  const { packageManager } = await Steps.getPackageManager();
  logVerbose("Package manager determined", { packageManager });

  await capture(`package-manager-selected`, {
    packageManager,
    wasSpecifiedInArgs: !!packageManagerFromArgs,
  });

  await Steps.ensureReady(type);


  // Install dependencies
  console.log();
  console.log(colorize.bold`Installing dependencies...`);
  const installCommandMap = new Map<string, string>([
    ["npm", "npm install"],
    ["yarn", "yarn add"],
    ["pnpm", "pnpm add"],
    ["bun", "bun add"],
  ]);
  const installCommand = installCommandMap.get(packageManager) ?? `${packageManager} install`;
  // Quote each package name to avoid shell interpretation of env-overridden values.
  const safePackages = packagesToInstall.map((p) => JSON.stringify(p));
  await shellNicelyFormatted(`${installCommand} ${safePackages.join(' ')}`, {
    shell: true,
    cwd: projectPath,
  });
  logVerbose("Dependency installation finished", {
    packageManager,
    packages: packagesToInstall,
  });

  await capture(`dependencies-installed`, {
    packageManager,
    packages: packagesToInstall,
  });

  // Write files
  console.log();
  console.log(colorize.bold`Writing files...`);
  console.log();
  for (let i = 0; i < writeFileHandlers.length; i++) {
    const writeFileHandler = writeFileHandlers[i];
    logVerbose("Executing write handler", { index: i });
    await writeFileHandler();
  }
  console.log(`${colorize.green`√`} Done writing files`);

  await runDeferredCommands();

  console.log('\n\n\n');
  console.log(colorize.bold`${colorize.green`Installation succeeded!`}`);
  console.log();
  console.log("Commands executed:");
  for (const command of commandsExecuted) {
    console.log(`  ${colorize.blue`${command}`}`);
  }
  console.log();
  console.log("MCP servers installed:");
  console.log(`  ${colorize.green`https://mcp.stack-auth.com`}`);
  console.log();
  console.log("Files written:");
  for (const file of filesModified) {
    console.log(`  ${colorize.yellow`${file}`}`);
  }
  for (const file of filesCreated) {
    console.log(`  ${colorize.green`${file}`}`);
  }
  console.log();

  await capture("complete", {
    success: true,
    type,
    packageManager,
    isNeon,
    isClient,
    isServer,
    noBrowser,
    filesCreated,
    filesModified,
    commandsExecuted,
  });

  // Success!
  console.log(`
${colorize.green`===============================================`}

${colorize.green`Successfully installed Stack! 🚀🚀🚀`}

${colorize.bold`Next steps:`}

1. ${noBrowser ?
      `Create a project at https://app.stack-auth.com and get your API keys` :
      `Complete the setup in your browser to get your API keys`}
2. Add the API keys to your .env.local file
3. Import the Stack components in your app
4. Add authentication to your app

For more information, please visit https://docs.stack-auth.com/getting-started/setup
  `.trim());
  if (!noBrowser) {
    await open(`https://app.stack-auth.com/wizard-congrats?stack-init-id=${encodeURIComponent(distinctId)}`);
  }
  await ph_client.shutdown();
}

// eslint-disable-next-line no-restricted-syntax
main().catch(async (err) => {
  try {
    await capture("error", {
      error: err.message,
      errorType: err instanceof UserError ? "UserError" : "SystemError",
      stack: err.stack,
    });
  } catch (e) { }
  if (!(err instanceof UserError)) {
    console.error(err);
  }
  console.error('\n\n\n\n');
  console.log(colorize.red`===============================================`);
  console.error();
  if (err instanceof UserError) {
    console.error(`${colorize.red`ERROR!`} ${err.message}`);
  } else {
    console.error("An error occurred during the initialization process.");
  }
  console.error();
  console.log(colorize.red`===============================================`);
  console.error();
  console.error(
    "If you need assistance, please try installing Stack manually as described in https://docs.stack-auth.com/getting-started/setup or join our Discord where we're happy to help: https://discord.stack-auth.com"
  );
  if (!(err instanceof UserError)) {
    console.error("");
    console.error(`Error message: ${err.message}`);
  }
  console.error();
  await ph_client.shutdown();
  process.exit(1);
});


type PackageJson = {
  dependencies?: Record<string, string>,
  devDependencies?: Record<string, string>,
  [key: string]: any,
}

type ProjectInfo = {
  type: "js" | "next" | "react",
  srcPath: string,
  appPath: string,
  defaultExtension: string,
  indentation: string,
}

type NextProjectInfoError = {
  error: string,
}

type NextProjectInfoResult = ProjectInfo | NextProjectInfoError;

type StackAppFileOptions = {
  type: "js" | "next" | "react",
  srcPath: string,
  defaultExtension: string,
  indentation: string,
}

type StackAppFileResult = {
  fileName: string,
}

type ConvexIntegrationResult = {
  instructions: string[],
}

const Steps = {
  async getProject(): Promise<{ packageJson: PackageJson }> {
    let projectPath = await getProjectPath();
    logVerbose("Steps.getProject invoked", { projectPath });
    if (!fs.existsSync(projectPath)) {
      throw new UserError(`The project path ${projectPath} does not exist`);
    }

    const packageJsonPath = path.join(projectPath, "package.json");
    if (!fs.existsSync(packageJsonPath)) {
      throw new UserError(
        `The package.json file does not exist in the project path ${projectPath}. You must initialize a new project first before installing Stack.`
      );
    }

    const packageJsonText = fs.readFileSync(packageJsonPath, "utf-8");
    let packageJson: PackageJson;
    try {
      packageJson = JSON.parse(packageJsonText);
    } catch (e) {
      throw new UserError(`package.json file is not valid JSON: ${e}`);
    }

    logVerbose("Steps.getProject completed", {
      packageJsonPath,
      dependencyCounts: {
        dependencies: Object.keys(packageJson.dependencies ?? {}).length,
        devDependencies: Object.keys(packageJson.devDependencies ?? {}).length,
      },
    });

    return { packageJson };
  },

  async getProjectType({ packageJson }: { packageJson: PackageJson }): Promise<"js" | "next" | "react"> {
    if (typeFromArgs) {
      logVerbose("Steps.getProjectType using CLI override", { typeFromArgs });
      return typeFromArgs;
    }

    logVerbose("Steps.getProjectType attempting autodetect", {
      hasNext: Boolean(packageJson.dependencies?.["next"] || packageJson.devDependencies?.["next"]),
      hasReact: Boolean(packageJson.dependencies?.["react"] || packageJson.dependencies?.["react-dom"]),
      onQuestionMode,
    });

    const maybeNextProject = await Steps.maybeGetNextProjectInfo({ packageJson });
    if (!("error" in maybeNextProject)) {
      logVerbose("Steps.getProjectType resolved to Next.js project");
      return "next";
    }
    if (packageJson.dependencies?.["react"] || packageJson.dependencies?.["react-dom"]) {
      logVerbose("Steps.getProjectType resolved to React project");
      return "react";
    }
    if (onQuestionMode === "guess") {
      logVerbose("Steps.getProjectType defaulting to JS due to --on-question=guess");
      return "js";
    }
    if (onQuestionMode === "error") {
      throw new UnansweredQuestionError("Unable to auto-detect project type (checked for Next.js and React dependencies). Re-run with one of: --js, --react, or --next.");
    }

    const { type } = await inquirer.prompt([
      {
        type: "list",
        name: "type",
        message: "Which integration would you like to install?",
        choices: [
          { name: "Vanilla JS (other/no framework)", value: "js" },
          { name: "Node.js", value: "js" },
          { name: "React", value: "react" },
          { name: "Next.js", value: "next" },
        ]
      }
    ]);

    logVerbose("Steps.getProjectType received user selection", { type });
    return type;
  },

  async getStackPackageName(type: "js" | "next" | "react", install = false): Promise<string> {
    const mapping = {
      js: (install && process.env.STACK_JS_INSTALL_PACKAGE_NAME_OVERRIDE) || "@stackframe/js",
      next: (install && process.env.STACK_NEXT_INSTALL_PACKAGE_NAME_OVERRIDE) || "@stackframe/stack",
      react: (install && process.env.STACK_REACT_INSTALL_PACKAGE_NAME_OVERRIDE) || "@stackframe/react",
    } as const;
    const packageName = mapping[type];
    logVerbose("Steps.getStackPackageName resolved", { type, install, packageName });
    return packageName;
  },

  async addStackPackage(type: "js" | "next" | "react"): Promise<void> {
    const pkgName = await Steps.getStackPackageName(type, true);
    logVerbose("Steps.addStackPackage scheduling install", { pkgName });
    packagesToInstall.push(pkgName);
  },

  async getNextProjectInfo({ packageJson }: { packageJson: PackageJson }): Promise<ProjectInfo> {
    logVerbose("Steps.getNextProjectInfo invoked");
    const maybe = await Steps.maybeGetNextProjectInfo({ packageJson });
    if ("error" in maybe) {
      logVerbose("Steps.getNextProjectInfo failed validation", maybe);
      throw new UserError(maybe.error);
    }
    logVerbose("Steps.getNextProjectInfo resolved", maybe);
    return maybe;
  },

  async maybeGetNextProjectInfo({ packageJson }: { packageJson: PackageJson }): Promise<NextProjectInfoResult> {
    const projectPath = await getProjectPath();
    logVerbose("Steps.maybeGetNextProjectInfo evaluating Next.js eligibility", { projectPath });

    const nextVersionInPackageJson = packageJson.dependencies?.["next"] ?? packageJson.devDependencies?.["next"];
    if (!nextVersionInPackageJson) {
      logVerbose("Steps.maybeGetNextProjectInfo missing Next dependency");
      return { error: `The project at ${projectPath} does not appear to be a Next.js project, or does not have 'next' installed as a dependency.` };
    }
    if (!nextVersionInPackageJson) {
      logVerbose("Steps.maybeGetNextProjectInfo found unsupported Next version", { version: nextVersionInPackageJson });
      return { error: `The project at ${projectPath} is using an unsupported version of Next.js (found ${nextVersionInPackageJson}).\n\nOnly Next.js 14 & 15 projects are currently supported. See Next's upgrade guide: https://nextjs.org/docs/app/building-your-application/upgrading/version-14` };
    }

    const hasSrcAppFolder = fs.existsSync(path.join(projectPath, "src/app"));
    const srcPath = path.join(projectPath, hasSrcAppFolder ? "src" : "");
    const appPath = path.join(srcPath, "app");
    if (!fs.existsSync(appPath)) {
      logVerbose("Steps.maybeGetNextProjectInfo missing Next app directory", { appPath });
      return { error: `The app path ${appPath} does not exist. Only the Next.js App router is supported — are you maybe on the Pages router instead?` };
    }

    const nextConfigPathWithoutExtension = path.join(projectPath, "next.config");
    const nextConfigFileExtension = await findJsExtension(
      nextConfigPathWithoutExtension
    );
    const nextConfigPath =
      nextConfigPathWithoutExtension + "." + (nextConfigFileExtension ?? "js");
    if (!fs.existsSync(nextConfigPath)) {
      logVerbose("Steps.maybeGetNextProjectInfo missing next.config file", { nextConfigPath });
      return { error: `Expected file at ${nextConfigPath} for Next.js projects.` };
    }

    const dryUpdateNextLayoutFileResult = await Steps.dryUpdateNextLayoutFile({ appPath, defaultExtension: "jsx" });

    logVerbose("Steps.maybeGetNextProjectInfo success", {
      projectPath,
      srcPath,
      appPath,
      detectedExtension: dryUpdateNextLayoutFileResult.fileExtension,
    });
    return {
      type: "next",
      srcPath,
      appPath,
      defaultExtension: dryUpdateNextLayoutFileResult.fileExtension,
      indentation: dryUpdateNextLayoutFileResult.indentation,
    };
  },

  async writeEnvVars(type: "js" | "next" | "react"): Promise<boolean> {
    const projectPath = await getProjectPath();
    logVerbose("Steps.writeEnvVars invoked", { type, projectPath });

    // TODO: in non-Next environments, ask the user what method they prefer for envvars
    if (type !== "next") {
      logVerbose("Steps.writeEnvVars skipped", { reason: "non-next-project" });
      return false;
    }

    const envLocalPath = path.join(projectPath, ".env.local");

    const potentialEnvLocations = [
      path.join(projectPath, ".env"),
      path.join(projectPath, ".env.development"),
      path.join(projectPath, ".env.default"),
      path.join(projectPath, ".env.defaults"),
      path.join(projectPath, ".env.example"),
      envLocalPath,
    ];
    if (potentialEnvLocations.every((p) => !fs.existsSync(p))) {
      const envContent = noBrowser
        ? "# Stack Auth keys\n" +
        "# To get these variables:\n" +
        "# 1. Go to https://app.stack-auth.com\n" +
        "# 2. Create a new project\n" +
        "# 3. Copy the keys below\n" +
        `NEXT_PUBLIC_STACK_PROJECT_ID="${projectIdFromArgs ?? ""}"\n` +
        `NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY="${publishableClientKeyFromArgs ?? ""}"\n` +
        "STACK_SECRET_SERVER_KEY=\n"
        : "# Stack Auth keys\n" +
        "# Get these variables by creating a project on https://app.stack-auth.com.\n" +
        `NEXT_PUBLIC_STACK_PROJECT_ID="${projectIdFromArgs ?? ""}"\n` +
        `NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY="${publishableClientKeyFromArgs ?? ""}"\n` +
        "STACK_SECRET_SERVER_KEY=\n";

      laterWriteFile(envLocalPath, envContent);
      logVerbose("Steps.writeEnvVars scheduled .env.local creation", { envLocalPath });
      return true;
    }

    logVerbose("Steps.writeEnvVars found existing env files", { potentialEnvLocations });
    return false;
  },

  async maybeInstallConvexIntegration({ packageJson, type }: { packageJson: PackageJson, type: "js" | "next" | "react" }): Promise<ConvexIntegrationResult | null> {
    const hasConvexDependency = Boolean(packageJson.dependencies?.["convex"] || packageJson.devDependencies?.["convex"]);
    if (!hasConvexDependency) {
      logVerbose("Steps.maybeInstallConvexIntegration skipped", { reason: "no-convex-dependency" });
      return null;
    }

    const projectPath = await getProjectPath();
    const convexDir = path.join(projectPath, "convex");
    if (!fs.existsSync(convexDir)) {
      logVerbose("Steps.maybeInstallConvexIntegration skipped", { reason: "missing-convex-dir", convexDir });
      return null;
    }

    const stackPackageName = await Steps.getStackPackageName(type);
    const instructions: string[] = [];
    logVerbose("Steps.maybeInstallConvexIntegration configuring", { convexDir, stackPackageName });

    const authConfigPath = path.join(convexDir, "auth.config.ts");
    const desiredAuthConfig = createConvexAuthConfigContent({ stackPackageName, type });
    const existingAuthConfig = await readFile(authConfigPath);
    if (!existingAuthConfig || (!existingAuthConfig.includes("getConvexProvidersConfig") && !existingAuthConfig.includes("@stackframe/"))) {
      laterWriteFile(authConfigPath, desiredAuthConfig);
      logVerbose("Steps.maybeInstallConvexIntegration scheduled auth.config.ts update", { authConfigPath });
    }

    const convexConfigPath = path.join(convexDir, "convex.config.ts");
    const existingConvexConfig = await readFile(convexConfigPath);
    const desiredConvexConfig = createConvexIntegrationConvexConfigContent(stackPackageName);
    let needsManualConvexConfig = false;

    if (!existingConvexConfig) {
      laterWriteFile(convexConfigPath, desiredConvexConfig);
      logVerbose("Steps.maybeInstallConvexIntegration writing convex.config.ts from template", { convexConfigPath });
    } else if (existingConvexConfig.includes("app.use(stackAuthComponent") && existingConvexConfig.includes("/convex.config") && existingConvexConfig.includes("stackframe")) {
      // already integrated
      logVerbose("Steps.maybeInstallConvexIntegration detected existing convex.config.ts integration", { convexConfigPath });
    } else {
      const integratedContent = integrateConvexConfig(existingConvexConfig, stackPackageName);
      if (integratedContent) {
        laterWriteFile(convexConfigPath, integratedContent);
        logVerbose("Steps.maybeInstallConvexIntegration merged convex.config.ts content", { convexConfigPath });
      } else if (isSimpleConvexConfig(existingConvexConfig)) {
        laterWriteFile(convexConfigPath, desiredConvexConfig);
        logVerbose("Steps.maybeInstallConvexIntegration replaced simple convex.config.ts", { convexConfigPath });
      } else {
        needsManualConvexConfig = true;
        logVerbose("Steps.maybeInstallConvexIntegration requiring manual convex.config.ts review", { convexConfigPath });
      }
    }

    if (needsManualConvexConfig) {
      instructions.push(`Update convex/convex.config.ts to import ${stackPackageName}/convex.config and call app.use(stackAuthComponent).`);
    }

    const convexClientUpdateResult = await updateConvexClients({ projectPath, type });
    if (convexClientUpdateResult.skippedFiles.length > 0) {
      instructions.push("Review your Convex client setup and call stackClientApp.getConvexClientAuth({}) or stackServerApp.getConvexClientAuth({}) manually where needed.");
    }
    logVerbose("Steps.maybeInstallConvexIntegration client update summary", convexClientUpdateResult);

    instructions.push(
      "Set the Stack Auth environment variables in Convex (Deployment → Settings → Environment Variables).",
      "Verify your Convex clients call stackClientApp.getConvexClientAuth({}) or stackServerApp.getConvexClientAuth({}) so they share authentication with Stack Auth."
    );

    logVerbose("Steps.maybeInstallConvexIntegration completed", { instructions });
    return { instructions };
  },

  async dryUpdateNextLayoutFile({ appPath, defaultExtension }: { appPath: string, defaultExtension: string }): Promise<{
    path: string,
    updatedContent: string,
    fileExtension: string,
    indentation: string,
  }> {
    const layoutPathWithoutExtension = path.join(appPath, "layout");
    const layoutFileExtension =
      (await findJsExtension(layoutPathWithoutExtension)) ?? defaultExtension;
    const layoutPath = layoutPathWithoutExtension + "." + layoutFileExtension;
    const layoutContent =
      (await readFile(layoutPath)) ??
      throwErr(
        `The layout file at ${layoutPath} does not exist. Stack requires a layout file to be present in the /app folder.`
      );
    const updatedLayoutResult =
      (await getUpdatedLayout(layoutContent)) ??
      throwErr(
        "Unable to parse root layout file. Make sure it contains a <body> tag. If it still doesn't work, you may need to manually install Stack. See: https://nextjs.org/docs/app/building-your-application/routing/pages-and-layouts#root-layout-required"
      );
    const updatedLayoutContent = updatedLayoutResult.content;
    return {
      path: layoutPath,
      updatedContent: updatedLayoutContent,
      fileExtension: layoutFileExtension,
      indentation: updatedLayoutResult.indentation
    };
  },

  async updateNextLayoutFile(projectInfo: ProjectInfo): Promise<{
    path: string,
    updatedContent: string,
    fileExtension: string,
    indentation: string,
  }> {
    logVerbose("Steps.updateNextLayoutFile invoked", projectInfo);
    const res = await Steps.dryUpdateNextLayoutFile(projectInfo);
    laterWriteFile(res.path, res.updatedContent);
    logVerbose("Steps.updateNextLayoutFile scheduled write", { path: res.path });
    return res;
  },

  async writeStackAppFile({ type, srcPath, defaultExtension, indentation }: StackAppFileOptions, clientOrServer: "server" | "client", alsoHasClient: boolean): Promise<StackAppFileResult> {
    logVerbose("Steps.writeStackAppFile invoked", { type, srcPath, clientOrServer, alsoHasClient });
    const packageName = await Steps.getStackPackageName(type);

    const clientOrServerCap = {
      client: "Client",
      server: "Server",
    }[clientOrServer as "client" | "server"];
    const relativeStackAppPath = `stack/${clientOrServer}`;

    const stackAppPathWithoutExtension = path.join(srcPath, relativeStackAppPath);
    const stackAppFileExtension =
      (await findJsExtension(stackAppPathWithoutExtension)) ?? defaultExtension;
    const stackAppPath =
      stackAppPathWithoutExtension + "." + stackAppFileExtension;
    const stackAppContent = await readFile(stackAppPath);
    if (stackAppContent) {
      logVerbose("Steps.writeStackAppFile found existing file", { stackAppPath });
      if (!stackAppContent.includes("@stackframe/")) {
        throw new UserError(
          `A file at the path ${stackAppPath} already exists. Stack uses the stack/${clientOrServer}.ts file to initialize the Stack SDK. Please remove the existing file and try again.`
        );
      }
      throw new UserError(
        `It seems that you already installed Stack in this project.`
      );
    }

    const tokenStore = type === "next" ? '"nextjs-cookie"' : (clientOrServer === "client" ? '"cookie"' : '"memory"');
    const publishableClientKeyWrite = clientOrServer === "server"
      ? `process.env.STACK_PUBLISHABLE_CLIENT_KEY ${publishableClientKeyFromArgs ? `|| ${JSON.stringify(publishableClientKeyFromArgs)}` : ""}`
      : `'${publishableClientKeyFromArgs ?? 'INSERT_YOUR_PUBLISHABLE_CLIENT_KEY_HERE'}'`;
    const jsOptions = type === "js" ? [
      `\n\n${indentation}// get your Stack Auth API keys from https://app.stack-auth.com${clientOrServer === "client" ? ` and store them in a safe place (e.g. environment variables)` : ""}`,
      `${projectIdFromArgs ? `${indentation}projectId: ${JSON.stringify(projectIdFromArgs)},` : ""}`,
      `${indentation}publishableClientKey: ${publishableClientKeyWrite},`,
      `${clientOrServer === "server" ? `${indentation}secretServerKey: process.env.STACK_SECRET_SERVER_KEY,` : ""}`,
    ].filter(Boolean).join("\n") : "";

    const nextClientOptions = (type === "next" && clientOrServer === "client")
      ? (() => {
        const lines = [
          projectIdFromArgs ? `${indentation}projectId: process.env.NEXT_PUBLIC_STACK_PROJECT_ID ?? ${JSON.stringify(projectIdFromArgs)},` : "",
          publishableClientKeyFromArgs ? `${indentation}publishableClientKey: process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY ?? ${JSON.stringify(publishableClientKeyFromArgs)},` : "",
        ].filter(Boolean).join("\n");
        return lines ? `\n${lines}` : "";
      })()
      : "";

    const shouldInheritFromClient = clientOrServer === "server" && alsoHasClient;

    laterWriteFileIfNotExists(
      stackAppPath,
      `
${type === "next" && clientOrServer === "server" ? `import "server-only";\n\n` : ""}import { Stack${clientOrServerCap}App } from ${JSON.stringify(packageName)};
${shouldInheritFromClient ? `import { stackClientApp } from "./client";\n\n` : "\n"}export const stack${clientOrServerCap}App = new Stack${clientOrServerCap}App({
${shouldInheritFromClient ? `${indentation}inheritsFrom: stackClientApp,` : `${indentation}tokenStore: ${tokenStore},${jsOptions}${nextClientOptions}`}
});
      `.trim() + "\n"
    );
    logVerbose("Steps.writeStackAppFile scheduled creation", { stackAppPath, inheritsFromClient: shouldInheritFromClient });
    return { fileName: stackAppPath };
  },

  async writeReactClientFile({ srcPath, defaultExtension, indentation, hasReactRouterDom }: { srcPath: string, defaultExtension: string, indentation: string, hasReactRouterDom: boolean }): Promise<StackAppFileResult> {
    logVerbose("Steps.writeReactClientFile invoked", { srcPath, hasReactRouterDom });
    const packageName = await Steps.getStackPackageName("react");
    const relativeStackAppPath = `stack/client`;
    const stackAppPathWithoutExtension = path.join(srcPath, relativeStackAppPath);
    const stackAppFileExtension = (await findJsExtension(stackAppPathWithoutExtension)) ?? defaultExtension;
    const stackAppPath = stackAppPathWithoutExtension + "." + stackAppFileExtension;
    const stackAppContent = await readFile(stackAppPath);
    if (stackAppContent) {
      logVerbose("Steps.writeReactClientFile found existing file", { stackAppPath });
      if (!stackAppContent.includes("@stackframe/")) {
        throw new UserError(`A file at the path ${stackAppPath} already exists. Stack uses the stack/client.ts file to initialize the Stack SDK. Please remove the existing file and try again.`);
      }
      throw new UserError(`It seems that you already installed Stack in this project.`);
    }

    const publishableClientKeyWrite = `'${publishableClientKeyFromArgs ?? 'INSERT_YOUR_PUBLISHABLE_CLIENT_KEY_HERE'}'`;
    const projectIdWrite = `'${projectIdFromArgs ?? 'INSERT_PROJECT_ID'}'`;

    const imports = hasReactRouterDom
      ? `import { StackClientApp } from ${JSON.stringify(packageName)};\nimport { useNavigate } from "react-router-dom";\n\n`
      : `import { StackClientApp } from ${JSON.stringify(packageName)};\n\n`;

    const redirectMethod = hasReactRouterDom
      ? `,\n${indentation}redirectMethod: {\n${indentation}${indentation}useNavigate,\n${indentation}}`
      : "";

    laterWriteFileIfNotExists(
      stackAppPath,
      `${imports}export const stackClientApp = new StackClientApp({ \n${indentation}tokenStore: "cookie", \n${indentation}projectId: ${projectIdWrite}, \n${indentation}publishableClientKey: ${publishableClientKeyWrite}${redirectMethod}, \n}); \n`
    );
    logVerbose("Steps.writeReactClientFile scheduled creation", { stackAppPath });
    return { fileName: stackAppPath };
  },

  async writeNextHandlerFile(projectInfo: ProjectInfo): Promise<void> {
    logVerbose("Steps.writeNextHandlerFile invoked", projectInfo);
    const handlerPathWithoutExtension = path.join(
      projectInfo.appPath,
      "handler/[...stack]/page"
    );
    const handlerFileExtension =
      (await findJsExtension(handlerPathWithoutExtension)) ?? projectInfo.defaultExtension;
    const handlerPath = handlerPathWithoutExtension + "." + handlerFileExtension;
    const handlerContent = await readFile(handlerPath);
    if (handlerContent && !handlerContent.includes("@stackframe/")) {
      logVerbose("Steps.writeNextHandlerFile found conflicting file", { handlerPath });
      throw new UserError(
        `A file at the path ${handlerPath} already exists.Stack uses the / handler path to handle incoming requests.Please remove the existing file and try again.`
      );
    }
    laterWriteFileIfNotExists(
      handlerPath,
      `import { StackHandler } from "@stackframe/stack"; \n\nexport default function Handler() { \n${projectInfo.indentation}return <StackHandler fullPage />; \n} \n`
    );
  },

  async writeNextLoadingFile(projectInfo: ProjectInfo): Promise<void> {
    logVerbose("Steps.writeNextLoadingFile invoked", projectInfo);
    let loadingPathWithoutExtension = path.join(projectInfo.appPath, "loading");
    const loadingFileExtension =
      (await findJsExtension(loadingPathWithoutExtension)) ?? projectInfo.defaultExtension;
    const loadingPath = loadingPathWithoutExtension + "." + loadingFileExtension;
    laterWriteFileIfNotExists(
      loadingPath,
      `export default function Loading() {
\n${projectInfo.indentation}// Stack uses React Suspense, which will render this page while user data is being fetched.\n${projectInfo.indentation}// See: https://nextjs.org/docs/app/api-reference/file-conventions/loading\n${projectInfo.indentation}return <></>;\n}\n`
    );
  },

  async getPackageManager(): Promise<{ packageManager: string }> {
    if (packageManagerFromArgs) {
      logVerbose("Steps.getPackageManager using CLI override", { packageManager: packageManagerFromArgs });
      return { packageManager: packageManagerFromArgs };
    }
    const packageManager = await promptPackageManager();
    const versionCommand = `${packageManager} --version`;
    logVerbose("Steps.getPackageManager checking binary availability", { packageManager });

    try {
      await shellNicelyFormatted(versionCommand, { shell: true, quiet: true });
    } catch (err) {
      console.error(err);
      throw new UserError(
        `Could not run the package manager command '${versionCommand}'. Please make sure ${packageManager} is installed on your system.`
      );
    }

    logVerbose("Steps.getPackageManager resolved", { packageManager });
    return { packageManager };
  },

  async ensureReady(type: "js" | "next" | "react"): Promise<void> {
    const projectPath = await getProjectPath();

    const typeStringMap = {
      js: "JavaScript",
      next: "Next.js",
      react: "React",
    } as const;
    const typeString = typeStringMap[type];
    const isReady = (onQuestionMode !== "ask") || (await inquirer.prompt([
      {
        type: "confirm",
        name: "ready",
        message: `Found a ${typeString} project at ${projectPath} — ready to install Stack Auth?`,
        default: true,
      },
    ])).ready;
    if (!isReady) {
      throw new UserError("Installation aborted.");
    }
    logVerbose("Steps.ensureReady confirmed", { type, projectPath, isReady });
  },

  async getServerOrClientOrBoth(): Promise<Array<"server" | "client">> {
    logVerbose("Steps.getServerOrClientOrBoth invoked", { isClientFlag: isClient, isServerFlag: isServer, onQuestionMode });
    if (isClient && isServer) {
      logVerbose("Steps.getServerOrClientOrBoth using CLI flags", { selection: ["server", "client"] });
      return ["server", "client"];
    }
    if (isServer) {
      logVerbose("Steps.getServerOrClientOrBoth using server flag");
      return ["server"];
    }
    if (isClient) {
      logVerbose("Steps.getServerOrClientOrBoth using client flag");
      return ["client"];
    }

    if (onQuestionMode === "guess") {
      logVerbose("Steps.getServerOrClientOrBoth defaulting to both");
      return ["server", "client"];
    }
    if (onQuestionMode === "error") {
      throw new UnansweredQuestionError("Ambiguous installation type. Re-run with --server, --client, or both.");
    }

    const selection = (await inquirer.prompt([{
      type: "list",
      name: "type",
      message: "Do you want to use Stack Auth on the server, or on the client?",
      choices: [
        { name: "Client (e.g. Vite, HTML)", value: ["client"] },
        { name: "Server (e.g. Node.js)", value: ["server"] },
        { name: "Both (e.g. Next.js)", value: ["server", "client"] }
      ]
    }])).type;
    logVerbose("Steps.getServerOrClientOrBoth received user selection", { selection });
    return selection;
  },

  /**
   * note: this is a heuristic, specific frameworks may have better heuristics (e.g. the Next.js code uses the extension of the global layout file)
  */
  async guessDefaultFileExtension(): Promise<string> {
    const projectPath = await getProjectPath();
    const hasTsConfig = fs.existsSync(
      path.join(projectPath, "tsconfig.json")
    );
    const extension = hasTsConfig ? "ts" : "js";
    logVerbose("Steps.guessDefaultFileExtension result", { projectPath, hasTsConfig, extension });
    return extension;
  },

  /**
   * note: this is a heuristic, specific frameworks may have better heuristics (e.g. the Next.js code uses the location of the app folder)
   */
  async guessSrcPath(): Promise<string> {
    const projectPath = await getProjectPath();
    const potentialSrcPath = path.join(projectPath, "src");
    const hasSrcFolder = fs.existsSync(
      path.join(projectPath, "src")
    );
    const resolvedPath = hasSrcFolder ? potentialSrcPath : projectPath;
    logVerbose("Steps.guessSrcPath result", { hasSrcFolder, resolvedPath });
    return resolvedPath;
  },


};


type LayoutResult = {
  content: string,
  indentation: string,
}

async function getUpdatedLayout(originalLayout: string): Promise<LayoutResult | undefined> {
  logVerbose("getUpdatedLayout invoked", { length: originalLayout.length });
  let layout = originalLayout;
  const indentation = guessIndentation(originalLayout);

  const firstImportLocationM1 = /\simport\s/.exec(layout)?.index;
  const hasStringAsFirstLine = layout.startsWith('"') || layout.startsWith("'");
  const importInsertLocationM1 =
    firstImportLocationM1 ?? (hasStringAsFirstLine ? layout.indexOf("\n") : -1);
  const importInsertLocation = importInsertLocationM1 + 1;
  const importStatement = `import { StackProvider, StackTheme } from "@stackframe/stack";\nimport { stackClientApp } from "../stack/client";\n`;
  layout =
    layout.slice(0, importInsertLocation) +
    importStatement +
    layout.slice(importInsertLocation);

  const bodyOpenTag = /<\s*body[^>]*>/.exec(layout);
  const bodyCloseTag = /<\s*\/\s*body[^>]*>/.exec(layout);
  if (!bodyOpenTag || !bodyCloseTag) {
    logVerbose("getUpdatedLayout missing body tag");
    return undefined;
  }
  const bodyOpenEndIndex = bodyOpenTag.index + bodyOpenTag[0].length;
  const bodyCloseStartIndex = bodyCloseTag.index;
  if (bodyCloseStartIndex <= bodyOpenEndIndex) {
    logVerbose("getUpdatedLayout invalid body indices", { bodyOpenEndIndex, bodyCloseStartIndex });
    return undefined;
  }

  const lines = layout.split("\n");
  const [bodyOpenEndLine, bodyOpenEndIndexInLine] = getLineIndex(
    lines,
    bodyOpenEndIndex
  );
  const [bodyCloseStartLine, bodyCloseStartIndexInLine] = getLineIndex(
    lines,
    bodyCloseStartIndex
  );

  const insertOpen = "<StackProvider app={stackClientApp}><StackTheme>";
  const insertClose = "</StackTheme></StackProvider>";

  layout =
    layout.slice(0, bodyCloseStartIndex) +
    insertClose +
    layout.slice(bodyCloseStartIndex);
  layout =
    layout.slice(0, bodyOpenEndIndex) +
    insertOpen +
    layout.slice(bodyOpenEndIndex);

  logVerbose("getUpdatedLayout success", { updatedLength: layout.length });
  return {
    content: `${layout}`,
    indentation,
  };
}

function guessIndentation(str: string): string {
  const lines = str.split("\n");
  const linesLeadingWhitespaces = lines
    .map((line) => line.match(/^\s*/)![0])
    .filter((ws) => ws.length > 0);
  const isMostlyTabs =
    linesLeadingWhitespaces.filter((ws) => ws.includes("\t")).length >=
    (linesLeadingWhitespaces.length * 2) / 3;
  if (isMostlyTabs) return "\t";
  const linesLeadingWhitespacesCount = linesLeadingWhitespaces.map(
    (ws) => ws.length
  );
  const min = Math.min(Infinity, ...linesLeadingWhitespacesCount);
  return Number.isFinite(min) ? " ".repeat(Math.max(2, min)) : "  ";
}

function getLineIndex(lines: string[], stringIndex: number): [number, number] {
  let lineIndex = 0;
  for (let l = 0; l < lines.length; l++) {
    const line = lines[l];
    if (stringIndex < lineIndex + line.length) {
      return [l, stringIndex - lineIndex];
    }
    lineIndex += line.length + 1;
  }
  throw new Error(
    `Index ${stringIndex} is out of bounds for lines ${JSON.stringify(lines)}`
  );
}

async function getProjectPath(): Promise<string> {
  logVerbose("getProjectPath invoked", { savedProjectPath });
  if (savedProjectPath === undefined) {
    savedProjectPath = process.cwd();

    const askForPathModification = !fs.existsSync(
      path.join(savedProjectPath, "package.json")
    );
    if (askForPathModification) {
      logVerbose("getProjectPath did not find package.json in cwd", { cwd: savedProjectPath });
      if (onQuestionMode === "guess" || onQuestionMode === "error") {
        throw new UserError(`No package.json file found in ${savedProjectPath}. Re-run providing the project path argument (e.g. 'init-stack <project-path>').`);
      }
      savedProjectPath = (
        await inquirer.prompt([
          {
            type: "input",
            name: "newPath",
            message: "Please enter the path to your project:",
            default: ".",
          },
        ])
      ).newPath;
      logVerbose("getProjectPath received manual input", { savedProjectPath });
    }
  }
  logVerbose("getProjectPath resolved", { savedProjectPath });
  return savedProjectPath as string;
}

async function ensureGitWorkspaceIsReady(projectPath: string): Promise<void> {
  if (!warnUncommittedChanges) {
    logVerbose("ensureGitWorkspaceIsReady skipped as requested by user");
    return;
  }

  logVerbose("ensureGitWorkspaceIsReady invoked", { projectPath });
  let isGitRepo = false;
  try {
    const gitRepoResult = child_process.spawnSync(
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      {
        shell: true,
        cwd: projectPath,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }
    );
    isGitRepo = gitRepoResult.status === 0 && gitRepoResult.stdout.trim() === "true";
  } catch (e) {
    logVerbose("ensureGitWorkspaceIsReady failed to detect git repository", { error: e });
    return;
  }
  if (!isGitRepo) {
    logVerbose("ensureGitWorkspaceIsReady skipping", { reason: "not-a-git-repo" });
    return;
  }

  const statusResult = child_process.spawnSync(
    "git",
    ["status", "--porcelain"],
    {
      shell: true,
      cwd: projectPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  if (statusResult.error || statusResult.status !== 0) {
    logVerbose("ensureGitWorkspaceIsReady git status failed", { status: statusResult.status, error: statusResult.error });
    return;
  }

  const lines = statusResult.stdout
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.length > 0);

  const unstagedLines = lines.filter((line) => {
    if (line.startsWith("!!")) return false;
    if (line.startsWith("??")) return true;
    if (line.length < 2) return false;
    const workingTreeStatus = line[1];
    return Boolean(workingTreeStatus && workingTreeStatus !== " ");
  });

  if (unstagedLines.length === 0) {
    logVerbose("ensureGitWorkspaceIsReady clean working tree");
    return;
  }

  const changedFiles = unstagedLines.map((line) => {
    const filePath = line.slice(3).trim();
    return filePath.length > 0 ? filePath : line;
  });

  console.log();
  console.log(colorize.yellow`Detected unstaged/uncommitted changes in your Git repository:`);
  const filesToShow = changedFiles.slice(0, 10);
  for (const file of filesToShow) {
    console.log(`  - ${file}`);
  }
  if (changedFiles.length > filesToShow.length) {
    console.log(`  - ...and ${changedFiles.length - filesToShow.length} more`);
  }
  console.log(colorize.yellow`You may want to stage and commit these changes before installing Stack Auth, so you can review the changes afterwards.`);
  console.log();

  if (onQuestionMode === "guess") {
    console.log(colorize.yellow`Continuing because --on-question=guess.`);
    return;
  }
  if (onQuestionMode === "error") {
    throw new UnansweredQuestionError("Unstaged changes detected in the project directory");
  }

  const { proceed } = await inquirer.prompt([
    {
      type: "confirm",
      name: "proceed",
      message: "Continue with Stack initialization anyway?",
      default: false,
    },
  ]);

  if (!proceed) {
    throw new UserError("Aborting Stack initialization to avoid overwriting unstaged changes.");
  }
  logVerbose("ensureGitWorkspaceIsReady user confirmed proceed despite unstaged changes");
}

async function findJsExtension(fullPathWithoutExtension: string): Promise<string | null> {
  logVerbose("findJsExtension invoked", { fullPathWithoutExtension });
  for (const ext of jsLikeFileExtensions) {
    const fullPath = fullPathWithoutExtension + "." + ext;
    if (fs.existsSync(fullPath)) {
      logVerbose("findJsExtension found file", { fullPath, ext });
      return ext;
    }
  }
  logVerbose("findJsExtension no matching file", { fullPathWithoutExtension });
  return null;
}

async function promptPackageManager(): Promise<string> {
  const projectPath = await getProjectPath();
  const yarnLock = fs.existsSync(path.join(projectPath, "yarn.lock"));
  const pnpmLock = fs.existsSync(path.join(projectPath, "pnpm-lock.yaml"));
  const npmLock = fs.existsSync(path.join(projectPath, "package-lock.json"));
  const bunLock = fs.existsSync(path.join(projectPath, "bun.lockb")) || fs.existsSync(path.join(projectPath, "bun.lock"));

  logVerbose("promptPackageManager inspecting lockfiles", { yarnLock, pnpmLock, npmLock, bunLock });

  if (yarnLock && !pnpmLock && !npmLock && !bunLock) {
    logVerbose("promptPackageManager auto-selected yarn");
    return "yarn";
  } else if (!yarnLock && pnpmLock && !npmLock && !bunLock) {
    logVerbose("promptPackageManager auto-selected pnpm");
    return "pnpm";
  } else if (!yarnLock && !pnpmLock && npmLock && !bunLock) {
    logVerbose("promptPackageManager auto-selected npm");
    return "npm";
  } else if (!yarnLock && !pnpmLock && !npmLock && bunLock) {
    logVerbose("promptPackageManager auto-selected bun");
    return "bun";
  }

  if (onQuestionMode === "guess") {
    logVerbose("promptPackageManager defaulting to npm due to guess mode");
    return "npm";
  }
  if (onQuestionMode === "error") {
    throw new UnansweredQuestionError("Unable to determine the package manager. Re-run with one of: --npm, --yarn, --pnpm, or --bun.");
  }

  const answers = await inquirer.prompt([
    {
      type: "list",
      name: "packageManager",
      message: "Which package manager are you using for this project?",
      choices: ["npm", "yarn", "pnpm", "bun"],
    },
  ]);
  logVerbose("promptPackageManager user selected", { packageManager: answers.packageManager });
  return answers.packageManager;
}

type ShellOptions = {
  quiet?: boolean,
  shell?: boolean,
  cwd?: string,
  [key: string]: any,
}

async function shellNicelyFormatted(command: string, { quiet, ...options }: ShellOptions): Promise<void> {
  logVerbose("shellNicelyFormatted invoked", { command, options: { ...options, quiet } });
  let ui: any;
  let interval: NodeJS.Timeout | undefined;
  if (!quiet) {
    console.log();
    ui = new inquirer.ui.BottomBar();
    let dots = 4;
    ui.updateBottomBar(
      colorize.blue`Running command: ${command}...`
    );
    interval = setInterval(() => {
      if (!isDryRun) {
        ui.updateBottomBar(
          colorize.blue`Running command: ${command}${".".repeat(dots++ % 5)}`
        );
      }
    }, 700);
  }

  try {
    if (!isDryRun) {
      const child = child_process.spawn(command, options);
      logVerbose("shellNicelyFormatted spawned process", { pid: child.pid, command });
      if (!quiet) {
        child.stdout.pipe(ui.log);
        child.stderr.pipe(ui.log);
      }

      await new Promise<void>((resolve, reject) => {
        child.on("exit", (code) => {
          if (code === 0) {
            resolve();
          } else {
            logVerbose("shellNicelyFormatted command failed", { code });
            reject(new Error(`Command ${command} failed with code ${code}`));
          }
        });
      });
    } else {
      console.log(`[DRY-RUN] Would have run: ${command}`);
      logVerbose("shellNicelyFormatted skipped due to dry run", { command });
    }

    if (!quiet) {
      commandsExecuted.push(command);
      ui.updateBottomBar(
        `${colorize.green`√`} Command ${command} succeeded\n`
      );
    }
    logVerbose("shellNicelyFormatted completed", { command });
  } catch (e) {
    logVerbose("shellNicelyFormatted encountered error", { command, error: e instanceof Error ? { message: e.message, stack: e.stack } : e });
    if (!quiet) {
      ui.updateBottomBar(
        `${colorize.red`X`} Command ${command} failed\n`
      );
    }
    throw e;
  } finally {
    if (interval) {
      clearTimeout(interval);
    }
    if (!quiet) {
      ui.close();
    }
  }
}

async function readFile(fullPath: string): Promise<string | null> {
  logVerbose("readFile invoked", { fullPath, isDryRun });
  try {
    if (!isDryRun) {
      const content = fs.readFileSync(fullPath, "utf-8");
      logVerbose("readFile succeeded", { fullPath, length: content.length });
      return content;
    }
    logVerbose("readFile skipped due to dry run", { fullPath });
    return null;
  } catch (err: any) {
    if (err.code === "ENOENT") {
      logVerbose("readFile file missing", { fullPath });
      return null;
    }
    logVerbose("readFile errored", { fullPath, error: err instanceof Error ? { message: err.message, stack: err.stack } : err });
    throw err;
  }
}

async function writeFile(fullPath: string, content: string): Promise<void> {
  logVerbose("writeFile invoked", { fullPath, length: content.length, isDryRun });
  let create = !fs.existsSync(fullPath);
  if (!isDryRun) {
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
    logVerbose("writeFile wrote to disk", { fullPath, created: create });
  } else {
    console.log(`[DRY-RUN] Would have written to ${fullPath}`);
    logVerbose("writeFile skipped due to dry run", { fullPath });
  }
  const relativeToProjectPath = path.relative(await getProjectPath(), fullPath);
  if (!create) {
    filesModified.push(relativeToProjectPath);
  } else {
    filesCreated.push(relativeToProjectPath);
  }
  logVerbose("writeFile recorded change", { relativeToProjectPath, created: create });
}

function laterWriteFile(fullPath: string, content: string): void {
  logVerbose("laterWriteFile scheduled", { fullPath, length: content.length });
  writeFileHandlers.push(async () => {
    await writeFile(fullPath, content);
  });
}

async function writeFileIfNotExists(fullPath: string, content: string): Promise<void> {
  if (!fs.existsSync(fullPath)) {
    logVerbose("writeFileIfNotExists writing new file", { fullPath });
    await writeFile(fullPath, content);
  } else {
    logVerbose("writeFileIfNotExists skipped", { fullPath });
  }
}

function laterWriteFileIfNotExists(fullPath: string, content: string): void {
  logVerbose("laterWriteFileIfNotExists scheduled", { fullPath });
  writeFileHandlers.push(async () => {
    await writeFileIfNotExists(fullPath, content);
  });
}

async function runDeferredCommands(): Promise<void> {
  if (!deferredCommandHandlers.length) {
    logVerbose("runDeferredCommands skipped", { reason: "no-handlers" });
    return;
  }
  logVerbose("runDeferredCommands executing handlers", { count: deferredCommandHandlers.length });
  for (let index = 0; index < deferredCommandHandlers.length; index++) {
    logVerbose("runDeferredCommands executing handler", { index });
    const handler = deferredCommandHandlers[index];
    await handler();
  }
  logVerbose("runDeferredCommands completed");
}

type RunScheduledCommandMetadata = {
  recordInCommandsExecuted?: boolean,
};

async function runScheduledCommand(
  command: string,
  args: string[],
  options: child_process.SpawnSyncOptions = {},
  metadata: RunScheduledCommandMetadata = {},
): Promise<void> {
  logVerbose("runScheduledCommand invoked", { command, args, options, isDryRun });
  const display = [command, ...args].join(" ");
  if (isDryRun) {
    console.log(`[DRY-RUN] Would run: ${display}`);
    logVerbose("runScheduledCommand skipped due to dry run", { display });
    return;
  }

  const result = child_process.spawnSync(command, args, {
    stdio: "pipe",
    ...options,
  });
  const recordInCommandsExecuted = metadata.recordInCommandsExecuted;
  if (recordInCommandsExecuted && !commandsExecuted.includes(display)) {
    commandsExecuted.push(display);
  }
  if (result.status === 0) {
    console.log(`${colorize.green`√`} ${display}`);
    logVerbose("runScheduledCommand succeeded", { display });
  } else {
    logVerbose("runScheduledCommand failed", { display, result, stderr: result.stderr.toString(), stdout: result.stdout.toString() });
    throw new Error(`Command ${display} failed with status ${result.status}: ${result.stderr.toString()}`);
  }
}

async function recordFileChange(fullPath: string, existed: boolean): Promise<void> {
  logVerbose("recordFileChange invoked", { fullPath, existed });
  const projectRoot = path.resolve(await getProjectPath());
  const relative = path.relative(projectRoot, fullPath);
  const insideProject = relative && !relative.startsWith("..") && !path.isAbsolute(relative);
  const entry = insideProject ? relative : fullPath;

  if (existed) {
    if (!filesModified.includes(entry)) {
      filesModified.push(entry);
    }
    logVerbose("recordFileChange marked modified", { entry });
  } else if (!filesCreated.includes(entry)) {
    filesCreated.push(entry);
    logVerbose("recordFileChange marked created", { entry });
  }
}

function createConvexAuthConfigContent(options: { stackPackageName: string, type: "js" | "next" | "react" }): string {
  const envVarName = getPublicProjectEnvVarName(options.type);
  return `import { getConvexProvidersConfig } from ${JSON.stringify(options.stackPackageName)};

export default {
  providers: getConvexProvidersConfig({
    projectId: process.env.${envVarName},
  }),
};
`;
}

function createConvexIntegrationConvexConfigContent(stackPackageName: string): string {
  const importPath = `${stackPackageName}/convex.config`;
  return `import stackAuthComponent from ${JSON.stringify(importPath)};
import { defineApp } from "convex/server";

const app = defineApp();
app.use(stackAuthComponent);

export default app;
`;
}

function integrateConvexConfig(existingContent: string, stackPackageName: string): string | null {
  if (!existingContent.includes("defineApp")) {
    return null;
  }

  const newline = existingContent.includes("\r\n") ? "\r\n" : "\n";
  const normalizedLines = existingContent.replace(/\r\n/g, "\n").split("\n");
  const importPath = `${stackPackageName}/convex.config`;

  const hasImport = normalizedLines.some((line) => line.includes(importPath));
  if (!hasImport) {
    let insertIndex = 0;
    while (insertIndex < normalizedLines.length && normalizedLines[insertIndex].trim() === "") {
      insertIndex++;
    }
    while (insertIndex < normalizedLines.length && normalizedLines[insertIndex].trim().startsWith("import")) {
      insertIndex++;
    }
    normalizedLines.splice(insertIndex, 0, `import stackAuthComponent from "${importPath}";`);
  }

  let lastImportIndex = -1;
  for (let i = 0; i < normalizedLines.length; i++) {
    if (normalizedLines[i].trim().startsWith("import")) {
      lastImportIndex = i;
      continue;
    }
    if (normalizedLines[i].trim() === "") {
      continue;
    }
    break;
  }
  if (lastImportIndex >= 0) {
    const nextIndex = lastImportIndex + 1;
    if (!normalizedLines[nextIndex] || normalizedLines[nextIndex].trim() !== "") {
      normalizedLines.splice(nextIndex, 0, "");
    }
  }

  const hasStackUse = normalizedLines.some((line) => line.includes("app.use(stackAuthComponent"));
  if (!hasStackUse) {
    const appLineIndex = normalizedLines.findIndex((line) => /const\s+app\s*=\s*defineApp/.test(line));
    if (appLineIndex === -1) {
      return null;
    }
    const indent = normalizedLines[appLineIndex].match(/^\s*/)?.[0] ?? "";
    const insertIndexForUse = appLineIndex + 1;
    normalizedLines.splice(insertIndexForUse, 0, `${indent}app.use(stackAuthComponent);`);
    const nextLineIndex = insertIndexForUse + 1;
    if (!normalizedLines[nextLineIndex] || normalizedLines[nextLineIndex].trim() !== "") {
      normalizedLines.splice(nextLineIndex, 0, "");
    }
  }

  let updated = normalizedLines.join(newline);
  if (!updated.endsWith(newline)) {
    updated += newline;
  }
  return updated;
}

function isSimpleConvexConfig(content: string): boolean {
  const normalized = content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (normalized.length !== 3) {
    return false;
  }
  const [line1, line2, line3] = normalized;
  const importRegex = /^import\s+\{\s*defineApp\s*\}\s+from\s+['"]convex\/server['"];?$/;
  const appRegex = /^const\s+app\s*=\s*defineApp\(\s*\);?$/;
  const exportRegex = /^export\s+default\s+app;?$/;
  return importRegex.test(line1) && appRegex.test(line2) && exportRegex.test(line3);
}

function getPublicProjectEnvVarName(type: "js" | "next" | "react"): string {
  if (type === "react") {
    return "VITE_PUBLIC_STACK_PROJECT_ID";
  }
  if (type === "next") {
    return "NEXT_PUBLIC_STACK_PROJECT_ID";
  }
  return "STACK_PROJECT_ID";
}

type ConvexClientUpdateResult = {
  updatedFiles: string[],
  skippedFiles: string[],
};

type AddSetAuthResult = {
  updatedContent: string,
  changed: boolean,
  usedClientApp: boolean,
  usedServerApp: boolean,
  instantiationCount: number,
  skippedHttpCount: number,
};

async function updateConvexClients({ projectPath, type }: { projectPath: string, type: "js" | "next" | "react" }): Promise<ConvexClientUpdateResult> {
  const files = collectConvexClientCandidateFiles(projectPath);
  logVerbose("updateConvexClients collected files", { projectPath, count: files.length });
  const updatedFiles: string[] = [];
  const skippedFiles: string[] = [];

  for (const filePath of files) {
    logVerbose("updateConvexClients inspecting file", { filePath });
    const fileContent = await readFile(filePath);
    if (!fileContent) {
      logVerbose("updateConvexClients skipped file (no content)", { filePath });
      continue;
    }
    if (!/new\s+Convex(?:React|Http)?Client\b/.test(fileContent)) {
      logVerbose("updateConvexClients skipped file (no Convex client)", { filePath });
      continue;
    }

    const addResult = addSetAuthToConvexClients(fileContent, type);
    logVerbose("updateConvexClients processed file", { filePath, addResult });
    if (!addResult.changed) {
      if (addResult.instantiationCount > 0 && addResult.skippedHttpCount > 0) {
        skippedFiles.push(filePath);
      }
      continue;
    }

    let finalContent = addResult.updatedContent;
    if (addResult.usedClientApp) {
      logVerbose("updateConvexClients ensuring client import", { filePath });
      finalContent = await ensureStackAppImport(finalContent, filePath, "client");
    }
    if (addResult.usedServerApp) {
      logVerbose("updateConvexClients ensuring server import", { filePath });
      finalContent = await ensureStackAppImport(finalContent, filePath, "server");
    }

    if (finalContent !== fileContent) {
      laterWriteFile(filePath, finalContent);
      updatedFiles.push(filePath);
      logVerbose("updateConvexClients scheduled update", { filePath });
    }
  }

  logVerbose("updateConvexClients finished", { updatedFiles, skippedFiles });
  return {
    updatedFiles,
    skippedFiles,
  };
}

type StackAppKind = "client" | "server";

async function ensureStackAppImport(content: string, filePath: string, kind: StackAppKind): Promise<string> {
  logVerbose("ensureStackAppImport invoked", { filePath, kind });
  const identifier = kind === "client" ? "stackClientApp" : "stackServerApp";
  if (new RegExp(`import\\s+[^;]*\\b${identifier}\\b`).test(content)) {
    logVerbose("ensureStackAppImport found existing import", { filePath, identifier });
    return content;
  }

  const stackBasePath = await getStackAppBasePath(kind);
  const relativeImportPath = convertToModuleSpecifier(path.relative(path.dirname(filePath), stackBasePath));
  const newline = content.includes("\r\n") ? "\r\n" : "\n";

  const lines = content.split(/\r?\n/);
  const importLine = `import { ${identifier} } from "${relativeImportPath}";`;

  let insertIndex = 0;
  while (insertIndex < lines.length) {
    const line = lines[insertIndex];
    if (/^\s*['"]use (client|server)['"];?\s*$/.test(line)) {
      insertIndex += 1;
      continue;
    }
    if (/^\s*import\b/.test(line)) {
      insertIndex += 1;
      continue;
    }
    if (line.trim() === "") {
      insertIndex += 1;
      continue;
    }
    break;
  }

  lines.splice(insertIndex, 0, importLine);
  const nextLine = lines[insertIndex + 1];
  if (nextLine && nextLine.trim() !== "" && !/^\s*import\b/.test(nextLine)) {
    lines.splice(insertIndex + 1, 0, "");
  }

  logVerbose("ensureStackAppImport added import", { filePath, importLine });
  return lines.join(newline);
}

function convertToModuleSpecifier(relativePath: string): string {
  let specifier = relativePath.replace(/\\/g, "/");
  if (!specifier.startsWith(".")) {
    specifier = "./" + specifier;
  }
  return specifier;
}

async function getStackAppBasePath(kind: StackAppKind): Promise<string> {
  const srcPath = await Steps.guessSrcPath();
  const basePath = path.join(srcPath, "stack", kind);
  logVerbose("getStackAppBasePath resolved", { kind, basePath });
  return basePath;
}

function addSetAuthToConvexClients(content: string, type: "js" | "next" | "react"): AddSetAuthResult {
  logVerbose("addSetAuthToConvexClients invoked", { type, length: content.length });
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const instantiationRegex = /^[ \t]*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+(Convex(?:React|Http)?Client)\b([\s\S]*?);/gm;
  const replacements: Array<{ start: number, end: number, text: string }> = [];
  let instantiationCount = 0;
  let skippedHttpCount = 0;
  let usedClientApp = false;
  let usedServerApp = false;

  let match: RegExpExecArray | null;
  while ((match = instantiationRegex.exec(content)) !== null) {
    instantiationCount += 1;
    const fullMatch = match[0];
    const variableName = match[1];
    const className = match[2];

    if (className === "ConvexHttpClient") {
      skippedHttpCount += 1;
      logVerbose("addSetAuthToConvexClients skipping ConvexHttpClient", { variableName, fileLength: content.length });
      continue;
    }

    const remainder = content.slice(match.index + fullMatch.length);
    const setAuthRegex = new RegExp(`\\b${escapeRegExp(variableName)}\\s*\\.setAuth\\s*\\(`);
    if (setAuthRegex.test(remainder)) {
      logVerbose("addSetAuthToConvexClients found existing setAuth", { variableName });
      continue;
    }

    const indentation = fullMatch.match(/^[\t ]*/)?.[0] ?? "";
    const authCall = determineAuthCallExpression({ type, className, content });

    if (authCall.identifier === "stackClientApp") {
      usedClientApp = true;
    } else {
      usedServerApp = true;
    }

    const replacementText = `${fullMatch}${newline}${indentation}${variableName}.setAuth(${authCall.expression});`;
    replacements.push({
      start: match.index,
      end: match.index + fullMatch.length,
      text: replacementText,
    });
    logVerbose("addSetAuthToConvexClients queued replacement", { variableName, authCall });
  }

  if (replacements.length === 0) {
    logVerbose("addSetAuthToConvexClients no replacements", { instantiationCount, skippedHttpCount });
    return {
      updatedContent: content,
      changed: false,
      usedClientApp,
      usedServerApp,
      instantiationCount,
      skippedHttpCount,
    };
  }

  let updatedContent = content;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const replacement = replacements[i];
    updatedContent = `${updatedContent.slice(0, replacement.start)}${replacement.text}${updatedContent.slice(replacement.end)}`;
  }

  logVerbose("addSetAuthToConvexClients completed replacements", { replacements: replacements.length });
  logVerbose("addSetAuthToConvexClients result", { changed: true, instantiationCount, skippedHttpCount, usedClientApp, usedServerApp });
  return {
    updatedContent,
    changed: true,
    usedClientApp,
    usedServerApp,
    instantiationCount,
    skippedHttpCount,
  };
}

function determineAuthCallExpression({ type, className, content }: { type: "js" | "next" | "react", className: string, content: string }): { expression: string, identifier: "stackClientApp" | "stackServerApp" } {
  const hasClientAppReference = /\bstackClientApp\b/.test(content);
  const hasServerAppReference = /\bstackServerApp\b/.test(content);
  logVerbose("determineAuthCallExpression context", { type, className, hasClientAppReference, hasServerAppReference });

  if (type === "js") {
    const result = { expression: "stackServerApp.getConvexClientAuth({})", identifier: "stackServerApp" as const };
    logVerbose("determineAuthCallExpression returning for JS", result);
    return result;
  }

  if (hasClientAppReference) {
    const result = { expression: getClientAuthCall(type), identifier: "stackClientApp" as const };
    logVerbose("determineAuthCallExpression using client reference", result);
    return result;
  }
  if (hasServerAppReference && className !== "ConvexReactClient") {
    const result = { expression: "stackServerApp.getConvexClientAuth({})", identifier: "stackServerApp" as const };
    logVerbose("determineAuthCallExpression using server reference", result);
    return result;
  }

  const fallback = { expression: getClientAuthCall(type), identifier: "stackClientApp" as const };
  logVerbose("determineAuthCallExpression fallback", fallback);
  return fallback;
}

function getClientAuthCall(type: "js" | "next" | "react"): string {
  logVerbose("getClientAuthCall invoked", { type });
  return "stackClientApp.getConvexClientAuth({})";
}

function collectConvexClientCandidateFiles(projectPath: string): string[] {
  logVerbose("collectConvexClientCandidateFiles invoked", { projectPath });
  const roots = getConvexSearchRoots(projectPath);
  logVerbose("collectConvexClientCandidateFiles roots", { roots });
  const files = new Set<string>();
  const visited = new Set<string>();

  for (const root of roots) {
    walkDirectory(root, files, visited);
  }

  const result = Array.from(files);
  logVerbose("collectConvexClientCandidateFiles result", { count: result.length });
  return result;
}

function getConvexSearchRoots(projectPath: string): string[] {
  const candidateDirs = ["convex", "src", "app", "components"];
  const existing = candidateDirs
    .map((dir) => path.join(projectPath, dir))
    .filter((dirPath) => {
      try {
        return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
      } catch {
        return false;
      }
    });
  if (existing.length > 0) {
    logVerbose("getConvexSearchRoots using existing directories", { existing });
    return existing;
  }
  logVerbose("getConvexSearchRoots defaulting to project root", { projectPath });
  return [projectPath];
}

const directorySkipList = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".output",
  ".vercel",
  "dist",
  "build",
  "coverage",
  ".cache",
  ".storybook",
  "storybook-static",
]);

function walkDirectory(currentDir: string, files: Set<string>, visited: Set<string>): void {
  const realPath = (() => {
    try {
      return fs.realpathSync(currentDir);
    } catch {
      return currentDir;
    }
  })();

  if (visited.has(realPath)) return;
  visited.add(realPath);
  logVerbose("walkDirectory scanning", { currentDir: realPath });

  let dirEntries: fs.Dirent[];
  try {
    dirEntries = fs.readdirSync(realPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of dirEntries) {
    const entryName = entry.name;
    if (entry.isDirectory()) {
      if (directorySkipList.has(entryName)) {
        logVerbose("walkDirectory skipping directory in skip list", { directory: entryName, parent: realPath });
        continue;
      }
      if (entryName.startsWith(".") || entryName.startsWith("_")) {
        logVerbose("walkDirectory skipping hidden directory", { directory: entryName, parent: realPath });
        continue;
      }
      walkDirectory(path.join(realPath, entryName), files, visited);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entryName.endsWith(".d.ts")) continue;
    if (!hasJsLikeExtension(entryName)) continue;
    const filePath = path.join(realPath, entryName);
    files.add(filePath);
    logVerbose("walkDirectory added file", { filePath });
  }
}

function hasJsLikeExtension(fileName: string): boolean {
  return jsLikeFileExtensions.some((ext) => fileName.endsWith(`.${ext}`));
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function throwErr(message: string): never {
  throw new Error(message);
}

async function clearStdin(): Promise<void> {
  logVerbose("clearStdin invoked");
  await new Promise<void>((resolve) => {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.removeAllListeners('data');

    const flush = () => {
      while (process.stdin.read() !== null) { }
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      logVerbose("clearStdin flushed");
      resolve();
    };

    // Add a small delay to allow any buffered input to clear
    setTimeout(flush, 10);
  });
  logVerbose("clearStdin completed");
}
