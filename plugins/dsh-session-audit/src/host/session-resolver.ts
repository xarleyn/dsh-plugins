/**
 * Binding an audit directory to a session.
 *
 * The rule the SPEC §14 fixes is a strict priority, and the priority is the
 * whole design:
 *
 * 1. `analysis.json → trajectory.sessionId` is authoritative. A producer that
 *    recorded the session id has said which session it audited, and nothing
 *    about a directory name outranks that.
 * 2. Only when the analysis cannot say — an unknown schema, a document that
 *    never carried the field — is the directory name consulted, first as an
 *    exact session id, then as a unique prefix.
 *
 * A prefix matching more than one session resolves to nothing (SPEC §15). An
 * audit attached to the wrong session is worse than an audit shown nowhere:
 * one is invisible, the other is a lie about someone's work.
 */
import type { AuditError } from "@yadsh/dsh-audit-core";

/** The outcome of trying to bind one audit to a session. */
export type SessionResolution =
  | { readonly status: "resolved"; readonly sessionId: string }
  | {
      readonly status: "unresolved";
      readonly sessionId: null;
      readonly error: AuditError;
    };

export interface SessionResolverOptions {
  /**
   * The harness' session ids.
   *
   * Called only for the fallback path, so the common case — an analysis that
   * names its session — never pays for a session listing.
   */
  readonly listSessionIds: () => Promise<readonly string[]>;
  /** Whether a directory-name prefix may stand in for a missing id. */
  readonly allowDirectoryPrefixMatch: boolean;
}

export class SessionResolver {
  constructor(private readonly options: SessionResolverOptions) {}

  /**
   * Bind one audit.
   *
   * @param declaredSessionId - `trajectory.sessionId`, when readable.
   * @param directoryName - the audit directory's basename.
   */
  async resolve(
    declaredSessionId: string | null,
    directoryName: string,
  ): Promise<SessionResolution> {
    if (declaredSessionId !== null) {
      return { status: "resolved", sessionId: declaredSessionId };
    }

    let sessionIds: readonly string[];
    try {
      sessionIds = await this.options.listSessionIds();
    } catch (error) {
      return {
        status: "unresolved",
        sessionId: null,
        error: {
          code: "SESSION_NOT_FOUND",
          message: `cannot list sessions to resolve ${JSON.stringify(directoryName)}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          severity: "error",
        },
      };
    }

    if (sessionIds.includes(directoryName)) {
      return { status: "resolved", sessionId: directoryName };
    }

    if (!this.options.allowDirectoryPrefixMatch) {
      return {
        status: "unresolved",
        sessionId: null,
        error: {
          code: "SESSION_NOT_FOUND",
          message: `no session matches the audit directory ${JSON.stringify(directoryName)}`,
          severity: "error",
        },
      };
    }

    const matches = sessionIds.filter((sessionId) =>
      sessionId.startsWith(directoryName),
    );
    if (matches.length === 1) {
      const match = matches[0];
      if (match !== undefined) {
        return { status: "resolved", sessionId: match };
      }
    }
    if (matches.length > 1) {
      return {
        status: "unresolved",
        sessionId: null,
        error: {
          code: "SESSION_ID_AMBIGUOUS",
          message: `${matches.length} sessions match the audit directory ${JSON.stringify(directoryName)}; the audit is not attached to any of them`,
          severity: "error",
        },
      };
    }

    return {
      status: "unresolved",
      sessionId: null,
      error: {
        code: "SESSION_NOT_FOUND",
        message: `no session matches the audit directory ${JSON.stringify(directoryName)}`,
        severity: "error",
      },
    };
  }

  /**
   * A cross-file sanity check, never a verdict (SPEC §61).
   *
   * A directory named for one session while the analysis names another is
   * worth a note in the log — it usually means an audit was copied into the
   * wrong place. The analysis still wins, because it is the only side that can
   * be right.
   */
  static directoryAgreesWithSession(
    directoryName: string,
    sessionId: string,
  ): boolean {
    return sessionId === directoryName || sessionId.startsWith(directoryName);
  }
}
