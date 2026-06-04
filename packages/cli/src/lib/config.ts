import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Hexclave rebrand: credentials live under `~/.config/hexclave/`. The legacy
// `~/.config/stack-auth/` path is still read as a fallback so existing CLI
// installs keep working without a manual migration. The STACK_CLI_CONFIG_PATH
// env override keeps the highest priority and short-circuits both paths.
const ENV_CONFIG_PATH = process.env.STACK_CLI_CONFIG_PATH;
const HEXCLAVE_CONFIG_PATH = path.join(os.homedir(), ".config", "hexclave", "credentials.json");
const LEGACY_CONFIG_PATH = path.join(os.homedir(), ".config", "stack-auth", "credentials.json");

// Path that writes go to: the env override if set, otherwise the new path.
const WRITE_CONFIG_PATH = ENV_CONFIG_PATH ?? HEXCLAVE_CONFIG_PATH;

// Path that reads come from: the env override if set; otherwise prefer the new
// path, falling back to the legacy path when the new file doesn't exist yet.
function resolveReadConfigPath(): string {
  if (ENV_CONFIG_PATH != null) {
    return ENV_CONFIG_PATH;
  }
  if (fs.existsSync(HEXCLAVE_CONFIG_PATH)) {
    return HEXCLAVE_CONFIG_PATH;
  }
  if (fs.existsSync(LEGACY_CONFIG_PATH)) {
    return LEGACY_CONFIG_PATH;
  }
  return HEXCLAVE_CONFIG_PATH;
}

type ConfigKey = "STACK_CLI_REFRESH_TOKEN" | "STACK_CLI_ANON_REFRESH_TOKEN" | "STACK_API_URL" | "STACK_DASHBOARD_URL" | "STACK_EMULATOR_API_URL" | "STACK_EMULATOR_DASHBOARD_URL";

function readConfigJson(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(resolveReadConfigPath(), "utf-8"));
  } catch {
    return {};
  }
}

function writeConfigJson(data: Record<string, string>): void {
  fs.mkdirSync(path.dirname(WRITE_CONFIG_PATH), { recursive: true });
  fs.writeFileSync(WRITE_CONFIG_PATH, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
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
