/** A reserved catalog-only target: never an empty or real session id. */
const PREFIX = "qa-slash-draft:";
export interface QaSlashDraftTarget {
  readonly subroleId: string | null;
  readonly adminPreview: boolean;
}
export function slashDraftTarget(
  subroleId: string | null,
  adminPreview: boolean,
): string {
  return PREFIX + JSON.stringify([subroleId, adminPreview]);
}
export function parseSlashDraftTarget(
  target: string,
): QaSlashDraftTarget | undefined {
  if (!target.startsWith(PREFIX)) return undefined;
  const value: unknown = JSON.parse(target.slice(PREFIX.length));
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    (value[0] !== null && typeof value[0] !== "string") ||
    typeof value[1] !== "boolean"
  ) {
    throw new TypeError("Invalid draft catalog target");
  }
  return {
    subroleId: value[0] as string | null,
    adminPreview: value[1] as boolean,
  };
}
