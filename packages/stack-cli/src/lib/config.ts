import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CONFIG_PATH = process.env.STACK_CLI_CONFIG_PATH ?? path.join(os.homedir(), ".config", "stack-auth", "credentials.json");

type ConfigKey = "STACK_CLI_REFRESH_TOKEN" | "STACK_CLI_ANON_REFRESH_TOKEN" | "STACK_API_URL" | "STACK_DASHBOARD_URL";

function readConfigJson(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function writeConfigJson(data: Record<string, string>): void {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
}

export function readConfigValue(key: ConfigKey): string | undefined {
  const config = readConfigJson();
  return config[key];
}

export function writeConfigValue(key: ConfigKey, value: string): void {
  const config = readConfigJson();
  config[key] = value;
  writeConfigJson(config);
}

export function removeConfigValue(key: ConfigKey): void {
  const config = readConfigJson();
  delete config[key];
  writeConfigJson(config);
}
