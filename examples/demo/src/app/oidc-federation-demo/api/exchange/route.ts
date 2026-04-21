import { NextResponse } from "next/server";

const BACKEND_URL = process.env.NEXT_PUBLIC_STACK_API_URL
  ?? `http://localhost:${process.env.NEXT_PUBLIC_STACK_PORT_PREFIX ?? "81"}02`;

export async function POST(request: Request) {
  const body = await request.json() as { projectId?: string, subjectToken?: string };
  if (!body.projectId || !body.subjectToken) {
    return NextResponse.json({ ok: false, status: 400, error: "projectId and subjectToken are required" }, { status: 400 });
  }

  const res = await fetch(`${BACKEND_URL}/api/v1/auth/oidc-federation/exchange`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-stack-project-id": body.projectId,
    },
    body: JSON.stringify({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: body.subjectToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ ok: false, status: res.status, error: text }, { status: 200 });
  }
  const data = await res.json() as { access_token: string, expires_in: number, token_type: string };
  return NextResponse.json({
    ok: true,
    access_token: data.access_token,
    expires_in: data.expires_in,
    token_type: data.token_type,
  });
}
