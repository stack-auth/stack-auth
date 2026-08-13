import { createServerError } from "../../server-error";

export const runtime = "nodejs";

export async function POST(): Promise<never> {
  // Keep this exception uncaught: Next's onRequestError instrumentation owns
  // server-side reporting, while the demo client only observes the 500 response.
  throw createServerError();
}
