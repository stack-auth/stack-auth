import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CONFIG_PATH = process.env.STACK_CLI_CONFIG_PATH ?? path.join(os.homedir(), ".stackrc");

type ConfigKey = "STACK_CLI_REFRESH_TOKEN" | "STACK_API_URL" | "STACK_DASHBOARD_URL";

function readConfigFileRaw(): string[] {
  try {
    return fs.readFileSync(CONFIG_PATH, "utf-8").split("\n");
  } catch {
    return [];
  }
}

export function readConfigValue(key: ConfigKey): string | undefined {
  const lines = readConfigFileRaw();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }
    if (trimmed.slice(0, eqIndex).trim() === key) {
      return trimmed.slice(eqIndex + 1).trim();
    }
  }
  return undefined;
}

export function writeConfigValue(key: ConfigKey, value: string): void {
  const lines = readConfigFileRaw();
  const newLine = `${key}=${value}`;
  let found = false;
  const result = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return line;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex !== -1 && trimmed.slice(0, eqIndex).trim() === key) {
      found = true;
      return newLine;
    }
    return line;
  });
  if (!found) {
    result.push(newLine);
  }
  fs.writeFileSync(CONFIG_PATH, result.join("\n"), { mode: 0o600 });
}

export function removeConfigValue(key: ConfigKey): void {
  const lines = readConfigFileRaw();
  const result = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return true;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex !== -1 && trimmed.slice(0, eqIndex).trim() === key) {
      return false;
    }
    return true;
  });
  fs.writeFileSync(CONFIG_PATH, result.join("\n"), { mode: 0o600 });
}
