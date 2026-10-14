// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  QaComposer,
  type QaComposerProps,
} from "../../../src/client/components/QaComposer.js";
import { QaModal } from "../../../src/client/components/QaModal.js";
import { DEFAULT_ATTACHMENT_LIMITS } from "../../helpers/attachments.js";
import {
  DEFAULT_SLASH_POLICY,
  DISABLED_SLASH_VIEW,
  readySlash,
  slashEntry,
} from "../../helpers/slash.js";
import { settle } from "../../helpers/act.js";

function props(overrides: Partial<QaComposerProps> = {}): QaComposerProps {
  return {
    placeholder: "Ask",
    attachments: [],
    limits: DEFAULT_ATTACHMENT_LIMITS,
    onAttachmentsChange: vi.fn(),
    canSend: true,
    canStop: true,
    running: false,
    showStop: true,
    status: null,
    slash: DISABLED_SLASH_VIEW,
    slashPolicy: DEFAULT_SLASH_POLICY,
    onSend: vi.fn(async () => true),
    onSlashOpen: vi.fn(),
    onStop: vi.fn(async () => undefined),
    ...overrides,
  };
}

function field(): HTMLTextAreaElement {
  return screen.getByLabelText("Задать вопрос");
}

function page(composer: QaComposerProps, credentialAutoFocus = false) {
  return (
    <>
      <input aria-label="Credential" autoFocus={credentialAutoFocus} />
      <input aria-label="Shared title" />
      <QaComposer {...composer} />
    </>
  );
}

function deferredSend() {
  let finish: (accepted: boolean) => void = () => undefined;
  const result = new Promise<boolean>((resolve) => {
    finish = resolve;
  });
  return { onSend: vi.fn(() => result), finish };
}

function startSend() {
  field().focus();
  fireEvent.change(field(), { target: { value: "A question" } });
  const button = screen.getByRole("button", { name: "Отправить" });
  button.focus();
  fireEvent.click(button);
}

describe("QA composer focus ownership", () => {
  it("focuses an idle composer when the page has no input owner", () => {
    render(page(props()));
    expect(document.activeElement).toBe(field());
  });

  it("keeps an existing credential input focused when the composer mounts", () => {
    render(page(props(), true));
    expect(document.activeElement).toBe(screen.getByLabelText("Credential"));
  });

  it.each(["Credential", "Shared title"])(
    "keeps %s focused when a running turn ends",
    (label) => {
      const composer = props({ running: true });
      const mounted = render(page(composer));
      const external = screen.getByLabelText(label);
      external.focus();
      mounted.rerender(page({ ...composer, running: false }));
      expect(document.activeElement).toBe(external);
    },
  );

  it("returns from the removed Stop control when a turn ends", () => {
    const composer = props({ running: true });
    const mounted = render(page(composer));
    screen.getByRole("button", { name: "Остановить" }).focus();
    mounted.rerender(page({ ...composer, running: false }));
    expect(document.activeElement).toBe(field());
  });

  it.each([
    [true, "Credential"],
    [false, "Credential"],
    [true, "Shared title"],
    [false, "Shared title"],
  ] as const)(
    "keeps external focus after a send resolves accepted=%s in %s",
    async (accepted, label) => {
      const send = deferredSend();
      render(page(props({ onSend: send.onSend })));
      startSend();
      const external = screen.getByLabelText(label);
      external.focus();
      await settle(() => send.finish(accepted));
      expect(document.activeElement).toBe(external);
      expect(field().value).toBe(accepted ? "" : "A question");
    },
  );

  it("returns from its own send control when no other field took focus", async () => {
    const send = deferredSend();
    render(page(props({ onSend: send.onSend })));
    startSend();
    await settle(() => send.finish(true));
    expect(document.activeElement).toBe(field());
    expect(field().value).toBe("");
  });

  it("does not move focus behind an open dialog during send completion", async () => {
    const send = deferredSend();
    const composer = props({ onSend: send.onSend });
    const close = vi.fn();
    const view = (open: boolean) => (
      <>
        <QaComposer {...composer} />
        <QaModal
          open={open}
          title="Share"
          closeLabel="Close share"
          onClose={close}
        >
          <input aria-label="Share recipient" />
        </QaModal>
      </>
    );
    const mounted = render(view(false));
    startSend();
    mounted.rerender(view(true));
    // A modal may temporarily have no active child while it replaces a form.
    screen.getByRole("button", { name: "Close share" }).blur();
    expect(document.activeElement).toBe(document.body);
    await settle(() => send.finish(true));
    expect(document.activeElement).toBe(document.body);
  });

  it("keeps the caret after a slash insertion while the composer owns focus", async () => {
    render(
      page(props({ slash: readySlash([slashEntry("skill", "inspect")]) })),
    );
    field().focus();
    fireEvent.change(field(), { target: { value: "/" } });
    fireEvent.keyDown(field(), { key: "Tab" });
    await settle();
    expect(field().value).toBe("/inspect ");
    expect(document.activeElement).toBe(field());
    expect(field().selectionStart).toBe("/inspect ".length);
    expect(field().selectionEnd).toBe("/inspect ".length);
  });

  it("does not reclaim an external field before the slash insertion microtask", async () => {
    render(
      page(props({ slash: readySlash([slashEntry("skill", "inspect")]) })),
    );
    field().focus();
    fireEvent.change(field(), { target: { value: "/" } });
    fireEvent.keyDown(field(), { key: "Tab" });
    const external = screen.getByLabelText("Credential");
    external.focus();
    await settle();
    expect(field().value).toBe("/inspect ");
    expect(document.activeElement).toBe(external);
  });
});
