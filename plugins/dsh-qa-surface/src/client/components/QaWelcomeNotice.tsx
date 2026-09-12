import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import type { SettingsOnboardingOwnerProps } from "@deepseek-ai/dsh-client-ui-settings/client";
import type { StorageLike } from "../types.js";

/** Bump when the notice changes materially and must be acknowledged again. */
export const QA_WELCOME_NOTICE_VERSION = "2026-09-12.1";

export const QA_WELCOME_NOTICE_COPY = Object.freeze({
  title: "Перед началом тестирования",
  paragraphs: Object.freeze([
    "Этот помощник разработан не с нуля: он основан на DeepSeek Harness. Платформа находится в preview, поэтому возможны ошибки, нестабильная работа и изменения поведения.",
    "На этапе тестирования заданные вопросы и полученные ответы будут анализироваться для повышения качества помощника. Пожалуйста, задавайте преимущественно вопросы, связанные с работой.",
    "Помощник использует локальные модели. Данные обрабатываются внутри контура и никуда за его пределы не передаются.",
  ]),
  continueLabel: "Понятно, продолжить",
});

export interface QaWelcomeNoticeFace {
  readonly storage: StorageLike;
  readonly storageKey: string;
}

export interface QaWelcomeNoticeProps extends QaWelcomeNoticeFace {
  readonly complete?: () => void;
}

export interface QaWelcomeNoticeStepProps
  extends SettingsOnboardingOwnerProps, QaWelcomeNoticeFace {}

const QA_WELCOME_ACKNOWLEDGED_EVENT = "dsh-qa-welcome-acknowledged";

function acknowledged(storage: StorageLike, key: string): boolean {
  try {
    return storage.getItem(key) === QA_WELCOME_NOTICE_VERSION;
  } catch {
    return false;
  }
}

function focusable(root: HTMLElement): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      "button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex='-1'])",
    ),
  ].filter((element) => !element.hidden);
}

/** Route-scoped replacement for DSH's stock `welcome-notice` onboarding step. */
export function QaWelcomeNotice(props: QaWelcomeNoticeProps) {
  const [isAcknowledged, setAcknowledged] = useState(() =>
    acknowledged(props.storage, props.storageKey),
  );
  const completed = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const continueButton = useRef<HTMLButtonElement>(null);

  const complete = useCallback(() => {
    if (completed.current) return;
    completed.current = true;
    props.complete?.();
  }, [props.complete]);

  useEffect(() => {
    if (isAcknowledged) complete();
  }, [complete, isAcknowledged]);

  useEffect(() => {
    if (isAcknowledged) return;
    const appRoot = document.getElementById("root");
    const wasInert = appRoot?.inert;
    if (appRoot !== null) appRoot.inert = true;
    continueButton.current?.focus();
    return () => {
      if (appRoot !== null) appRoot.inert = wasInert ?? false;
    };
  }, [isAcknowledged]);

  const confirm = useCallback(() => {
    try {
      props.storage.setItem(props.storageKey, QA_WELCOME_NOTICE_VERSION);
    } catch {
      // A denied localStorage write only costs persistence across reloads.
    }
    setAcknowledged(true);
    window.dispatchEvent(
      new CustomEvent(QA_WELCOME_ACKNOWLEDGED_EVENT, {
        detail: props.storageKey,
      }),
    );
    complete();
  }, [complete, props.storage, props.storageKey]);

  const trapKeys = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key !== "Tab" || dialog.current === null) return;
    const items = focusable(dialog.current);
    if (items.length === 0) {
      event.preventDefault();
      dialog.current.focus();
      return;
    }
    const first = items[0];
    const last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }, []);

  if (isAcknowledged) return null;

  return createPortal(
    <div className="dsh-qa-onboarding" onKeyDown={trapKeys}>
      <div
        ref={dialog}
        className="dsh-qa-onboarding__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dsh-qa-onboarding-title"
        aria-describedby="dsh-qa-onboarding-description"
        tabIndex={-1}
      >
        <div className="dsh-qa-onboarding__mark" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M12 3.5 20 8v8l-8 4.5L4 16V8l8-4.5Z" />
            <path d="m8.75 12 2 2 4.5-4.5" />
          </svg>
        </div>
        <div className="dsh-qa-onboarding__content">
          <h1 id="dsh-qa-onboarding-title" className="dsh-qa-onboarding__title">
            {QA_WELCOME_NOTICE_COPY.title}
          </h1>
          <div
            id="dsh-qa-onboarding-description"
            className="dsh-qa-onboarding__description"
          >
            {QA_WELCOME_NOTICE_COPY.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
          <div className="dsh-qa-onboarding__actions">
            <button
              ref={continueButton}
              type="button"
              className="dsh-qa-onboarding__continue"
              onClick={confirm}
            >
              {QA_WELCOME_NOTICE_COPY.continueLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Invisible shadow for DSH's stock welcome step. The host coordinator removes
 * onboarding content as soon as a chat stops being blank, so the visible QA
 * notice is owned by the route overlay above instead of this lifecycle.
 */
export function QaWelcomeNoticeStep(props: QaWelcomeNoticeStepProps) {
  const [isAcknowledged, setAcknowledged] = useState(() =>
    acknowledged(props.storage, props.storageKey),
  );
  const completed = useRef(false);

  useEffect(() => {
    const handleAcknowledged = (event: Event) => {
      if (event instanceof CustomEvent && event.detail === props.storageKey) {
        setAcknowledged(true);
      }
    };
    window.addEventListener(QA_WELCOME_ACKNOWLEDGED_EVENT, handleAcknowledged);
    return () =>
      window.removeEventListener(
        QA_WELCOME_ACKNOWLEDGED_EVENT,
        handleAcknowledged,
      );
  }, [props.storageKey]);

  useEffect(() => {
    if (!isAcknowledged || completed.current) return;
    completed.current = true;
    props.complete();
  }, [isAcknowledged, props.complete]);

  return null;
}
