import { NextResponse } from "next/server";
import { stackServerApp } from "src/stack";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBody(value: unknown): { teamId: string, productId: "team" | "growth", returnUrl?: string } {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  const { teamId, productId, returnUrl } = value;
  if (typeof teamId !== "string" || teamId === "") {
    throw new Error("teamId is required.");
  }
  if (productId !== "team" && productId !== "growth") {
    throw new Error("productId must be team or growth.");
  }
  if (returnUrl !== undefined && typeof returnUrl !== "string") {
    throw new Error("returnUrl must be a string.");
  }

  return { teamId, productId, returnUrl };
}

export async function POST(request: Request) {
  const user = await stackServerApp.getUser();
  if (user == null) {
    return NextResponse.json({ error: "Sign in before creating a checkout URL." }, { status: 401 });
  }
  const body = readBody(await request.json());
  const teams = await user.listTeams();
  const team = teams.find((candidate) => candidate.id === body.teamId);
  if (team == null) {
    return NextResponse.json({ error: "Current user is not a member of that team." }, { status: 403 });
  }

  const url = await team.createCheckoutUrl({
    productId: body.productId,
    returnUrl: body.returnUrl,
  });

  return NextResponse.json({ url });
}
