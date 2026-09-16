import type { QaAccountsController } from "../QaAccountsController.js";

/**
 * The signed-in QA account, as a client service.
 *
 * A QA panel plugin receives the account token through its panel props. A card
 * mounted in the host's own settings (`settings.plugin.item`) has no panel to
 * read it from, so this service is the one place such a surface asks whether a
 * QA account is signed in and obtains the bearer credential the
 * principal-scoped QA remotes authorize with.
 *
 * The credential is transport authentication only: a consumer must not persist
 * it, log it, or place it in a URL, a tool argument, or any model-visible
 * value.
 */

/** How far the account got. `checking` is the boot state before the stored token has been answered for. */
export type QaUserSessionStage = "checking" | "anonymous" | "authed";

/** What a browser half outside the QA overlay needs to speak to QA remotes. */
export type QaUserSessionSnapshot =
  | { readonly stage: "checking"; readonly token: null }
  | { readonly stage: "anonymous"; readonly token: null }
  | {
      readonly stage: "authed";
      /** Bearer credential for principal-scoped QA remotes. */
      readonly token: string;
    };

/** Read-only view of the current QA account, exposed as a client service. */
export interface QaUserSession {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => QaUserSessionSnapshot;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    qaUserSession: QaUserSession;
  }
}

const CHECKING: QaUserSessionSnapshot = Object.freeze({
  stage: "checking",
  token: null,
});
const ANONYMOUS: QaUserSessionSnapshot = Object.freeze({
  stage: "anonymous",
  token: null,
});
/**
 * Publishes the account state of the controller the QA overlay mounts. The
 * service lives for the whole host page while the controller is rebuilt
 * whenever the remote wiring re-injects, so {@link attach} swaps the source and
 * republishes; an unattached mirror stays in `checking`, which is what a card
 * that mounts before the accounts subsystem sees.
 */
export class QaUserSessionMirror implements QaUserSession {
  private controller: QaAccountsController | undefined;
  private unsubscribeSource: (() => void) | undefined;
  private snapshot: QaUserSessionSnapshot = CHECKING;
  private readonly listeners = new Set<() => void>();

  /** Bind the controller whose account state this view publishes. */
  attach(controller: QaAccountsController | undefined): void {
    this.unsubscribeSource?.();
    this.unsubscribeSource = undefined;
    this.controller = controller;
    this.unsubscribeSource = controller?.subscribe(() => {
      this.publish();
    });
    this.publish();
  }

  dispose(): void {
    this.attach(undefined);
    this.listeners.clear();
  }

  readonly getSnapshot = (): QaUserSessionSnapshot => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(): void {
    const next = this.derive();
    if (
      next.stage === this.snapshot.stage &&
      next.token === this.snapshot.token
    )
      return;
    this.snapshot = next;
    for (const listener of [...this.listeners]) listener();
  }

  private derive(): QaUserSessionSnapshot {
    const state = this.controller?.getSnapshot();
    const token = this.controller?.token() ?? null;
    // A stage of `authed` without a token cannot authorize anything, so it is
    // reported as anonymous rather than as a session that fails on first call.
    if (state?.stage === "authed" && token !== null) {
      return Object.freeze({ stage: "authed", token });
    }
    if (state === undefined || state.stage === "checking") return CHECKING;
    return ANONYMOUS;
  }
}
