/**
 * The one thing this plugin needs from the host's QA surface: which account a
 * session belongs to.
 *
 * Declared structurally rather than imported from `@yadsh/dsh-qa-surface` so
 * the plugin keeps working — and keeps typechecking — in a deployment that
 * installs no accounts surface at all. That is not a shortcut around a
 * dependency: an installation without accounts has exactly one memory space,
 * and the absence of the service *is* the answer to "per account or not".
 *
 * The lookup of an account, and the owner a call takes when it has none, are
 * `PrincipalIdentities`: the same question asked of a live service.
 */
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import type { ResolvedConfig } from "../config.js";
import { DEPLOYMENT_MEMORY_OWNER, type MemoryOwner } from "./resolver.js";

export interface QaPrincipalSurface {
  /** The account a chat root was attested by; never for a delegated child. */
  principalForSession(sessionId: string):
    | {
        readonly userId: string;
      }
    | undefined;
}

/**
 * The surface, when the value mounted under its id really answers for a
 * session. A deployment whose QA surface is absent, still starting, or without
 * that method reads as "no accounts here", which is what the plugin then acts
 * on instead of guessing at an owner.
 */
export function asQaPrincipalSurface(
  value: unknown,
): QaPrincipalSurface | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Partial<QaPrincipalSurface>;
  return typeof candidate.principalForSession === "function"
    ? (candidate as QaPrincipalSurface)
    : undefined;
}

/** The facts the lookup reads through the service, never a snapshot of them. */
export interface PrincipalIdentitiesOptions {
  logger: PluginLogger;
  /** The value mounted under `qaSurface`, asked once rather than at load. */
  surface(): unknown;
  /** Live configuration, so changing it needs no restart of the lookup. */
  config(): ResolvedConfig;
}

/**
 * Who a call speaks for, and therefore whose memory it reaches.
 *
 * The service half of per-account memory: a run names its caller by session,
 * while a management page has no session to name. The surface is resolved on
 * first use and remembered, because a deployment does not grow one while it
 * runs; the account and the configuration are read on every call, so neither is
 * ever the answer of an earlier state.
 */
export class PrincipalIdentities {
  private readonly options: PrincipalIdentitiesOptions;
  private surface: QaPrincipalSurface | undefined;
  private surfaceChecked = false;

  constructor(options: PrincipalIdentitiesOptions) {
    this.options = options;
  }

  /**
   * The QA surface, resolved on first use and remembered.
   *
   * A deployment without one owns a single memory space for the whole
   * installation, exactly as it did before per-account memory existed; that is
   * an answer, not a failure to look up.
   */
  private surfaceOf(): QaPrincipalSurface | undefined {
    if (!this.surfaceChecked) {
      this.surfaceChecked = true;
      this.surface = asQaPrincipalSurface(this.options.surface());
      if (this.surface !== undefined) {
        this.options.logger.info("domain-experts/qa-principals-active", {
          perUserMemory: this.options.config().perUserMemory,
        });
      }
    }
    return this.surface;
  }

  /**
   * The account a session was attested by, or `undefined`.
   *
   * Never read from a tool argument or a browser request: the caller's own
   * session is the only thing asked, which is what keeps another account's
   * namespace out of reach of a crafted id.
   */
  principalOf(sessionId: string): string | undefined {
    return this.surfaceOf()?.principalForSession(sessionId)?.userId;
  }

  /** Whether this deployment keeps a memory namespace per account. */
  perUserMemory(): boolean {
    return (
      this.options.config().perUserMemory && this.surfaceOf() !== undefined
    );
  }

  /**
   * The owner a resolution without a caller session stands for: the UI's
   * preview and its memory inspector.
   *
   * It has no account to name — a settings page is not a chat — so it shows the
   * domain tier, and the entry note says what an attributed run gets instead.
   */
  unattributedOwner(): MemoryOwner {
    return this.perUserMemory()
      ? { mode: "per-user", userId: undefined }
      : DEPLOYMENT_MEMORY_OWNER;
  }
}
