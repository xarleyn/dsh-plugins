/**
 * The page's state: the roster, the preset being edited, the draft, and the
 * one place every failure is turned into what the user reads.
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
  PersonaDraft,
  PersonaPresetRow,
  PersonaWriteReceipt,
} from "../types.js";
import { strings } from "./locale.js";

/** The Remote face the page drives. */
export interface PersonaFace {
  list(): Promise<RemoteResult<PersonaCatalog>>;
  read(agentPreset: string): Promise<RemoteResult<PersonaDocument>>;
  save(
    agentPreset: string,
    persona: PersonaDraft,
    expectedRevision: string,
  ): Promise<RemoteResult<PersonaWriteReceipt>>;
  reset(
    agentPreset: string,
    expectedRevision: string,
  ): Promise<RemoteResult<PersonaWriteReceipt>>;
  copy(
    from: string,
    id: string,
    name: string,
  ): Promise<RemoteResult<PersonaDocument>>;
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

/** The copy form of a shipped preset. */
export interface CopyDraft {
  readonly id: string;
  readonly name: string;
  readonly busy: boolean;
  readonly error: string;
}

/** The preset currently open in the editor. */
export interface OpenPreset {
  readonly id: string;
  readonly status: "loading" | "ready" | "failed";
  readonly error: string;
  readonly document: PersonaDocument | null;
  readonly draft: PersonaDraft | null;
  /** The last save was refused because the file changed underneath. */
  readonly conflict: boolean;
  /** The reset button has been armed and awaits a second click. */
  readonly pendingReset: boolean;
}

/** Everything the page renders from. */
export interface PersonaPageSnapshot {
  readonly status: "loading" | "ready" | "failed";
  readonly error: string;
  readonly authorable: boolean;
  readonly presets: readonly PersonaPresetRow[];
  readonly open: OpenPreset | null;
  readonly busy: boolean;
  readonly notice: Notice | null;
  readonly copyDraft: CopyDraft | null;
}

/** The page before anything has been read. */
export const INITIAL_STATE: PersonaPageSnapshot = {
  status: "loading",
  error: "",
  authorable: false,
  presets: [],
  open: null,
  busy: false,
  notice: null,
  copyDraft: null,
};

/** Whether the draft differs from the values the preset carries. */
export function isDirty(open: OpenPreset | null): boolean {
  if (open === null || open.document === null || open.draft === null)
    return false;
  const { persona } = open.document;
  const { draft } = open;
  return (
    draft.prefix !== persona.prefix ||
    draft.suffix !== persona.suffix ||
    draft.complete !== persona.complete ||
    draft.includeRuntimeContext !== persona.includeRuntimeContext
  );
}

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
    case "preset-persona/conflict":
      return strings.conflict;
    case "preset-persona/not-found":
      return strings.gone;
    case "preset-persona/read-only":
      return strings.readOnlyShipped;
    case "preset-persona/invalid":
      return typeof reason === "string" && reason !== ""
        ? reason
        : failure.message;
    default:
      return failure.message;
  }
}

/** Drive the persona page: read the roster, open a preset, write it back. */
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
    this.set(
      this.state.presets.length === 0
        ? { status: "loading", error: "", busy: true }
        : { busy: true },
    );
    const result = await this.face.list();
    if (!result.ok) {
      this.set({
        status: this.state.presets.length === 0 ? "failed" : "ready",
        error: describeFailure(result.error),
        busy: false,
      });
      return;
    }
    this.set({
      status: "ready",
      error: "",
      authorable: result.value.authorable,
      presets: result.value.presets,
      busy: false,
    });
  }

  /** Open one preset's persona for editing. */
  async open(id: string): Promise<void> {
    this.set({
      open: {
        id,
        status: "loading",
        error: "",
        document: null,
        draft: null,
        conflict: false,
        pendingReset: false,
      },
      copyDraft: null,
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
    this.setOpen(id, {
      status: "ready",
      document: result.value,
      draft: result.value.persona,
      conflict: false,
      pendingReset: false,
    });
  }

  /** Leave the editor. */
  close(): void {
    this.set({ open: null, copyDraft: null, notice: null });
  }

  /** Re-read the open preset, discarding local edits. */
  async reload(): Promise<void> {
    const id = this.state.open?.id;
    if (id !== undefined) await this.open(id);
  }

  /** Change one draft value. */
  edit(patch: Partial<PersonaDraft>): void {
    const open = this.state.open;
    if (open?.draft === null || open?.draft === undefined) return;
    this.setOpen(open.id, {
      draft: { ...open.draft, ...patch },
      conflict: false,
      pendingReset: false,
    });
    if (this.state.notice !== null) this.set({ notice: null });
  }

  /** Discard local edits back to the loaded values. */
  revert(): void {
    const open = this.state.open;
    if (open?.document === null || open?.document === undefined) return;
    this.setOpen(open.id, {
      draft: open.document.persona,
      conflict: false,
      pendingReset: false,
    });
  }

  /** Arm or disarm the reset confirmation. */
  armReset(armed: boolean): void {
    const open = this.state.open;
    if (open === null) return;
    this.setOpen(open.id, { pendingReset: armed });
  }

  /** Write the draft into the preset's composition. */
  async save(): Promise<void> {
    const open = this.state.open;
    if (open?.document == null || open.draft === null || this.state.busy)
      return;
    if (!isDirty(open)) {
      this.set({ notice: { kind: "info", text: strings.nothingToSave } });
      return;
    }
    const { id, document, draft } = open;
    this.set({ busy: true, notice: null });
    const result = await this.face.save(id, draft, document.revision);
    if (!result.ok) {
      if (result.error.code === "preset-persona/not-found") {
        this.set({
          busy: false,
          open: null,
          notice: { kind: "warn", text: strings.gone },
        });
        await this.load();
        return;
      }
      this.setOpen(id, {
        conflict: result.error.code === "preset-persona/conflict",
      });
      this.set({
        busy: false,
        notice: { kind: "error", text: describeFailure(result.error) },
      });
      return;
    }
    this.set({ busy: false, notice: { kind: "info", text: strings.saved } });
    await this.refresh(id);
  }

  /** Remove the persona row, so the preset inherits the deployment's persona. */
  async reset(): Promise<void> {
    const open = this.state.open;
    if (open?.document == null || this.state.busy) return;
    if (!open.pendingReset) {
      this.setOpen(open.id, { pendingReset: true });
      return;
    }
    const { id, document } = open;
    this.set({ busy: true, notice: null });
    const result = await this.face.reset(id, document.revision);
    if (!result.ok) {
      if (result.error.code === "preset-persona/not-found") {
        this.set({
          busy: false,
          open: null,
          notice: { kind: "warn", text: strings.gone },
        });
        await this.load();
        return;
      }
      this.setOpen(id, {
        conflict: result.error.code === "preset-persona/conflict",
      });
      this.set({
        busy: false,
        notice: { kind: "error", text: describeFailure(result.error) },
      });
      return;
    }
    this.set({ busy: false, notice: { kind: "info", text: strings.saved } });
    await this.refresh(id);
  }

  /** Open the copy form for the preset currently being edited. */
  beginCopy(): void {
    const open = this.state.open;
    if (open === null) return;
    const suffix = "-copy";
    this.set({
      copyDraft: {
        id: `${open.id}${suffix}`,
        name: `${open.document?.name || open.id} copy`,
        busy: false,
        error: "",
      },
    });
  }

  /** Change the copy form's id or name. */
  editCopy(patch: { readonly id?: string; readonly name?: string }): void {
    const draft = this.state.copyDraft;
    if (draft === null) return;
    this.set({ copyDraft: { ...draft, ...patch, error: "" } });
  }

  /** Close the copy form. */
  cancelCopy(): void {
    if (this.state.copyDraft !== null) this.set({ copyDraft: null });
  }

  /** Duplicate the open preset and open the copy. */
  async copy(): Promise<void> {
    const draft = this.state.copyDraft;
    const source = this.state.open?.id;
    if (draft === null || source === undefined || draft.busy) return;
    if (draft.id.trim() === "") {
      this.set({ copyDraft: { ...draft, error: strings.copyFailed } });
      return;
    }
    this.set({ copyDraft: { ...draft, busy: true, error: "" } });
    const result = await this.face.copy(
      source,
      draft.id.trim(),
      draft.name.trim(),
    );
    if (!result.ok) {
      this.set({
        copyDraft: {
          ...draft,
          busy: false,
          error: describeFailure(result.error),
        },
      });
      return;
    }
    this.set({ copyDraft: null });
    await this.load();
    await this.open(result.value.id);
  }

  /** Drop a notice the user has read. */
  dismissNotice(): void {
    if (this.state.notice !== null) this.set({ notice: null });
  }

  /** Re-read the roster and the open preset after a write. */
  private async refresh(id: string): Promise<void> {
    await this.load();
    const result = await this.face.read(id);
    if (!result.ok) {
      this.set({
        open: null,
        notice: { kind: "warn", text: describeFailure(result.error) },
      });
      return;
    }
    this.setOpen(id, {
      status: "ready",
      document: result.value,
      draft: result.value.persona,
      conflict: false,
      pendingReset: false,
    });
  }
}
