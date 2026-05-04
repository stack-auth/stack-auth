import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

export function assertIsAiChatReviewer(user: { client_read_only_metadata?: unknown }): void {
  const metadata = user.client_read_only_metadata;
  if (!(metadata && typeof metadata === "object" && "isAiChatReviewer" in metadata && metadata.isAiChatReviewer === true)) {
    throw new StatusError(StatusError.Forbidden, "You are not approved to perform MCP review operations.");
  }
}
