import { KnownErrors } from "@hexclave/shared";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

export function assertIsAiChatReviewer(auth: {
  project: { id: string },
  user?: { client_read_only_metadata?: unknown } | null,
}): void {
  if (auth.project.id !== "internal") {
    throw new KnownErrors.ExpectedInternalProject();
  }

  const user = auth.user;
  if (!user) {
    throw new StatusError(StatusError.Unauthorized, "You must be signed in to perform MCP review operations.");
  }

  const metadata = user.client_read_only_metadata;
  if (!(metadata && typeof metadata === "object" && "isAiChatReviewer" in metadata && metadata.isAiChatReviewer === true)) {
    throw new StatusError(StatusError.Forbidden, "You are not approved to perform MCP review operations.");
  }
}
