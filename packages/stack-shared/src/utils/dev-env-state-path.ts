import { homedir } from "os";
import { join } from "path";

export function defaultStackDevEnvStatePath(): string {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return join(localAppData, "Stack Auth", "dev-envs.json");
  }
  return join(homedir(), ".stack", "dev-envs.json");
}

export function stackDevEnvStatePath(): string {
  return process.env.STACK_DEV_ENVS_PATH ?? defaultStackDevEnvStatePath();
}
