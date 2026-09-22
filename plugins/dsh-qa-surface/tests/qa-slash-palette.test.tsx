// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QaComposer } from "../src/client/components/QaComposer.js";
import { DEFAULT_ATTACHMENT_LIMITS } from "./helpers/attachments.js";
import {
  DEFAULT_SLASH_POLICY,
  DISABLED_SLASH_VIEW,
  readySlash,
  slashEntry,
  slashView,
} from "./helpers/slash.js";

const SKILLS = [
  slashEntry("skill", "generate-tkp", { description: "Сформировать ТКП" }),
  slashEntry("skill", "generate-tz", { description: "Сформировать ТЗ" }),
  slashEntry("skill", "gap-analysis", {
    description: "Сопоставить требования",
  }),
];
const COMMAND = slashEntry("command", "compact", {
  description: "Compact conversation",
});

function mount(overrides: Partial<Parameters<typeof QaComposer>[0]> = {}): {
  onSend: ReturnType<typeof vi.fn>;
  onSlashOpen: ReturnType<typeof vi.fn>;
} {
  const onSend = vi.fn(async () => true);
  const onSlashOpen = vi.fn();
  render(
    <QaComposer
      placeholder="Ask"
      attachments={[]}
      limits={DEFAULT_ATTACHMENT_LIMITS}
      onAttachmentsChange={vi.fn()}
      canSend
      canStop={false}
      running={false}
      showStop
      status={null}
      slash={DISABLED_SLASH_VIEW}
      slashPolicy={DEFAULT_SLASH_POLICY}
      onSend={onSend}
      onSlashOpen={onSlashOpen}
      onStop={vi.fn()}
      {...overrides}
    />,
  );
  return { onSend, onSlashOpen };
}

const input = (): HTMLElement => screen.getByLabelText("Задать вопрос");

function type(text: string): void {
  fireEvent.change(input(), { target: { value: text } });
}

function optionNames(): string[] {
  return screen
    .getAllByRole("option")
    .map((node) => node.textContent ?? "")
    .map((text) => text.split("Навык")[0]?.split("Команда")[0]?.trim() ?? "");
}

describe("slash palette in the composer", () => {
  it("stays closed while the deployment runs with slashes off", () => {
    mount();
    type("/");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("opens on a bare slash and lists every entry", () => {
    const onSlashOpen = vi.fn();
    mount({ slash: readySlash([...SKILLS, COMMAND]), onSlashOpen });
    type("/");
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(screen.queryAllByRole("option")).toHaveLength(4);
    expect(screen.getByText("/generate-tkp")).toBeTruthy();
    // The caller is told, once, so it can revalidate a possibly stale catalog.
    expect(onSlashOpen).toHaveBeenCalledTimes(1);
  });

  it("filters as the name is typed and closes on the first space", () => {
    mount({ slash: readySlash([...SKILLS, COMMAND]) });
    type("/gene");
    expect(optionNames()).toEqual(["/generate-tkp", "/generate-tz"]);
    type("/generate-tkp Сделай ТКП");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("finds a name by its abbreviation", () => {
    mount({ slash: readySlash(SKILLS) });
    type("/tkp");
    expect(optionNames()).toEqual(["/generate-tkp"]);
  });

  it("draws one header per kind when the ranking interleaves them", () => {
    // Ranked by name, the two skills fall on either side of the command, so a
    // palette that grouped neighbouring rows would draw «Навыки» twice.
    mount({
      slash: readySlash([
        slashEntry("skill", "a-one"),
        slashEntry("command", "b-two"),
        slashEntry("skill", "c-three"),
      ]),
    });
    type("/");
    expect(screen.getAllByText("Навыки")).toHaveLength(1);
    expect(screen.getAllByText("Команды")).toHaveLength(1);
    // The group of the best-ranked row leads, and its rows keep their order.
    expect(optionNames()).toEqual(["/a-one", "/c-three", "/b-two"]);
  });

  it("walks the arrow keys down the rows it draws", () => {
    mount({
      slash: readySlash([
        slashEntry("skill", "a-one"),
        slashEntry("command", "b-two"),
        slashEntry("skill", "c-three"),
      ]),
    });
    type("/");
    const active = (): string =>
      screen
        .getAllByRole("option")
        .find((node) => node.getAttribute("aria-selected") === "true")
        ?.textContent ?? "";
    expect(active()).toContain("/a-one");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    // The next row on screen is the skill the grouping pulled up, not the
    // command the ranking had put in between.
    expect(active()).toContain("/c-three");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(active()).toContain("/b-two");
  });

  it("moves the selection with the arrow keys, wrapping at both ends", () => {
    mount({ slash: readySlash(SKILLS) });
    type("/");
    const active = (): string | null =>
      screen
        .getAllByRole("option")
        .find((node) => node.getAttribute("aria-selected") === "true")
        ?.textContent ?? null;
    // An empty query keeps catalog order, so the first row is the one whose
    // name sorts first.
    expect(active()).toContain("/gap-analysis");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(active()).toContain("/generate-tkp");
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(active()).toContain("/gap-analysis");
    // One more step up from the first row wraps to the last.
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(active()).toContain("/generate-tz");
  });

  it("inserts the invocation on Tab without sending it", async () => {
    const { onSend } = mount({ slash: readySlash(SKILLS) });
    type("/tkp");
    fireEvent.keyDown(input(), { key: "Tab" });
    expect((input() as HTMLTextAreaElement).value).toBe("/generate-tkp ");
    expect(screen.queryByRole("listbox")).toBeNull();
    await waitFor(() => expect(onSend).not.toHaveBeenCalled());
  });

  it("inserts on Enter rather than running the action", async () => {
    const { onSend } = mount({ slash: readySlash(SKILLS) });
    type("/tkp");
    fireEvent.keyDown(input(), { key: "Enter" });
    expect((input() as HTMLTextAreaElement).value).toBe("/generate-tkp ");
    await waitFor(() => expect(onSend).not.toHaveBeenCalled());
  });

  it("sends on the second Enter, carrying the pick identity", async () => {
    const { onSend } = mount({
      slash: readySlash([
        slashEntry("skill", "plan"),
        slashEntry("command", "plan"),
      ]),
    });
    type("/plan");
    fireEvent.keyDown(input(), { key: "Enter" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    // The palette is already closed after the pick, so the second Enter is the
    // submission and the pick survives inside the draft.
    fireEvent.change(input(), { target: { value: "/plan сделать" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith("/plan сделать", [], "skill:plan"),
    );
  });

  it("closes on Escape and leaves Enter to the ordinary path", async () => {
    const { onSend } = mount({ slash: readySlash(SKILLS) });
    type("/generate-tkp");
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith("/generate-tkp", [], null),
    );
  });

  it("re-opens on the surface's reopen token", () => {
    const { rerender } = render(
      <QaComposer
        placeholder="Ask"
        attachments={[]}
        limits={DEFAULT_ATTACHMENT_LIMITS}
        onAttachmentsChange={vi.fn()}
        canSend
        canStop={false}
        running={false}
        showStop
        status={null}
        slash={readySlash(SKILLS)}
        slashPolicy={DEFAULT_SLASH_POLICY}
        onSend={vi.fn(async () => true)}
        onSlashOpen={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    type("/plan");
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    rerender(
      <QaComposer
        placeholder="Ask"
        attachments={[]}
        limits={DEFAULT_ATTACHMENT_LIMITS}
        onAttachmentsChange={vi.fn()}
        canSend
        canStop={false}
        running={false}
        showStop
        status={null}
        slash={slashView({ ...readySlash(SKILLS), reopen: 1 })}
        slashPolicy={DEFAULT_SLASH_POLICY}
        onSend={vi.fn(async () => true)}
        onSlashOpen={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("picks with a click and keeps the focus in the field", () => {
    mount({ slash: readySlash(SKILLS) });
    type("/");
    input().focus();
    const option = screen.getByText("/gap-analysis").closest("[role='option']");
    expect(option).not.toBeNull();
    fireEvent.mouseDown(option as Element);
    fireEvent.click(option as Element);
    expect((input() as HTMLTextAreaElement).value).toBe("/gap-analysis ");
    expect(document.activeElement).toBe(input());
  });

  it("says why the palette is empty instead of showing nothing", () => {
    mount({
      slash: slashView({ enabled: true, state: "error", error: null }),
    });
    type("/");
    expect(screen.getByText("Не удалось загрузить команды")).toBeTruthy();
  });

  it("keeps an empty-chat quick question an ordinary prompt", async () => {
    const { onSend } = mount({
      slash: readySlash(SKILLS),
      quickQuestions: [{ label: "Быстро", prompt: "Быстрый вопрос" }],
    });
    fireEvent.click(screen.getByText("Быстро"));
    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith("Быстрый вопрос", [], null),
    );
  });
});
