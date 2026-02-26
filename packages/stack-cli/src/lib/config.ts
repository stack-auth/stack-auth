import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CONFIG_PATH = path.join(os.homedir(), ".stackrc");

type ConfigKey = "STACK_CLI_REFRESH_TOKEN" | "STACK_API_URL" | "STACK_DASHBOARD_URL";

function parseConfig(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    result[key] = value;
  }
  return result;
}

function serializeConfig(config: Record<string, string>): string {
  return Object.entries(config)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n") + "\n";
}

function readConfigFile(): Record<string, string> {
  try {
    const content = fs.readFileSync(CONFIG_PATH, "utf-8");
    return parseConfig(content);
  } catch {
    return {};
  }
}

function writeConfigFile(config: Record<string, string>): void {
  fs.writeFileSync(CONFIG_PATH, serializeConfig(config), { mode: 0o600 });
}

export function readConfigValue(key: ConfigKey): string | undefined {
  const config = readConfigFile();
  return config[key];
}

export function writeConfigValue(key: ConfigKey, value: string): void {
  const config = readConfigFile();
  config[key] = value;
  writeConfigFile(config);
}

export function removeConfigValue(key: ConfigKey): void {
  const config = readConfigFile();
  delete config[key];
  writeConfigFile(config);
}
