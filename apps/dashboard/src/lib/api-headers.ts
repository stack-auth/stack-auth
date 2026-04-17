import { getPublicEnvVar } from "@/lib/env";

export type CurrentUser = { getAccessToken: () => Promise<string | null> };

/**
 * Builds Stack Auth API headers with authentication when available.
 * Automatically includes access token if user is provided.
 */
export async function buildStackAuthHeaders(
  currentUser?: CurrentUser | null,
): Promise<Record<string, string>> {
  const accessToken = currentUser ? await currentUser.getAccessToken() : null;

  return {
    "x-stack-access-type": "client",
    "x-stack-project-id": "internal",
    "x-stack-publishable-client-key": getPublicEnvVar("NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY") ?? "",
    ...(accessToken ? { "x-stack-access-token": accessToken } : {}),
  };
}
