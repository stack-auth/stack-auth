import { getAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (session == null) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const token = await auth.api.getToken({ headers: request.headers });
  return NextResponse.json({ token: token.token });
}
