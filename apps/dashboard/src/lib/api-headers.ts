import { getPublicEnvVar } from "@/lib/env";

export type CurrentUser = { getAccessToken: () => Promise<string | null> };

/**
 * Builds Hexclave API headers with authentication when available.
 * Automatically includes access token if user is provided.
 */
export async function buildStackAuthHeaders(
  currentUser?: CurrentUser | null,
): Promise<Record<string, string>> {
  const accessToken = currentUser ? await currentUser.getAccessToken() : null;

  // Hexclave rebrand: emit x-hexclave-* request headers; the backend proxy dual-accepts both names.
  return {
    "x-hexclave-access-type": "client",
    "x-hexclave-project-id": "internal",
    "x-hexclave-publishable-client-key": getPublicEnvVar("NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY") ?? "",
    ...(accessToken ? { "x-hexclave-access-token": accessToken } : {}),
  };
}
