import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  await auth.api.signOut({ headers: request.headers });
  return new NextResponse(null, { status: 204 });
}
