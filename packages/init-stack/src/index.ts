import * as child_process from "child_process";
import { Command } from "commander";
import * as fs from "fs";
import inquirer from "inquirer";
import open from "open";
import * as path from "path";
import packageJson from '../package.json';

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
  .option("--npm", "Use npm as package manager")
  .option("--yarn", "Use yarn as package manager")
  .option("--pnpm", "Use pnpm as package manager")
  .option("--bun", "Use bun as package manager")
  .option("--client", "Initialize client-side only")
  .option("--server", "Initialize server-side only")
  .option("--no-browser", "Don't open browser for environment variable setup")
  .addHelpText('after', `
For more information, please visit https://docs.stack-auth.com/getting-started/setup`);

program.parse();

const options = program.opts();

// Keep existing variables but assign from Commander
let savedProjectPath: string | undefined = program.args[0] || undefined;
const isDryRun: boolean = options.dryRun || false;
const isNeon: boolean = options.neon || false;
const typeFromArgs: string | undefined = options.js ? "js" : options.next ? "next" : undefined;
const packageManagerFromArgs: string | undefined = options.npm ? "npm" : options.yarn ? "yarn" : options.pnpm ? "pnpm" : options.bun ? "bun" : undefined;
const isClient: boolean = options.client || false;
const isServer: boolean = options.server || false;
// Commander negates the boolean options with prefix `--no-`
// so `--no-browser` becomes `browser: false`
const noBrowser: boolean = !options.browser;

class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

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

type TemplateFunction = (strings: TemplateStringsArray, ...values: any[]) => string;

type Colorize = {
  red: TemplateFunction,
  blue: TemplateFunction,
  green: TemplateFunction,
  yellow: TemplateFunction,
  bold: TemplateFunction,
};

const colorize: Colorize = {
  red: (strings, ...values) => ansis.red + templateIdentity(strings, ...values) + ansis.clear,
  blue: (strings, ...values) => ansis.blue + templateIdentity(strings, ...values) + ansis.clear,
  green: (strings, ...values) => ansis.green + templateIdentity(strings, ...values) + ansis.clear,
  yellow: (strings, ...values) => ansis.yellow + templateIdentity(strings, ...values) + ansis.clear,
  bold: (strings, ...values) => ansis.bold + templateIdentity(strings, ...values) + ansis.clear,
};

const filesCreated: string[] = [];
const filesModified: string[] = [];
const commandsExecuted: string[] = [];

const packagesToInstall: string[] = [];
const writeFileHandlers: Array<() => Promise<void>> = [];
const nextSteps: string[] = [
  `Create an account and Stack Auth API key for your project on https://app.stack-auth.com`,
];

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


  // Wait just briefly so we can use `Steps` in here (it's defined only after the call to `main()`)
  await new Promise<void>((resolve) => resolve());


  // Prepare some stuff
  await clearStdin();
  const projectPath = await getProjectPath();


  // Steps
  const { packageJson } = await Steps.getProject();
  const type = await Steps.getProjectType({ packageJson });

  await Steps.addStackPackage(type);
  if (isNeon) packagesToInstall.push('@neondatabase/serverless');

  await Steps.writeEnvVars(type);

  if (type === "next") {
    const projectInfo = await Steps.getNextProjectInfo({ packageJson });
    await Steps.updateNextLayoutFile(projectInfo);
    await Steps.writeStackAppFile(projectInfo, "server");
    await Steps.writeNextHandlerFile(projectInfo);
    await Steps.writeNextLoadingFile(projectInfo);
    nextSteps.push(`Copy the environment variables from the new API key into your .env.local file`);
  } else if (type === "js") {
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
      }, w);
      appFiles.push(fileName);
    }
    nextSteps.push(
      `Copy the environment variables from the new API key into your own environment and reference them in ${appFiles.join(" and ")}`,
      `Follow the instructions on how to use Stack Auth's vanilla SDK at http://docs.stack-auth.com/others/js-client`,
    );
  } else {
    throw new Error("Unknown type: " + type);
  }

  const { packageManager } = await Steps.getPackageManager();
  await Steps.ensureReady(type);


  // Install dependencies
  console.log();
  console.log(colorize.bold`Installing dependencies...`);
  const installCommand = packageManager === "yarn" ? "yarn add" : `${packageManager} install`;
  await shellNicelyFormatted(`${installCommand} ${packagesToInstall.join(' ')}`, {
    shell: true,
    cwd: projectPath,
  });


  // Write files
  console.log();
  console.log(colorize.bold`Writing files...`);
  console.log();
  for (const writeFileHandler of writeFileHandlers) {
    await writeFileHandler();
  }
  console.log(`${colorize.green`√`} Done writing files`);

  console.log('\n\n\n');
  console.log(colorize.bold`${colorize.green`Installation succeeded!`}`);
  console.log();
  console.log("Commands executed:");
  for (const command of commandsExecuted) {
    console.log(`  ${colorize.blue`${command}`}`);
  }
  console.log();
  console.log("Files written:");
  for (const file of filesModified) {
    console.log(`  ${colorize.yellow`${file}`}`);
  }
  for (const file of filesCreated) {
    console.log(`  ${colorize.green`${file}`}`);
  }
  console.log();


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
  if (!process.env.STACK_DISABLE_INTERACTIVE && !noBrowser) {
    await open("https://app.stack-auth.com/wizard-congrats");
  }
}

main()
  .catch((err) => {
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
    process.exit(1);
  });


type PackageJson = {
  dependencies?: Record<string, string>,
  devDependencies?: Record<string, string>,
  [key: string]: any,
}

type ProjectInfo = {
  type: string,
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
  type: string,
  srcPath: string,
  defaultExtension: string,
  indentation: string,
}

type StackAppFileResult = {
  fileName: string,
}

const Steps = {
  async getProject(): Promise<{ packageJson: PackageJson }> {
    let projectPath = await getProjectPath();
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

    return { packageJson };
  },

  async getProjectType({ packageJson }: { packageJson: PackageJson }): Promise<string> {
    if (typeFromArgs) return typeFromArgs;

    const maybeNextProject = await Steps.maybeGetNextProjectInfo({ packageJson });
    if (!("error" in maybeNextProject)) return "next";

    const { type } = await inquirer.prompt([
      {
        type: "list",
        name: "type",
        message: "Which integration would you like to install?",
        choices: [
          { name: "None (vanilla JS, Node.js, etc)", value: "js" },
          { name: "Next.js", value: "next" },
        ]
      }
    ]);

    return type;
  },

  async getStackPackageName(type: string, install = false): Promise<string> {
    return {
      "js": (install && process.env.STACK_JS_INSTALL_PACKAGE_NAME_OVERRIDE) || "@stackframe/js",
      "next": (install && process.env.STACK_NEXT_INSTALL_PACKAGE_NAME_OVERRIDE) || "@stackframe/stack",
    }[type] ?? throwErr("Unknown type in addStackPackage: " + type);
  },

  async addStackPackage(type: string): Promise<void> {
    packagesToInstall.push(await Steps.getStackPackageName(type, true));
  },

  async getNextProjectInfo({ packageJson }: { packageJson: PackageJson }): Promise<ProjectInfo> {
    const maybe = await Steps.maybeGetNextProjectInfo({ packageJson });
    if ("error" in maybe) throw new UserError(maybe.error);
    return maybe;
  },

  async maybeGetNextProjectInfo({ packageJson }: { packageJson: PackageJson }): Promise<NextProjectInfoResult> {
    const projectPath = await getProjectPath();

    const nextVersionInPackageJson = packageJson.dependencies?.["next"] ?? packageJson.devDependencies?.["next"];
    if (!nextVersionInPackageJson) {
      return { error: `The project at ${projectPath} does not appear to be a Next.js project, or does not have 'next' installed as a dependency.` };
    }
    if (
      !nextVersionInPackageJson.includes("14") &&
      !nextVersionInPackageJson.includes("15") &&
      nextVersionInPackageJson !== "latest"
    ) {
      return { error: `The project at ${projectPath} is using an unsupported version of Next.js (found ${nextVersionInPackageJson}).\n\nOnly Next.js 14 & 15 projects are currently supported. See Next's upgrade guide: https://nextjs.org/docs/app/building-your-application/upgrading/version-14` };
    }

    const nextConfigPathWithoutExtension = path.join(projectPath, "next.config");
    const nextConfigFileExtension = await findJsExtension(
      nextConfigPathWithoutExtension
    );
    const nextConfigPath =
      nextConfigPathWithoutExtension + "." + (nextConfigFileExtension ?? "js");
    if (!fs.existsSync(nextConfigPath)) {
      return { error: `Expected file at ${nextConfigPath}. Only Next.js projects are currently supported.` };
    }

    const hasSrcAppFolder = fs.existsSync(path.join(projectPath, "src/app"));
    const srcPath = path.join(projectPath, hasSrcAppFolder ? "src" : "");
    const appPath = path.join(srcPath, "app");
    if (!fs.existsSync(appPath)) {
      return { error: `The app path ${appPath} does not exist. Only the Next.js app router is supported.` };
    }

    const dryUpdateNextLayoutFileResult = await Steps.dryUpdateNextLayoutFile({ appPath, defaultExtension: "jsx" });

    return {
      type: "next",
      srcPath,
      appPath,
      defaultExtension: dryUpdateNextLayoutFileResult.fileExtension,
      indentation: dryUpdateNextLayoutFileResult.indentation,
    };
  },

  async writeEnvVars(type: string): Promise<boolean> {
    const projectPath = await getProjectPath();

    // TODO: in non-Next environments, ask the user what method they prefer for envvars
    if (type !== "next") return false;

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
          "NEXT_PUBLIC_STACK_PROJECT_ID=\n" +
          "NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=\n" +
          "STACK_SECRET_SERVER_KEY=\n"
        : "# Stack Auth keys\n" +
          "# Get these variables by creating a project on https://app.stack-auth.com.\n" +
          "NEXT_PUBLIC_STACK_PROJECT_ID=\n" +
          "NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=\n" +
          "STACK_SECRET_SERVER_KEY=\n";

      laterWriteFile(envLocalPath, envContent);
      return true;
    }

    return false;
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
    const res = await Steps.dryUpdateNextLayoutFile(projectInfo);
    laterWriteFile(res.path, res.updatedContent);
    return res;
  },

  async writeStackAppFile({ type, srcPath, defaultExtension, indentation }: StackAppFileOptions, clientOrServer: string): Promise<StackAppFileResult> {
    const packageName = await Steps.getStackPackageName(type);

    const clientOrServerCap = {
      client: "Client",
      server: "Server",
    }[clientOrServer] ?? throwErr("unknown clientOrServer " + clientOrServer);

    const relativeStackAppPath = {
      js: `stack/${clientOrServer}`,
      next: "stack",
    }[type] ?? throwErr("unknown type");

    const stackAppPathWithoutExtension = path.join(srcPath, relativeStackAppPath);
    const stackAppFileExtension =
      (await findJsExtension(stackAppPathWithoutExtension)) ?? defaultExtension;
    const stackAppPath =
      stackAppPathWithoutExtension + "." + stackAppFileExtension;
    const stackAppContent = await readFile(stackAppPath);
    if (stackAppContent) {
      if (!stackAppContent.includes("@stackframe/")) {
        throw new UserError(
          `A file at the path ${stackAppPath} already exists. Stack uses the stack.ts file to initialize the Stack SDK. Please remove the existing file and try again.`
        );
      }
      throw new UserError(
        `It seems that you already installed Stack in this project.`
      );
    }
    laterWriteFileIfNotExists(
      stackAppPath,
      `
${type === "next" ? `import "server-only";` : ""}

import { Stack${clientOrServerCap}App } from ${JSON.stringify(packageName)};

export const stack${clientOrServerCap}App = new Stack${clientOrServerCap}App({
${indentation}tokenStore: ${type === "next" ? '"nextjs-cookie"' : (clientOrServer === "client" ? '"cookie"' : '"memory"')},${
type === "js" ? `\n\n${indentation}// get your Stack Auth API keys from https://app.stack-auth.com${clientOrServer === "client" ? ` and store them in a safe place (eg. environment variables)` : ""}` : ""}${
type === "js" ? `\n${indentation}publishableClientKey: ${clientOrServer === "server" ? 'process.env.STACK_PUBLISHABLE_CLIENT_KEY' : 'INSERT_YOUR_PUBLISHABLE_CLIENT_KEY_HERE'},` : ""}${
type === "js" && clientOrServer === "server" ? `\n${indentation}secretServerKey: process.env.STACK_SECRET_SERVER_KEY,` : ""}
});
      `.trim() + "\n"
    );
    return { fileName: stackAppPath };
  },

  async writeNextHandlerFile(projectInfo: ProjectInfo): Promise<void> {
    const handlerPathWithoutExtension = path.join(
      projectInfo.appPath,
      "handler/[...stack]/page"
    );
    const handlerFileExtension =
      (await findJsExtension(handlerPathWithoutExtension)) ?? projectInfo.defaultExtension;
    const handlerPath = handlerPathWithoutExtension + "." + handlerFileExtension;
    const handlerContent = await readFile(handlerPath);
    if (handlerContent && !handlerContent.includes("@stackframe/")) {
      throw new UserError(
        `A file at the path ${handlerPath} already exists. Stack uses the /handler path to handle incoming requests. Please remove the existing file and try again.`
      );
    }
    laterWriteFileIfNotExists(
      handlerPath,
      `import { StackHandler } from "@stackframe/stack";\nimport { stackServerApp } from "../../../stack";\n\nexport default function Handler(props${
        handlerFileExtension.includes("ts") ? ": unknown" : ""
      }) {\n${projectInfo.indentation}return <StackHandler fullPage app={stackServerApp} routeProps={props} />;\n}\n`
    );
  },

  async writeNextLoadingFile(projectInfo: ProjectInfo): Promise<void> {
    let loadingPathWithoutExtension = path.join(projectInfo.appPath, "loading");
    const loadingFileExtension =
      (await findJsExtension(loadingPathWithoutExtension)) ?? projectInfo.defaultExtension;
    const loadingPath = loadingPathWithoutExtension + "." + loadingFileExtension;
    laterWriteFileIfNotExists(
      loadingPath,
      `export default function Loading() {\n${projectInfo.indentation}// Stack uses React Suspense, which will render this page while user data is being fetched.\n${projectInfo.indentation}// See: https://nextjs.org/docs/app/api-reference/file-conventions/loading\n${projectInfo.indentation}return <></>;\n}\n`
    );
  },

  async getPackageManager(): Promise<{ packageManager: string }> {
    if (packageManagerFromArgs) return { packageManager: packageManagerFromArgs };
    const packageManager = await promptPackageManager();
    const versionCommand = `${packageManager} --version`;

    try {
      await shellNicelyFormatted(versionCommand, { shell: true, quiet: true });
    } catch (err) {
      console.error(err);
      throw new UserError(
        `Could not run the package manager command '${versionCommand}'. Please make sure ${packageManager} is installed on your system.`
      );
    }

    return { packageManager };
  },

  async ensureReady(type: string): Promise<void> {
    const projectPath = await getProjectPath();

    const typeString = {
      js: "JavaScript",
      next: "Next.js"
    }[type] ?? throwErr("unknown type");
    const isReady = !!process.env.STACK_DISABLE_INTERACTIVE || (await inquirer.prompt([
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
  },

  async getServerOrClientOrBoth(): Promise<string[]> {
    if (isClient && isServer) return ["server", "client"];
    if (isServer) return ["server"];
    if (isClient) return ["client"];

    return (await inquirer.prompt([{
      type: "list",
      name: "type",
      message: "Do you want to use Stack Auth on the server, or on the client?",
      choices: [
        { name: "Client (eg. Vite, HTML)", value: ["client"] },
        { name: "Server (eg. Node.js)", value: ["server"] },
        { name: "Both", value: ["server", "client"] }
      ]
    }])).type;
  },

  /**
   * note: this is a heuristic, specific frameworks may have better heuristics (eg. the Next.js code uses the extension of the global layout file)
   */
  async guessDefaultFileExtension(): Promise<string> {
    const projectPath = await getProjectPath();
    const hasTsConfig = fs.existsSync(
      path.join(projectPath, "tsconfig.json")
    );
    return hasTsConfig ? "ts" : "js";
  },

  /**
   * note: this is a heuristic, specific frameworks may have better heuristics (eg. the Next.js code uses the location of the app folder)
   */
  async guessSrcPath(): Promise<string> {
    const projectPath = await getProjectPath();
    const potentialSrcPath = path.join(projectPath, "src");
    const hasSrcFolder = fs.existsSync(
      path.join(projectPath, "src")
    );
    return hasSrcFolder ? potentialSrcPath : projectPath;
  },


};


type LayoutResult = {
  content: string,
  indentation: string,
}

async function getUpdatedLayout(originalLayout: string): Promise<LayoutResult | undefined> {
  let layout = originalLayout;
  const indentation = guessIndentation(originalLayout);

  const firstImportLocationM1 = /\simport\s/.exec(layout)?.index;
  const hasStringAsFirstLine = layout.startsWith('"') || layout.startsWith("'");
  const importInsertLocationM1 =
    firstImportLocationM1 ?? (hasStringAsFirstLine ? layout.indexOf("\n") : -1);
  const importInsertLocation = importInsertLocationM1 + 1;
  const importStatement = `import { StackProvider, StackTheme } from "@stackframe/stack";\nimport { stackServerApp } from "../stack";\n`;
  layout =
    layout.slice(0, importInsertLocation) +
    importStatement +
    layout.slice(importInsertLocation);

  const bodyOpenTag = /<\s*body[^>]*>/.exec(layout);
  const bodyCloseTag = /<\s*\/\s*body[^>]*>/.exec(layout);
  if (!bodyOpenTag || !bodyCloseTag) {
    return undefined;
  }
  const bodyOpenEndIndex = bodyOpenTag.index + bodyOpenTag[0].length;
  const bodyCloseStartIndex = bodyCloseTag.index;
  if (bodyCloseStartIndex <= bodyOpenEndIndex) {
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

  const insertOpen = "<StackProvider app={stackServerApp}><StackTheme>";
  const insertClose = "</StackTheme></StackProvider>";

  layout =
    layout.slice(0, bodyCloseStartIndex) +
    insertClose +
    layout.slice(bodyCloseStartIndex);
  layout =
    layout.slice(0, bodyOpenEndIndex) +
    insertOpen +
    layout.slice(bodyOpenEndIndex);

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
  if (savedProjectPath === undefined) {
    savedProjectPath = process.cwd();

    const askForPathModification = !fs.existsSync(
      path.join(savedProjectPath, "package.json")
    );
    if (askForPathModification) {
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
    }
  }
  return savedProjectPath as string;
}

async function findJsExtension(fullPathWithoutExtension: string): Promise<string | null> {
  for (const ext of jsLikeFileExtensions) {
    const fullPath = fullPathWithoutExtension + "." + ext;
    if (fs.existsSync(fullPath)) {
      return ext;
    }
  }
  return null;
}

async function promptPackageManager(): Promise<string> {
  const projectPath = await getProjectPath();
  const yarnLock = fs.existsSync(path.join(projectPath, "yarn.lock"));
  const pnpmLock = fs.existsSync(path.join(projectPath, "pnpm-lock.yaml"));
  const npmLock = fs.existsSync(path.join(projectPath, "package-lock.json"));
  const bunLock = fs.existsSync(path.join(projectPath, "bun.lockb"));

  if (yarnLock && !pnpmLock && !npmLock && !bunLock) {
    return "yarn";
  } else if (!yarnLock && pnpmLock && !npmLock && !bunLock) {
    return "pnpm";
  } else if (!yarnLock && !pnpmLock && npmLock && !bunLock) {
    return "npm";
  } else if (!yarnLock && !pnpmLock && !npmLock && bunLock) {
    return "bun";
  }

  const answers = await inquirer.prompt([
    {
      type: "list",
      name: "packageManager",
      message: "Which package manager are you using for this project?",
      choices: ["npm", "yarn", "pnpm", "bun"],
    },
  ]);
  return answers.packageManager;
}

type ShellOptions = {
  quiet?: boolean,
  shell?: boolean,
  cwd?: string,
  [key: string]: any,
}

async function shellNicelyFormatted(command: string, { quiet, ...options }: ShellOptions): Promise<void> {
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
      if (!quiet) {
        child.stdout.pipe(ui.log);
        child.stderr.pipe(ui.log);
      }

      await new Promise<void>((resolve, reject) => {
        child.on("exit", (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Command ${command} failed with code ${code}`));
          }
        });
      });
    } else {
      console.log(`[DRY-RUN] Would have run: ${command}`);
    }

    if (!quiet) {
      commandsExecuted.push(command);
      ui.updateBottomBar(
        `${colorize.green`√`} Command ${command} succeeded\n`
      );
    }
  } catch (e) {
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
  try {
    if (!isDryRun) {
      return fs.readFileSync(fullPath, "utf-8");
    }
    return null;
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

async function writeFile(fullPath: string, content: string): Promise<void> {
  let create = !fs.existsSync(fullPath);
  if (!isDryRun) {
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  } else {
    console.log(`[DRY-RUN] Would have written to ${fullPath}`);
  }
  const relativeToProjectPath = path.relative(await getProjectPath(), fullPath);
  if (!create) {
    filesModified.push(relativeToProjectPath);
  } else {
    filesCreated.push(relativeToProjectPath);
  }
}

function laterWriteFile(fullPath: string, content: string): void {
  writeFileHandlers.push(async () => {
    await writeFile(fullPath, content);
  });
}

async function writeFileIfNotExists(fullPath: string, content: string): Promise<void> {
  if (!fs.existsSync(fullPath)) {
    await writeFile(fullPath, content);
  }
}

function laterWriteFileIfNotExists(fullPath: string, content: string): void {
  writeFileHandlers.push(async () => {
    await writeFileIfNotExists(fullPath, content);
  });
}

function assertInteractive(): true {
  if (process.env.STACK_DISABLE_INTERACTIVE) {
    throw new UserError("STACK_DISABLE_INTERACTIVE is set, but wizard requires interactivity to complete. Make sure you supplied all required command line arguments!");
  }
  return true;
}

function throwErr(message: string): never {
  throw new Error(message);
}

// TODO import this function from stack-shared instead (but that would require us to fix the build to let us import it)
export function templateIdentity(strings: TemplateStringsArray, ...values: any[]): string {
  if (strings.length === 0) return "";
  if (values.length !== strings.length - 1) throw new Error("Invalid number of values; must be one less than strings");

  return strings.slice(1).reduce((result, string, i) => `${result}${values[i] ?? "n/a"}${string}`, strings[0]);
}

async function clearStdin(): Promise<void> {
  await new Promise<void>((resolve) => {
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
    }
      process.stdin.resume();
      process.stdin.removeAllListeners('data');

      const flush = () => {
        while (process.stdin.read() !== null) {}
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
        }
          resolve();
      };

      // Add a small delay to allow any buffered input to clear
      setTimeout(flush, 10);
  });
}
