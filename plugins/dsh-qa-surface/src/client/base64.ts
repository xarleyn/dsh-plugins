/**
 * Browser-side base64. Encoding is chunked so `String.fromCharCode` never
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

/**
 * Decode base64 the Host sent for a file the panel could not read as text.
 *
 * A malformed body is tolerated rather than thrown on: the caller is about to
 * hand the bytes to a download or an image tag, and a partial file is a better
 * outcome than losing the panel to an exception. `atob` still rejects input
 * that is not base64 at all; the caller keeps that refusal.
 *
 * @param value - base64 text, with or without a data-URL prefix.
 * @returns the decoded bytes.
 */
export function base64ToBytes(value: string): Uint8Array {
  const separator = value.indexOf(",");
  const body = (separator === -1 ? value : value.slice(separator + 1)).replace(
    /\s+/gu,
    "",
  );
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
