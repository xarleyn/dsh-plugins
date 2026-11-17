import {
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { DEFAULT_USAGE_GUIDE } from "../../shared/usage-guide.js";
import { trapKeys } from "../focus-ring.js";
import { renderMarkdown } from "../markdown/render.js";
import type { StorageLike } from "../types.js";
import { joinQaDialogStack } from "./QaModal.js";
import { QaWelcomeNotice } from "./QaWelcomeNotice.js";

interface QaOnboardingProps {
  readonly storage: StorageLike;
  readonly namespace: string;
  readonly markdown: string;
  readonly opener: HTMLButtonElement | null;
  readonly onClose: () => void;
}

/** The Host welcome step and the deployment guide have independent receipts. */
export function QaOnboarding(props: QaOnboardingProps) {
  const [welcomed, setWelcomed] = useState(false);
  if (!welcomed) {
    return (
      <QaWelcomeNotice
        storage={props.storage}
        storageKey={`${props.namespace}:welcome-notice`}
        complete={() => setWelcomed(true)}
      />
    );
  }
  const markdown = props.markdown ?? DEFAULT_USAGE_GUIDE;
  return <QaUsageGuide key={markdown} {...props} markdown={markdown} />;
}

/** Parse once so link definitions and footnotes work across section boundaries. */
function GuideBody({ markdown }: { readonly markdown: string }) {
  const blocks = useMemo(() => {
    const intro: ReactNode[] = [];
    const sections: { heading: ReactNode; body: ReactNode[] }[] = [];
    let body = intro;
    for (const block of renderMarkdown(markdown, {})) {
      if (isValidElement(block) && block.type === "h2") {
        body = [];
        sections.push({ heading: block, body });
      } else {
        body.push(block);
      }
    }
    return { intro, sections };
  }, [markdown]);
  return (
    <div className="dsh-qa-guide">
      <div className="dsh-qa-md">{blocks.intro}</div>
      {blocks.sections.map((section, index) => (
        <details className="dsh-qa-guide__topic" key={index}>
          <summary>{section.heading}</summary>
          <div className="dsh-qa-md">{section.body}</div>
        </details>
      ))}
    </div>
  );
}

function QaUsageGuide({
  storage,
  namespace,
  markdown,
  opener,
  onClose,
}: QaOnboardingProps) {
  const storageKey = `${namespace}:usage-guide`;
  const [accepted, setAccepted] = useState(() => {
    try {
      return storage.getItem(storageKey) === markdown;
    } catch {
      return false;
    }
  });
  const [checked, setChecked] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const open = !accepted || opener !== null;
  useEffect(() => {
    if (!open) return;
    const layer = joinQaDialogStack();
    const restoreFocus = opener ?? document.activeElement;
    const root = document.getElementById("root");
    const wasInert = root?.inert ?? false;
    if (root) root.inert = true;
    content.current?.focus();
    // Host tooltips handle Escape during document capture. The top QA dialog
    // takes it first, and an image opened from the guide keeps its own Escape.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !layer.innermost()) return;
      event.preventDefault();
      event.stopPropagation();
      if (accepted) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      layer.leave();
      if (root) root.inert = wasInert;
      if (restoreFocus instanceof HTMLElement && restoreFocus.isConnected)
        restoreFocus.focus({ preventScroll: true });
    };
  }, [open, accepted, opener, onClose]);

  if (!open) return null;
  function accept() {
    if (!checked) return;
    try {
      storage.setItem(storageKey, markdown);
    } catch {
      // Storage can be unavailable in an embedded or private browser.
    }
    setAccepted(true);
    onClose();
  }
  return createPortal(
    <div
      className="dsh-qa-guide-dialog"
      data-testid="qa-guide-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qa-guide-title"
      onClick={(event) => {
        if (accepted && event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const dialog =
          event.target instanceof Element
            ? event.target.closest<HTMLElement>('[role="dialog"]')
            : event.currentTarget;
        trapKeys(event, [dialog]);
      }}
    >
      <div className="dsh-qa-guide-dialog__panel">
        <h1 id="qa-guide-title" className="dsh-qa-guide-dialog__title">
          Как работать с агентом
        </h1>
        <div
          ref={content}
          className="dsh-qa-guide-dialog__content"
          role="region"
          aria-label="Текст памятки"
          tabIndex={0}
        >
          <GuideBody markdown={markdown} />
        </div>
        <div className="dsh-qa-guide-dialog__actions">
          {!accepted && (
            <label className="dsh-qa-guide-dialog__check">
              <input
                type="checkbox"
                data-testid="qa-guide-acknowledge"
                checked={checked}
                onChange={(event) => setChecked(event.currentTarget.checked)}
              />
              Ознакомился и все понял
            </label>
          )}
          <button
            type="button"
            className="dsh-qa-guide-dialog__continue"
            data-testid="qa-guide-action"
            disabled={!accepted && !checked}
            onClick={accepted ? onClose : accept}
          >
            {accepted ? "Закрыть" : "Продолжить"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
