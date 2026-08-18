import { StatusError } from "@hexclave/shared/dist/utils/errors";

/**
 * "verified" is identified / signed-up (`ProjectUser.isAnonymous = false`),
 * not email-verified.
 */
export type SessionReplayUserKind = "anonymous" | "verified";

export function parseSessionReplayUserKind(raw: string | undefined): SessionReplayUserKind | null {
  if (raw == null || raw === "") return null;
  switch (raw) {
    case "anonymous":
    case "verified": {
      return raw;
    }
    default: {
      throw new StatusError(StatusError.BadRequest, "user_kind must be anonymous or verified");
    }
  }
}

export function sessionReplayUserKindIsAnonymous(userKind: SessionReplayUserKind): boolean {
  switch (userKind) {
    case "anonymous": {
      return true;
    }
    case "verified": {
      return false;
    }
    default: {
      userKind satisfies never;
      throw new StatusError(StatusError.BadRequest, "user_kind must be anonymous or verified");
    }
  }
}
