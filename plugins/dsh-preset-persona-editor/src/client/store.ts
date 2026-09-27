/**
 * The page's state: the roster and the preset currently open.
 *
 * A controller rather than component state so the rules survive re-renders and
 * can be tested without a DOM: `snapshot()` is replaced only when a fact
 * changed, which is what `useSyncExternalStore` needs to avoid a re-render
 * loop, and every transition that fails leaves the previous facts intact.
 * @module client/store
 */

import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";

import type {
  PersonaCatalog,
  PersonaDocument,
  PersonaPresetRow,
} from "../types.js";
import { strings } from "./locale.js";

/** The Remote face the page drives. */
export interface PersonaFace {
  list(): Promise<RemoteResult<PersonaCatalog>>;
  read(agentPreset: string): Promise<RemoteResult<PersonaDocument>>;
}

/** A failure as it arrives over the wire. */
interface Failure {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

/** What the page shows beside the roster when something happened. */
export interface Notice {
  readonly kind: "info" | "warn" | "error";
  readonly text: string;
}

/** The preset currently open in the reader. */
export interface OpenPreset {
  readonly id: string;
  readonly status: "loading" | "ready" | "failed";
  readonly error: string;
  readonly document: PersonaDocument | null;
}

/** Everything the page renders from. */
export interface PersonaPageSnapshot {
  readonly status: "loading" | "ready" | "failed";
  /** What the roster screen says when it reads nothing: only `failed` shows it. */
  readonly error: string;
  readonly presets: readonly PersonaPresetRow[];
  readonly open: OpenPreset | null;
  readonly notice: Notice | null;
}

/** The page before anything has been read. */
export const INITIAL_STATE: PersonaPageSnapshot = {
  status: "loading",
  error: "",
  presets: [],
  open: null,
  notice: null,
};

/**
 * The text a failure deserves. Codes the editor raises itself get the page's
 * own wording; anything else shows the host's message unchanged, because a
 * failure this page has no words for is exactly the one a user should quote.
 * @param failure - the error branch of a Remote result.
 * @returns the message to render.
 */
export function describeFailure(failure: Failure): string {
  const reason = (failure.details as { readonly reason?: unknown } | undefined)
    ?.reason;
  switch (failure.code) {
    case "preset-persona/not-found":
      return strings.gone;
    case "preset-persona/invalid":
      return typeof reason === "string" && reason !== ""
        ? reason
        : failure.message;
    default:
      return failure.message;
  }
}

/** Drive the persona page: read the roster, open one preset. */
export class PersonaPageController {
  private state: PersonaPageSnapshot = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly face: PersonaFace) {}

  /** Subscribe to state changes (the `useSyncExternalStore` contract). */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** The current state; identity changes only when a fact changed. */
  readonly snapshot = (): PersonaPageSnapshot => this.state;

  private set(patch: Partial<PersonaPageSnapshot>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  private setOpen(id: string, patch: Partial<OpenPreset>): void {
    const open = this.state.open;
    if (open === null || open.id !== id) return;
    this.set({ open: { ...open, ...patch } });
  }

  /** Read the roster. Keeps the current list on screen while it refreshes. */
  async load(): Promise<void> {
    // A refresh over a list that is already on screen changes no fact until the
    // answer arrives, so it sets nothing here: an empty patch would hand
    // `useSyncExternalStore` a new object to re-render for.
    const first = this.state.presets.length === 0;
    if (first) this.set({ status: "loading", error: "" });
    const result = await this.face.list();
    if (!result.ok) {
      const reason = describeFailure(result.error);
      if (first) {
        this.set({ status: "failed", error: reason });
        return;
      }
      // The roster stays on screen, so this refusal is the page's to say out
      // loud: `status` keeps its "ready" and the failed screen that reads
      // `error` never renders over a list. The notice slot is what the ready
      // screen shows, so the stale rows arrive with the reason they are stale.
      this.set({
        notice: { kind: "error", text: `${strings.loadFailed} ${reason}` },
      });
      return;
    }
    this.set({
      status: "ready",
      error: "",
      presets: result.value.presets,
    });
  }

  /** Open one preset's persona for reading. */
  async open(id: string): Promise<void> {
    this.set({
      open: { id, status: "loading", error: "", document: null },
      notice: null,
    });
    const result = await this.face.read(id);
    if (!result.ok) {
      if (result.error.code === "preset-persona/not-found") {
        this.set({ open: null, notice: { kind: "warn", text: strings.gone } });
        await this.load();
        return;
      }
      this.setOpen(id, {
        status: "failed",
        error: describeFailure(result.error),
      });
      return;
    }
    this.setOpen(id, { status: "ready", document: result.value });
  }

  /** Leave the reader. */
  close(): void {
    this.set({ open: null, notice: null });
  }

  /** Re-read the open preset. */
  async reload(): Promise<void> {
    const id = this.state.open?.id;
    if (id !== undefined) await this.open(id);
  }

  /** Drop a notice the user has read. */
  dismissNotice(): void {
    if (this.state.notice !== null) this.set({ notice: null });
  }
}
