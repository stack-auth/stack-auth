import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { isUuid } from "@hexclave/shared/dist/utils/uuids";

export function parseCommsMessageCursor(
  cursor: string | undefined,
): { occurredAtMillis?: number, messageId?: string } {
  if (cursor == null) {
    return {};
  }

  const separator = cursor.indexOf(":");
  const occurredAtPart = cursor.slice(0, separator);
  const occurredAtMillis = Number(occurredAtPart);
  const messageId = cursor.slice(separator + 1);
  const occurredAt = new Date(occurredAtMillis);
  if (
    separator <= 0
    || separator === cursor.length - 1
    || !/^-?\d+$/.test(occurredAtPart)
    || !Number.isSafeInteger(occurredAtMillis)
    || Number.isNaN(occurredAt.getTime())
    || !isUuid(messageId)
  ) {
    throw new StatusError(StatusError.BadRequest, "Invalid message cursor");
  }
  return { occurredAtMillis, messageId };
}
