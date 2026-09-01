import { StatusError } from "@hexclave/shared/dist/utils/errors";

export function readTvDisplayBearerToken(value: string | undefined): string {
  const token = value?.slice("Bearer ".length);
  if (
    value == null
    || value.slice(0, "Bearer".length).toLowerCase() !== "bearer"
    || value["Bearer".length] !== " "
    || token == null
    || token === ""
    || /^\s/.test(token)
  ) {
    throw new StatusError(401, "tv_display_access_required");
  }
  return token;
}
