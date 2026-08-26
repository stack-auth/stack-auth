import { getEnvVariable } from "@hexclave/shared/dist/utils/env";

export function getBackendApiBaseUrl(): string {
  return (
    getEnvVariable("NEXT_PUBLIC_SERVER_HEXCLAVE_API_URL", "") ||
    getEnvVariable("NEXT_PUBLIC_SERVER_STACK_API_URL", "") ||
    getEnvVariable("NEXT_PUBLIC_HEXCLAVE_API_URL", "") ||
    getEnvVariable("NEXT_PUBLIC_STACK_API_URL")
  ).replace(/\/$/, "");
}
