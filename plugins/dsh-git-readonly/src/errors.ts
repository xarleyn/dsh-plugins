/**
 * Typed domain errors of the dsh-git-readonly tools.
 *
 * Every failure the model can observe carries a stable machine-readable
 * `code`; the message is the human-facing explanation. Codes are never
 * reused for a different meaning.
 */

export type GitToolErrorCode =
  | 'no-session-cwd'
  | 'not-a-git-repository'
  | 'invalid-oid'
  | 'invalid-path'
  | 'invalid-argument'
  | 'git-timeout'
  | 'git-failed';

export class GitToolError extends Error {
  readonly code: GitToolErrorCode;

  constructor(code: GitToolErrorCode, message: string) {
    super(`dsh-git-readonly (${code}): ${message}`);
    this.name = 'GitToolError';
    this.code = code;
  }
}
