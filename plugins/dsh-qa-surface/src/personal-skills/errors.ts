/**
 * Coarse, wire-safe personal-skill failure codes. They ride the same
 * `(reason: <code>)` marker the account remotes established: the browser maps
 * them to audience-safe copy, while the precise cause stays in the Host log.
 */
export type QaPersonalSkillErrorReason =
  | "skills-disabled"
  | "workspace-unavailable"
  | "skill-not-found"
  | "skill-exists"
  | "skill-conflict"
  | "skill-name-invalid"
  | "skill-invalid"
  | "storage-unavailable";

export class QaPersonalSkillError extends Error {
  constructor(
    readonly reason: QaPersonalSkillErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "QaPersonalSkillError";
  }
}
