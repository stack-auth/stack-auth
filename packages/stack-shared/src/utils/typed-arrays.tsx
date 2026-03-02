import { StackAssertionError } from "./errors";

/**
 * Ensures a Uint8Array is backed by a regular ArrayBuffer (not SharedArrayBuffer).
 *
 * TypeScript 5.7+ made typed arrays generic over their buffer type. Bare `Uint8Array`
 * defaults to `Uint8Array<ArrayBufferLike>`, which includes SharedArrayBuffer. Web Crypto
 * APIs require `BufferSource` which only accepts `ArrayBufferView<ArrayBuffer>`. This
 * function narrows the type using an instanceof guard, creating a same-buffer view
 * (zero-copy) when the buffer is already an ArrayBuffer.
 */
export function toArrayBufferBacked(arr: Uint8Array): Uint8Array<ArrayBuffer> {
  if (arr.buffer instanceof SharedArrayBuffer) {
    throw new StackAssertionError("SharedArrayBuffer-backed Uint8Arrays are not supported in this context");
  }
  return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
}
