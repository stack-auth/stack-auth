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
  const data = await res.json();
  if (!res.ok) {
    return NextResponse.json({ error: data?.error ?? `mock IdP returned ${res.status}` }, { status: 502 });
  }
  return NextResponse.json(data);
}
