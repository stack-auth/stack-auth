import { getPublicEnvVar } from "@/lib/env";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";

export function getInternalProjectHeaders(options: {
  accessToken: string | null,
  contentType?: "application/json",
}): Record<string, string> {
  const accessToken = options.accessToken ?? throwErr("accessToken is required for internal project headers");
  const publishableClientKey = getPublicEnvVar("NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY") ?? throwErr("NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY is required for internal project headers");

  return {
    ...(options.contentType ? { "Content-Type": options.contentType } : {}),
    "X-Hexclave-Project-Id": "internal",
    "X-Hexclave-Access-Type": "client",
    "X-Hexclave-Access-Token": accessToken,
    "X-Hexclave-Publishable-Client-Key": publishableClientKey,
  };
}
