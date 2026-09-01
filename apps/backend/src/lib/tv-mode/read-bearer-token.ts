import { StatusError } from "@hexclave/shared/dist/utils/errors";

export function readTvDisplayBearerToken(value: string | undefined): string {
  if (value == null || value.slice(0, "Bearer".length).toLowerCase() !== "bearer" || value["Bearer".length] !== " ") {
    throw new StatusError(401, "tv_display_access_required");
  }
  return value.slice("Bearer ".length);
}
