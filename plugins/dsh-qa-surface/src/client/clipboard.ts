import { useCallback, useState } from "react";
import { useTransientFlag } from "./markdown/use-transient-flag.js";

/** How long the confirmation that a copy landed stays on screen. */
const COPIED_WINDOW_MS = 1200;

/**
 * The sentence a copy affordance falls back to. Three surfaces show it, so it
 * is written once.
 */
export const COPY_MANUAL_HINT = "Скопируйте вручную";

/** The reason behind that sentence, for the tooltip that carries it. */
export const COPY_MANUAL_REASON =
  "Браузер не отдаёт буфер обмена — выделите текст и скопируйте его сами";

function hasClipboardApi(): boolean {
  return navigator.clipboard?.writeText !== undefined;
}

/**
 * Whether this browser can be asked to move text at all.
 *
 * The stand is served over plain HTTP on a LAN address, and there
 * `window.isSecureContext` is false, so the browser never exposes
 * `navigator.clipboard`. The older copy command still works in an insecure
 * context, which is why the absence of the API alone does not mean copying is
 * impossible — and why asking for it anyway only ends in silence.
 */
export function canCopyToClipboard(): boolean {
  return hasClipboardApi() || typeof document.execCommand === "function";
}

/**
 * Write `text` to the clipboard, resolving false when nothing took it — the
 * caller then says so instead of leaving the click unanswered.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  const clipboard = navigator.clipboard;
  if (clipboard?.writeText !== undefined) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // A denied permission or a document the browser no longer treats as
      // focused lands here while the user gesture is still open, so the
      // command below gets the same click.
    }
  }
  return copyThroughField(text);
}

/** The pre-API path: select a throwaway field and ask the browser to copy it. */
function copyThroughField(text: string): boolean {
  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  field.setAttribute("aria-hidden", "true");
  // Out of sight but laid out: a hidden field cannot be selected, and a field
  // in the flow would shove the page around for the moment it exists.
  field.style.position = "fixed";
  field.style.top = "0";
  field.style.left = "-100vw";
  document.body.appendChild(field);
  field.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

export interface CopyAction {
  /** The flash that says the text left. */
  readonly copied: boolean;
  /** Nothing can copy here: the affordance is a hint, not a button. */
  readonly impossible: boolean;
  /** A copy was attempted and refused: the hint joins a still-live button. */
  readonly refused: boolean;
  readonly copy: () => void;
}

/**
 * The copy state one affordance needs: the confirmation window, the refusal
 * that replaces it with the manual hint, and whether either was ever possible.
 */
export function useCopyAction(text: string): CopyAction {
  const [impossible] = useState(() => !canCopyToClipboard());
  const { on: copied, pulse } = useTransientFlag(COPIED_WINDOW_MS);
  const [refused, setRefused] = useState(false);
  const copy = useCallback(() => {
    void copyTextToClipboard(text).then((ok) => {
      setRefused(!ok);
      if (ok) pulse();
    });
  }, [text, pulse]);
  return { copied, impossible, refused, copy };
}
