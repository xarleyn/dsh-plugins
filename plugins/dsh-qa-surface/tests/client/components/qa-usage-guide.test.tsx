// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QaOnboarding } from "../../../src/client/components/QaUsageGuide.js";
import { QA_WELCOME_NOTICE_VERSION } from "../../../src/client/components/QaWelcomeNotice.js";

const namespace = "qa-guide-test";
const welcomeKey = `${namespace}:welcome-notice`;
const guideKey = `${namespace}:usage-guide`;

function guide(markdown: string) {
  return (
    <QaOnboarding
      storage={window.localStorage}
      namespace={namespace}
      markdown={markdown}
      opener={null}
      onClose={vi.fn()}
    />
  );
}
const checkbox = () =>
  screen.getByRole<HTMLInputElement>("checkbox", {
    name: "Ознакомился и все понял",
  });
const proceed = () =>
  screen.getByRole<HTMLButtonElement>("button", {
    name: "Продолжить",
  });

beforeEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = '<div id="root"></div>';
});
afterEach(cleanup);

it("requires separate acknowledgements, including after a mid-guide reload", () => {
  const markdown = "Проверьте **ссылку**.";
  const first = render(guide(markdown));
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(screen.queryByRole("checkbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Понятно, продолжить" }));
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(
    screen
      .getByRole("dialog", { name: "Как работать с агентом" })
      .querySelector("strong")?.textContent,
  ).toBe("ссылку");
  expect(document.getElementById("root")?.inert).toBe(true);
  fireEvent.click(checkbox());
  expect(window.localStorage.getItem(welcomeKey)).toBe(
    QA_WELCOME_NOTICE_VERSION,
  );
  expect(window.localStorage.getItem(guideKey)).toBeNull();
  first.unmount();
  const second = render(guide(markdown));
  expect(checkbox().checked).toBe(false);
  fireEvent.keyDown(checkbox(), { key: "Escape" });
  fireEvent.click(screen.getByRole("dialog"));
  expect(proceed().disabled).toBe(true);
  fireEvent.click(checkbox());
  fireEvent.click(checkbox());
  expect(proceed().disabled).toBe(true);
  fireEvent.click(checkbox());
  fireEvent.click(proceed());
  expect(window.localStorage.getItem(guideKey)).toBe(markdown);
  expect(document.getElementById("root")?.inert).toBe(false);
  second.unmount();
  render(guide(markdown));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("invalidates a checked or saved guide when the operator changes the text", () => {
  window.localStorage.setItem(welcomeKey, QA_WELCOME_NOTICE_VERSION);
  window.localStorage.setItem(guideKey, "Первая редакция");
  const view = render(guide("Первая редакция"));
  view.rerender(guide("Вторая редакция"));
  fireEvent.click(checkbox());
  view.rerender(guide("Третья редакция"));
  expect(screen.getByText("Третья редакция")).toBeTruthy();
  expect(checkbox().checked).toBe(false);
  expect(proceed().disabled).toBe(true);
  expect(window.localStorage.getItem(welcomeKey)).toBe(
    QA_WELCOME_NOTICE_VERSION,
  );
});

it("closes the reopened guide even when a Host tooltip captures Escape", () => {
  window.localStorage.setItem(welcomeKey, QA_WELCOME_NOTICE_VERSION);
  window.localStorage.setItem(guideKey, "Памятка");
  const close = vi.fn();
  render(
    <QaOnboarding
      namespace={namespace}
      storage={window.localStorage}
      markdown="Памятка"
      opener={document.createElement("button")}
      onClose={close}
    />,
  );
  const host = (event: KeyboardEvent) => event.stopPropagation();
  document.addEventListener("keydown", host, true);
  try {
    fireEvent.keyDown(screen.getByRole("button", { name: "Закрыть" }), {
      key: "Escape",
    });
    expect(close).toHaveBeenCalledOnce();
    expect(screen.queryByRole("checkbox")).toBeNull();
  } finally {
    document.removeEventListener("keydown", host, true);
  }
});
