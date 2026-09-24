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
 *
 * Rule 1 is about *which session*, and a repair of the id's spelling leaves it
 * intact: a producer that writes the id without the harness' own `session-`
 * prefix names a session the host has never heard of, and rule 1 would bind the
 * audit to a key no view ever asks with. See
 * {@link SessionResolver.repairDeclaredSessionId}.
 */
import type { AuditError } from "@yadsh/dsh-audit-core";

/** How the harness spells a session id: `session-` followed by the uuid. */
const SESSION_ID_PREFIX = "session-";

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
   * Called for the fallback path and to verify a declared id that lacks the
   * `session-` prefix, so an analysis naming its session the way the harness
   * spells one never pays for a session listing.
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
      return {
        status: "resolved",
        sessionId: await this.repairDeclaredSessionId(declaredSessionId),
      };
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
   * Put back a `session-` prefix the producer left off.
   *
   * The analysis stays the one that says which session: nothing here picks a
   * session the document did not name. A bare uuid is matched against the
   * corpus as the *complete* id it would become with the prefix — never as a
   * prefix itself, so a truncated id is left alone rather than snapped to the
   * nearest session. Anything the corpus does not recognisely spell as its own
   * comes back unchanged, which is how a declared id has always behaved.
   *
   * @param declaredSessionId - `trajectory.sessionId` as the analysis wrote it.
   */
  private async repairDeclaredSessionId(
    declaredSessionId: string,
  ): Promise<string> {
    if (declaredSessionId.startsWith(SESSION_ID_PREFIX)) {
      return declaredSessionId;
    }

    let sessionIds: readonly string[];
    try {
      sessionIds = await this.options.listSessionIds();
    } catch {
      // Repairing is a courtesy to a mis-spelled id, so a corpus that cannot be
      // listed must not cost an audit the binding it already had.
      return declaredSessionId;
    }

    const prefixed = `${SESSION_ID_PREFIX}${declaredSessionId}`;
    return sessionIds.includes(prefixed) ? prefixed : declaredSessionId;
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
