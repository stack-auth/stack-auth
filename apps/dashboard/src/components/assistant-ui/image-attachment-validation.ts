import {
  MAX_IMAGE_BYTES_PER_FILE,
  MAX_IMAGE_MB_PER_FILE,
  MAX_IMAGES_PER_MESSAGE,
} from "@stackframe/stack-shared/dist/ai/image-limits";

type ValidationResult = { ok: true } | { ok: false, reason: string };

export function validateComposerImageCount(imageCount: number): ValidationResult {
  if (imageCount > MAX_IMAGES_PER_MESSAGE) {
    return {
      ok: false,
      reason: `Maximum ${MAX_IMAGES_PER_MESSAGE} images per message.`,
    };
  }
  return { ok: true };
}

export function validateComposerImageByteLength(bytes: number): ValidationResult {
  if (bytes > MAX_IMAGE_BYTES_PER_FILE) {
    return {
      ok: false,
      reason: `Image exceeds ${MAX_IMAGE_MB_PER_FILE}MB limit (${(bytes / 1024 / 1024).toFixed(2)}MB).`,
    };
  }
  return { ok: true };
}
