import { useCallback, useEffect, useRef, useState } from "react";
import type { QaSubrole } from "../../types.js";

/**
 * The administrator preview mode, as a property of the history entry.
 *
 * "Preview as role" navigates to the chat route carrying a marker in the
 * history state. Deriving the mode from the entry — instead of latching it in
 * component state — is what lets the browser's own Back button leave the
 * preview, and what keeps a preview from outliving its entry: while the mode
 * was latched, every later new chat in that browser tab was created as a
 * preview of the previewed profile, silently ignoring the account's default
 * profile, with the role selector hidden and only a corner banner to say so.
 */

/** One preview in force: the role and the name it was previewed under. */
export interface QaAdminPreview {
  readonly roleId: string;
  readonly name: string;
}

interface PreviewState {
  readonly qaPreview: string;
  readonly qaPreviewName: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** The history state a "Preview as role" navigation carries. */
export function previewEntryState(
  role: Pick<QaSubrole, "id" | "name">,
): PreviewState {
  return { qaPreview: role.id, qaPreviewName: role.name };
}

/**
 * The preview one history entry asks for, or undefined for an ordinary entry.
 *
 * Home of an older Host or of a cleared entry carries no marker at all, and a
 * marker whose role id cannot be read is ignored rather than guessed: the name
 * is cosmetic, so an entry written before names travelled with the marker
 * still previews, under its role id.
 */
export function readPreviewEntry(state: unknown): QaAdminPreview | undefined {
  if (!isRecord(state)) return undefined;
  const roleId = text(state.qaPreview);
  if (roleId === undefined) return undefined;
  return { roleId, name: text(state.qaPreviewName) ?? roleId };
}

export type QaPreviewTransition =
  | { readonly kind: "enter"; readonly preview: QaAdminPreview }
  | { readonly kind: "leave" }
  | { readonly kind: "keep" };

/**
 * What the surface should do with the preview mode for one history entry.
 *
 * Only an administrator can preview, so an entry that asks for one while an
 * ordinary account is signed in leaves the mode instead of entering it — the
 * marker survives in the browser's history across a sign-out, and latching it
 * again would hand the next account a chat under a profile it was never
 * assigned.
 * @param input - the entry's state, the preview in force, and who is signed in.
 * @returns enter, leave, or keep, so the caller only writes state it must.
 */
export function planPreviewTransition(input: {
  readonly state: unknown;
  readonly preview: QaAdminPreview | null;
  readonly isAdmin: boolean;
}): QaPreviewTransition {
  if (!input.isAdmin)
    return input.preview === null ? { kind: "keep" } : { kind: "leave" };
  const entry = readPreviewEntry(input.state);
  if (entry === undefined) {
    return input.preview === null ? { kind: "keep" } : { kind: "leave" };
  }
  if (entry.roleId === input.preview?.roleId) return { kind: "keep" };
  return { kind: "enter", preview: entry };
}

/** The slice of the browser the preview needs; a test injects its own. */
export interface QaPreviewBrowser {
  readonly state: unknown;
  pushState(data: unknown, unused: string, url?: string | null): void;
  replaceState(data: unknown, unused: string, url?: string | null): void;
  /** Subscribe to browser navigation; returns the unsubscribe. */
  onPopState(listener: () => void): () => void;
}

/** The live browser, read at call time so a test's own history is honoured. */
const BROWSER: QaPreviewBrowser = {
  get state() {
    return window.history.state;
  },
  pushState: (data, unused, url) => window.history.pushState(data, unused, url),
  replaceState: (data, unused, url) =>
    window.history.replaceState(data, unused, url),
  onPopState: (listener) => {
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  },
};

export interface QaAdminPreviewOptions {
  /** Only an administrator may preview; anyone else leaves the mode. */
  readonly isAdmin: boolean;
  /** The account's own default profile, restored when a preview ends. */
  readonly fallbackSubrole: string | null;
  /** The chat route a preview navigation returns to. */
  readonly previewUrl: string;
  /** Called with the profile the next chat must use; null when none is known. */
  readonly onSelect: (roleId: string | null) => void;
  /**
   * Re-checked on every browser navigation AND whenever this changes: an
   * in-app navigation to the chat route arrives without a `popstate` event.
   */
  readonly routeKey: string;
  readonly target?: QaPreviewBrowser;
}

export interface QaAdminPreviewMode {
  /** The preview in force right now, if any. */
  readonly preview: QaAdminPreview | null;
  /** Enter the preview of one role, as the administration console asks. */
  readonly enter: (role: Pick<QaSubrole, "id" | "name">) => void;
  /**
   * End the mode because the chat on screen is not a preview, leaving the
   * history entry alone: going Back to it is entering the preview again.
   */
  readonly clear: () => void;
  /** End the mode for good, as the administrator asked from the banner. */
  readonly leave: () => void;
}

/**
 * The administrator preview mode of one browser tab.
 *
 * The mode is a property of the history entry, so entering and leaving it
 * follows the browser: the console pushes an entry that carries the preview,
 * every navigation back to an entry without one ends the mode, and only an
 * administrator can hold it. The alternative — reading the marker once and
 * latching it in component state — kept the mode alive for the whole tab, and
 * since the role selector is hidden while previewing, later new chats silently
 * ran as the previewed profile instead of the account's default one.
 * @param options - who is signed in, the account default, and the history.
 * @returns the preview in force plus the two explicit transitions.
 */
export function useQaAdminPreview(
  options: QaAdminPreviewOptions,
): QaAdminPreviewMode {
  const target = options.target ?? BROWSER;
  const [preview, setPreview] = useState<QaAdminPreview | null>(null);
  // The listener is registered once per navigation source and cannot read the
  // render it came from, so the current value travels in a ref as well.
  const current = useRef<QaAdminPreview | null>(null);
  const { onSelect, fallbackSubrole, isAdmin, previewUrl, routeKey } = options;
  const apply = useCallback((next: QaAdminPreview | null) => {
    current.current = next;
    setPreview(next);
  }, []);

  useEffect(() => {
    const sync = () => {
      const transition = planPreviewTransition({
        state: target.state,
        preview: current.current,
        isAdmin,
      });
      if (transition.kind === "enter") {
        apply(transition.preview);
        onSelect(transition.preview.roleId);
        return;
      }
      if (transition.kind === "leave") {
        apply(null);
        onSelect(fallbackSubrole);
      }
    };
    const unsubscribe = target.onPopState(sync);
    sync();
    return unsubscribe;
  }, [apply, fallbackSubrole, isAdmin, onSelect, routeKey, target]);

  const enter = useCallback(
    (role: Pick<QaSubrole, "id" | "name">) => {
      apply({ roleId: role.id, name: role.name });
      onSelect(role.id);
      target.pushState(previewEntryState(role), "", previewUrl);
    },
    [apply, onSelect, previewUrl, target],
  );

  const leave = useCallback(() => {
    apply(null);
    onSelect(fallbackSubrole);
    target.replaceState(null, "", null);
  }, [apply, fallbackSubrole, onSelect, target]);

  const clear = useCallback(() => apply(null), [apply]);

  return { preview, enter, clear, leave };
}
