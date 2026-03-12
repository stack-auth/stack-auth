import { getPublicEnvVar } from "@/lib/env";

export function getInternalProjectHeaders(options: {
  accessToken: string | null,
  contentType?: "application/json",
}): Record<string, string> {
  return {
    ...(options.contentType ? { "Content-Type": options.contentType } : {}),
    "X-Stack-Project-Id": "internal",
    "X-Stack-Access-Type": "client",
    "X-Stack-Access-Token": options.accessToken || "",
    "X-Stack-Publishable-Client-Key": getPublicEnvVar("NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY") || "",
  };
}
