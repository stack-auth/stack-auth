import { getAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  await getAuth().api.signOut({ headers: request.headers });
  return new NextResponse(null, { status: 204 });
}
