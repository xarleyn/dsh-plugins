/** A seeded ordinary child is a fork; delegated runs retain their own origin. */
export function qaDelegatedHeader(header: {
  readonly parentSession?: unknown;
  readonly origin?: unknown;
  readonly isSeeded?: boolean;
}): boolean {
  return (
    header.origin === "subagent" ||
    (header.parentSession !== undefined && header.isSeeded !== true)
  );
}
