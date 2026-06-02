import { MAX_IMAGE_BYTES_PER_FILE } from "@hexclave/shared/dist/ai/image-limits";

/**
 * Maximum pixel dimension (width or height) for compressed output.
 * 2048px is plenty for AI chat while keeping file sizes manageable.
 */
const MAX_DIMENSION = 2048;

/**
 * Target compressed size: well under the hard 3 MB server limit so the
 * base-64 encoded payload (≈ 33 % larger) still fits comfortably.
 */
const COMPRESS_TARGET_BYTES = Math.floor(MAX_IMAGE_BYTES_PER_FILE / 2);

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob == null) {
          reject(new Error("Canvas toBlob returned null"));
          return;
        }
        resolve(blob);
      },
      type,
      quality,
    );
  });
}

/**
 * Compresses an image `File` on the client so it stays well under the
 * server-side size limit. Returns the original file unchanged when it is
 * already small enough.
 *
 * Strategy:
 *  1. Down-scale to at most `MAX_DIMENSION` px on the longest side.
 *  2. Encode as JPEG with decreasing quality until the result fits.
 *  3. If quality alone isn't enough, halve the dimensions and retry.
 */
export async function compressImageFile(file: File): Promise<File> {
  if (file.size <= MAX_IMAGE_BYTES_PER_FILE) {
    return file;
  }

  const bitmap = await createImageBitmap(file);
  const dimensionScale = Math.min(
    1,
    MAX_DIMENSION / Math.max(bitmap.width, bitmap.height),
  );
  const baseWidth = Math.round(bitmap.width * dimensionScale);
  const baseHeight = Math.round(bitmap.height * dimensionScale);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (ctx == null) {
    bitmap.close();
    throw new Error("Failed to get canvas 2d context for image compression");
  }

  // Try progressively smaller sizes until the output fits.
  for (
    let sizeScale = 1;
    sizeScale >= 0.25;
    sizeScale = Math.round((sizeScale * 0.5) * 100) / 100
  ) {
    const w = Math.max(1, Math.round(baseWidth * sizeScale));
    const h = Math.max(1, Math.round(baseHeight * sizeScale));
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(bitmap, 0, 0, w, h);

    for (let quality = 0.85; quality >= 0.15; quality -= 0.1) {
      const blob = await canvasToBlob(canvas, "image/jpeg", quality);
      if (blob.size <= COMPRESS_TARGET_BYTES) {
        bitmap.close();
        return new File([blob], file.name, {
          type: "image/jpeg",
          lastModified: file.lastModified,
        });
      }
    }
  }

  // Fallback: lowest quality at the smallest attempted dimension.
  const blob = await canvasToBlob(canvas, "image/jpeg", 0.1);
  bitmap.close();
  return new File([blob], file.name, {
    type: "image/jpeg",
    lastModified: file.lastModified,
  });
}
