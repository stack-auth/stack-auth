/** Shared image attachment limits for AI chat (client composer + `/api/latest/ai/query/[mode]`). */

export const MAX_IMAGES_PER_MESSAGE = 3;
export const MAX_IMAGE_BYTES_PER_FILE = 3 * 1024 * 1024;
export const MAX_IMAGE_MB_PER_FILE = MAX_IMAGE_BYTES_PER_FILE / (1024 * 1024);

/** Decoded byte length of a base64 data URL or raw base64 (padding error ≤ 2 bytes). */
export function estimateBase64ByteLength(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(",");
  const base64 = commaIdx === -1 ? dataUrl : dataUrl.slice(commaIdx + 1);
  if (base64.length === 0) return 0;
  let padding = 0;
  if (base64.endsWith("==")) padding = 2;
  else if (base64.endsWith("=")) padding = 1;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

type ValidationResult = { ok: true } | { ok: false, reason: string };
type UnknownPart = { type?: unknown, image?: unknown };
type MessageLike = { role?: unknown, content?: unknown };

export function validateImageCount(imageCount: number): ValidationResult {
  if (imageCount > MAX_IMAGES_PER_MESSAGE) {
    return {
      ok: false,
      reason: `Maximum ${MAX_IMAGES_PER_MESSAGE} images per message.`,
    };
  }
  return { ok: true };
}

export function validateImageByteLength(bytes: number): ValidationResult {
  if (bytes > MAX_IMAGE_BYTES_PER_FILE) {
    return {
      ok: false,
      reason: `Image exceeds ${MAX_IMAGE_MB_PER_FILE}MB limit (${(bytes / 1024 / 1024).toFixed(2)}MB).`,
    };
  }
  return { ok: true };
}

/** Validates per-message image count and per-file size for user messages. */
export function validateImageAttachments(messages: readonly MessageLike[]): ValidationResult {
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    let imageCount = 0;
    for (const rawPart of msg.content as unknown[]) {
      if (!rawPart || typeof rawPart !== "object") continue;
      const part = rawPart as UnknownPart;
      if (part.type !== "image") continue;
      imageCount++;
      const countValidation = validateImageCount(imageCount);
      if (!countValidation.ok) return countValidation;
      if (typeof part.image === "string") {
        const bytes = estimateBase64ByteLength(part.image);
        const sizeValidation = validateImageByteLength(bytes);
        if (!sizeValidation.ok) return sizeValidation;
      }
    }
  }
  return { ok: true };
}
