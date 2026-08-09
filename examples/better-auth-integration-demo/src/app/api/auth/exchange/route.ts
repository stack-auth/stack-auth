import { getAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (session == null) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const token = await auth.api.getToken({ headers: request.headers });
  const apiUrl = process.env.NEXT_PUBLIC_HEXCLAVE_API_URL;
  const projectId = process.env.NEXT_PUBLIC_HEXCLAVE_PROJECT_ID;
  if (apiUrl == null || apiUrl.length === 0) throw new Error("Missing required environment variable: NEXT_PUBLIC_HEXCLAVE_API_URL");
  if (projectId == null || projectId.length === 0) throw new Error("Missing required environment variable: NEXT_PUBLIC_HEXCLAVE_PROJECT_ID");
  const response = await fetch(`${apiUrl}/api/latest/auth/external/token`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hexclave-access-type": "client",
      "x-hexclave-project-id": projectId,
    },
    body: JSON.stringify({ provider_id: "better-auth-integration", token: token.token }),
  });
  const result = await response.json() as { access_token?: string, session_id?: string, user_id?: string, is_new_user?: boolean, code?: string, error?: string };
  let profile: { primary_email?: string | null, display_name?: string | null } = {};
  if (result.access_token != null) {
    const profileResponse = await fetch(`${apiUrl}/api/v1/users/me`, {
      headers: {
        "x-hexclave-access-token": result.access_token,
        "x-hexclave-access-type": "client",
        "x-hexclave-project-id": projectId,
      },
    });
    if (profileResponse.ok) profile = await profileResponse.json() as typeof profile;
  }
  return NextResponse.json({
    sessionId: result.session_id,
    userId: result.user_id,
    isNewUser: result.is_new_user,
    primaryEmail: profile.primary_email ?? null,
    displayName: profile.display_name ?? null,
    error: result.error ?? result.code,
  }, { status: response.status });
}
