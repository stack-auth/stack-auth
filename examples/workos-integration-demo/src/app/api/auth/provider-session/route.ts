import { withAuth } from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";

export async function GET() {
  const { accessToken, sessionId, user } = await withAuth();
  if (accessToken == null || sessionId == null) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json({
    accessToken,
    sessionId,
    user: user == null ? null : {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    },
  });
}
