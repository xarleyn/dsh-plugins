// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  QA_WELCOME_NOTICE_COPY,
  QA_WELCOME_NOTICE_VERSION,
  QaWelcomeNotice,
  QaWelcomeNoticeStep,
} from "../src/client/components/QaWelcomeNotice.js";

const STORAGE_KEY = "dsh-qa-surface.session:v1:/qa:welcome-notice";

function mount(complete = vi.fn()) {
  render(
    <QaWelcomeNotice
      complete={complete}
      storage={window.localStorage}
      storageKey={STORAGE_KEY}
    />,
  );
  return complete;
}

describe("QA welcome notice", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    window.localStorage.clear();
  });

  afterEach(() => cleanup());

  it("renders the QA-specific disclosure and acknowledges its exact version", () => {
    const complete = mount();
    const dialog = screen.getByRole("dialog", {
      name: QA_WELCOME_NOTICE_COPY.title,
    });
    expect(dialog).toBeTruthy();
    expect(document.getElementById("root")?.inert).toBe(true);
    for (const paragraph of QA_WELCOME_NOTICE_COPY.paragraphs) {
      expect(screen.getByText(paragraph)).toBeTruthy();
    }

    fireEvent.click(
      screen.getByRole("button", {
        name: QA_WELCOME_NOTICE_COPY.continueLabel,
      }),
    );

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      QA_WELCOME_NOTICE_VERSION,
    );
    expect(complete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.getElementById("root")?.inert).toBe(false);
  });

  it("completes without rendering after this browser acknowledged the copy", async () => {
    window.localStorage.setItem(STORAGE_KEY, QA_WELCOME_NOTICE_VERSION);
    const complete = mount();

    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
  });

  it("does not dismiss the mandatory disclosure on Escape or backdrop clicks", () => {
    const complete = mount();
    const backdrop = document.querySelector(
      ".dsh-qa-onboarding",
    ) as HTMLElement;

    fireEvent.keyDown(backdrop, { key: "Escape" });
    fireEvent.click(backdrop);

    expect(complete).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("stays visible when DSH stops seating onboarding after a question", () => {
    const complete = vi.fn();
    const view = render(
      <>
        <QaWelcomeNotice
          storage={window.localStorage}
          storageKey={STORAGE_KEY}
        />
        <QaWelcomeNoticeStep
          stepId="welcome-notice"
          complete={complete}
          openSection={vi.fn()}
          storage={window.localStorage}
          storageKey={STORAGE_KEY}
        />
      </>,
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    view.rerender(
      <QaWelcomeNotice
        storage={window.localStorage}
        storageKey={STORAGE_KEY}
      />,
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(complete).not.toHaveBeenCalled();
  });

  it("releases the shadowed DSH step only after explicit acknowledgement", async () => {
    const complete = vi.fn();
    render(
      <>
        <QaWelcomeNotice
          storage={window.localStorage}
          storageKey={STORAGE_KEY}
        />
        <QaWelcomeNoticeStep
          stepId="welcome-notice"
          complete={complete}
          openSection={vi.fn()}
          storage={window.localStorage}
          storageKey={STORAGE_KEY}
        />
      </>,
    );

    expect(complete).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", {
        name: QA_WELCOME_NOTICE_COPY.continueLabel,
      }),
    );

    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
  });
});
