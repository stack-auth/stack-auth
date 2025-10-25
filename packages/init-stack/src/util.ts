import * as child_process from "child_process";
import * as fs from "fs";
import * as path from "path";

export type TemplateFunction = (strings: TemplateStringsArray, ...values: any[]) => string;

export type Colorize = {
  red: TemplateFunction,
  blue: TemplateFunction,
  green: TemplateFunction,
  yellow: TemplateFunction,
  bold: TemplateFunction,
};

export type JsonRecord = Record<string, any>;

type VerboseFormatter = (message: string) => string;

let verboseLevelState = 0;
let verboseFormatterState: VerboseFormatter | null = null;

export function configureVerboseLogging(options: { level?: number, formatter?: VerboseFormatter }): void {
  verboseLevelState = Math.max(0, options.level ?? 0);
  verboseFormatterState = options.formatter ?? null;
}

export function getVerboseLevel(): number {
  return verboseLevelState;
}

export function logVerbose(message: string, details?: unknown): void {
  if (verboseLevelState <= 0) return;
  const formattedMessage = verboseFormatterState ? verboseFormatterState(message) : `[verbose] ${message}`;
  console.log(formattedMessage);
  if (typeof details !== "undefined" && verboseLevelState >= 2) {
    console.dir(details, { depth: null });
  }
}

export function templateIdentity(strings: TemplateStringsArray, ...values: any[]): string {
  if (strings.length === 0) return "";
  if (values.length !== strings.length - 1) {
    throw new Error("Invalid number of values; must be one less than strings");
  }

  return strings.slice(1).reduce(
    (result, string, i) => `${result}${String(values[i])}${string}`,
    strings[0]
  );
}

export function omit(object: Record<string, any>, keys: string[]): Record<string, any> {
  return Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)));
}

export function getCommandPath(command: string): string | null {
  if (!command) return null;

  const checker = process.platform === "win32" ? "where" : "which";
  const commands = [
    [process.env.SHELL ?? "bash", ["-ic", `${checker} ${command}`]],
    [checker, [command]],
  ] as const;
  for (const spawnArgs of commands) {
    const result = child_process.spawnSync(spawnArgs[0], spawnArgs[1], { stdio: "pipe" });
    if (result.status === 0) {
      return result.stdout.toString().trim().split('\n')[0];
    }
  }
  return null;
}

export function shouldWriteConfigFile(
  fullPath: string | null | undefined,
  options: { allowCreate?: boolean } = {}
): boolean {
  if (!fullPath) return false;
  if (fs.existsSync(fullPath)) return true;

  const dir = path.dirname(fullPath);
  if (!options.allowCreate) {
    return fs.existsSync(dir);
  }

  return true;
}
