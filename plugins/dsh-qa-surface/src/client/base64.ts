/**
 * Browser-side binary-to-base64. Chunked so `String.fromCharCode` never
 * crosses the engine's argument limit on large attachments.
 */

/**
 * @param bytes - raw bytes to encode.
 * @returns the canonical base64 text (no `data:` prefix, no padding tricks).
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}
