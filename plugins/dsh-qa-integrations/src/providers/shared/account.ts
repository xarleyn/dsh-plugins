/**
 * Account naming and payload normalization shared by the providers: every card
 * shows the connected account the same way, and every projection can index an
 * upstream answer without re-checking its shape.
 */

/** `Name (@username)` when both exist, whichever does, else the fallback. */
export function accountName(
  data: Record<string, unknown>,
  fallback: string,
): string {
  const name = typeof data["name"] === "string" ? data["name"].trim() : "";
  const username =
    typeof data["username"] === "string" ? data["username"].trim() : "";
  if (name !== "" && username !== "") return `${name} (@${username})`;
  return name !== "" ? name : username === "" ? fallback : `@${username}`;
}

/** Objects pass through; scalars and arrays wrap into `{ value }`. */
export function objectOf(data: unknown): Record<string, unknown> {
  return typeof data === "object" && data !== null && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : { value: data ?? null };
}
