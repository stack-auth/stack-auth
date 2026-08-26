import { createIntegrationIdpHandler } from "../../../../oauth-idp-route";

export const dynamic = "force-dynamic";

const handler = createIntegrationIdpHandler("neon");

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;
