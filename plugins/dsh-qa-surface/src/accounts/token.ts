import { createHmac, timingSafeEqual } from "node:crypto";

/** The account facts token verification needs: identity plus token version. */
interface TokenUser {
  readonly id: string;
  readonly tokenVersion?: number;
}

/** The claims carried by a v1 account token payload. */
export interface TokenPayload {
  readonly uid: string;
  /** Expiry, epoch milliseconds. */
  readonly exp: number;
  /** The account's token version at mint time. */
  readonly ver: number;
}

export function base64Url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

/**
 * Mint a v1 account token: a base64url JSON payload plus an HMAC-SHA256
 * signature keyed with the accounts file secret.
 */
export function mintToken(secret: string, payload: TokenPayload): string {
  const encoded = base64Url(JSON.stringify(payload));
  const signature = base64Url(
    createHmac("sha256", secret).update(encoded).digest(),
  );
  return `v1.${encoded}.${signature}`;
}

/**
 * Verify a v1 account token against the current secret and account list and
 * return its user id, or null for anything malformed, foreign-signed,
 * expired or superseded. Signature computation, the length check and the
 * payload decode share one try, so a hostile token can only ever resolve to
 * null; the comparison is timing-safe (equal length first, then
 * timingSafeEqual) so a signature guess cannot be accelerated by measuring
 * HMAC rejection time.
 */
export function verifyToken(
  secret: string,
  token: string,
  users: readonly TokenUser[],
): string | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const payload = parts[1];
  const signature = parts[2];
  if (payload === undefined || signature === undefined) return null;
  let expected: Buffer;
  let decoded: { uid?: unknown; exp?: unknown; ver?: unknown };
  try {
    expected = createHmac("sha256", secret).update(payload).digest();
    const expectedSignature = base64Url(expected);
    if (
      signature.length !== expectedSignature.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
    ) {
      return null;
    }
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    typeof decoded.uid !== "string" ||
    typeof decoded.exp !== "number" ||
    decoded.exp < Date.now()
  ) {
    return null;
  }
  // The account's current token version must match the one burned into the
  // token: bumping it (disable/revoke) invalidates every issued token.
  const user = users.find((candidate) => candidate.id === decoded.uid);
  const version = typeof decoded.ver === "number" ? decoded.ver : undefined;
  if (user === undefined || version !== (user.tokenVersion ?? 0)) {
    return null;
  }
  return decoded.uid;
}
