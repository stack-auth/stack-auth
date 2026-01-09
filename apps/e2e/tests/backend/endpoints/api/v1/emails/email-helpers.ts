import { niceBackendFetch } from "../../../../backend-helpers";

/**
 * Helper to get emails from the outbox, filtered by subject if provided.
 * Shared across email test files to avoid duplication.
 */
export async function getOutboxEmails(options?: { subject?: string }) {
  const listResponse = await niceBackendFetch("/api/v1/emails/outbox", {
    method: "GET",
    accessType: "server",
  });
  if (options?.subject) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return listResponse.body.items.filter((e: any) => e.subject === options.subject);
  }
  return listResponse.body.items;
}

