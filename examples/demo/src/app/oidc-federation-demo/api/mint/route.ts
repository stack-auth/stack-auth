import { NextResponse } from "next/server";

const MOCK_IDP_URL = process.env.STACK_MOCK_OIDC_ISSUER_URL
  ?? `http://localhost:${process.env.NEXT_PUBLIC_STACK_PORT_PREFIX ?? "81"}15`;

export async function POST(request: Request) {
  const body = await request.json() as { sub?: string, aud?: string };
  const res = await fetch(`${MOCK_IDP_URL}/mint`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sub: body.sub,
      aud: body.aud,
      extraClaims: { environment: "demo" },
      ttlSeconds: 300,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    let message = `mock IdP returned ${res.status}`;
    try {
      const maybeErr = JSON.parse(text) as { error?: unknown };
      if (typeof maybeErr.error === "string") message = maybeErr.error;
    } catch { /* non-JSON body — fall through to default message */ }
    return NextResponse.json({ error: message }, { status: 502 });
  }
  try {
    return NextResponse.json(JSON.parse(text));
  } catch {
    return NextResponse.json({ error: "mock IdP returned non-JSON response" }, { status: 502 });
  }
}
