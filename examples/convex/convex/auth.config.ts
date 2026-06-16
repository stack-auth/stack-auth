import { getConvexProvidersConfig } from "@hexclave/next/convex-auth.config";

function throwErr(message: string): never {
  throw new Error(message);
}

function resolveRenamedEnvVar(hexclaveName: string, stackName: string, hexclaveValue: string | undefined, stackValue: string | undefined): string | undefined {
  if (hexclaveValue && stackValue && hexclaveValue !== stackValue) {
    throw new Error(`Environment variables ${hexclaveName} and ${stackName} are both set to different values. Remove one of them or set them to the same value.`);
  }
  return hexclaveValue || stackValue || undefined;
}

export default {
  providers: getConvexProvidersConfig({
    projectId: resolveRenamedEnvVar("NEXT_PUBLIC_HEXCLAVE_PROJECT_ID", "NEXT_PUBLIC_STACK_PROJECT_ID", process.env.NEXT_PUBLIC_HEXCLAVE_PROJECT_ID, process.env.NEXT_PUBLIC_STACK_PROJECT_ID) ?? throwErr("NEXT_PUBLIC_HEXCLAVE_PROJECT_ID or NEXT_PUBLIC_STACK_PROJECT_ID must be set"),
    baseUrl: resolveRenamedEnvVar("NEXT_PUBLIC_HEXCLAVE_API_URL", "NEXT_PUBLIC_STACK_API_URL", process.env.NEXT_PUBLIC_HEXCLAVE_API_URL, process.env.NEXT_PUBLIC_STACK_API_URL),
  }),
}
