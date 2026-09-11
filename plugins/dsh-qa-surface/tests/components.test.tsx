// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QaComposer } from "../src/client/components/QaComposer.js";
import type { QaImageDraft, QaSource, QaWorkItem } from "../src/types.js";
import { QaMessage, sameMessage } from "../src/client/components/QaMessage.js";
import { collectSubagents } from "../src/client/components/QaAgentsDrawer.js";
import { collectVariantGroups } from "../src/client/components/VariantSwitcher.js";
import { formatWorkDuration } from "../src/client/components/format.js";
import {
  QaWorkGroup,
  sameWorkItem,
  sameWorkItems,
} from "../src/client/components/QaWorkGroup.js";
import { Markdown } from "../src/client/components/Markdown.js";
import { QaSourcesDrawer } from "../src/client/components/QaSourcesDrawer.js";
import {
  QA_CHANGELOG,
  QA_VERSION,
} from "../src/client/components/QaChangelog.js";
import { resolveConfig } from "../src/resolve-config.js";
import {
  buildChatRows,
  QaSidebar,
  sameChatRows,
} from "../src/client/components/QaSidebar.js";
import type { SessionSummary } from "@deepseek-ai/dsh-api-session-controller/client";
import {
  QaWidthHandle,
  readQaContentWidth,
  resolveQaContentWidth,
  writeQaContentWidth,
} from "../src/client/components/QaWidthHandle.js";
import { useSyncExternalStore } from "react";
import { QaAuthGate } from "../src/client/components/QaAuthGate.js";
import { QaAccountsController } from "../src/client/QaAccountsController.js";
import type { QaAccountsApi } from "../src/client/types.js";

describe("QA content width", () => {
  it("uses the DSH adaptive width and clamps persisted preferences", () => {
    expect(resolveQaContentWidth(1_000, null, 900)).toBe(680);
    expect(resolveQaContentWidth(1_440, null, 900)).toBe(900);
    expect(resolveQaContentWidth(1_000, 400, 900)).toBe(640);
    expect(resolveQaContentWidth(1_000, 400, 600)).toBe(600);
    expect(resolveQaContentWidth(1_000, 1_200, 900)).toBe(824);
  });

  it("tolerates unavailable or corrupt durable storage", () => {
    expect(
      readQaContentWidth({ getItem: () => "not-a-number" }, "width"),
    ).toBeNull();
    expect(
      readQaContentWidth(
        {
          getItem: () => {
            throw new Error("denied");
          },
        },
        "width",
      ),
    ).toBeNull();
    expect(() =>
      writeQaContentWidth(
        {
          setItem: () => {
            throw new Error("denied");
          },
        },
        "width",
        720,
      ),
    ).not.toThrow();
  });

  it("renders the same two-sided resize affordance as DSH", () => {
    const handlers = {
      onStart: vi.fn(() => 680),
      onDrag: vi.fn(),
      onCommit: vi.fn(),
      onEnd: vi.fn(),
    };
    const { container } = render(
      <>
        <QaWidthHandle side="left" {...handlers} />
        <QaWidthHandle side="right" {...handlers} />
      </>,
    );
    expect(container.querySelector('[data-width-handle="left"]')).toBeTruthy();
    expect(container.querySelector('[data-width-handle="right"]')).toBeTruthy();
  });

  it("resizes symmetrically and commits the final width", () => {
    let captured = false;
    let animationFrame: FrameRequestCallback | undefined;
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        animationFrame = callback;
        return 1;
      });
    const cancelFrame = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);
    const handlers = {
      onStart: vi.fn(() => 680),
      onDrag: vi.fn(),
      onCommit: vi.fn(),
      onEnd: vi.fn(),
    };
    const { container } = render(<QaWidthHandle side="right" {...handlers} />);
    const handle = container.querySelector<HTMLElement>(
      '[data-width-handle="right"]',
    );
    expect(handle).not.toBeNull();
    Object.defineProperties(handle, {
      setPointerCapture: {
        value: vi.fn(() => {
          captured = true;
        }),
      },
      hasPointerCapture: { value: vi.fn(() => captured) },
      releasePointerCapture: {
        value: vi.fn(() => {
          captured = false;
        }),
      },
      getBoundingClientRect: {
        value: vi.fn(() => ({ top: 10 })),
      },
    });

    const pointerEvent = (
      type: string,
      clientX: number,
      clientY = 0,
    ): Event => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        pointerId: { value: 7 },
        clientX: { value: clientX },
        clientY: { value: clientY },
      });
      return event;
    };

    fireEvent(handle!, pointerEvent("pointerdown", 100));
    fireEvent(handle!, pointerEvent("pointermove", 120, 90));
    animationFrame?.(0);
    expect(handlers.onDrag).toHaveBeenCalledWith(720);
    expect(
      handle?.style.getPropertyValue("--dsh-qa-width-handle-pointer-y"),
    ).toBe("80px");

    fireEvent(handle!, pointerEvent("pointerup", 130));
    expect(handlers.onCommit).toHaveBeenCalledWith(740);
    expect(handlers.onEnd).toHaveBeenCalledOnce();
    requestFrame.mockRestore();
    cancelFrame.mockRestore();
  });
});

describe("QA composer", () => {
  it("sends on Enter and preserves Shift+Enter", async () => {
    const send = vi.fn(async () => true);
    render(
      <QaComposer
        placeholder="Ask"
        images={[]}
        onImagesChange={vi.fn()}
        canSend
        canStop={false}
        running={false}
        showStop
        status={null}
        onSend={send}
        onStop={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("Задать вопрос");
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(send).toHaveBeenCalledWith("hello", []);
  });

  it("shows a real Stop button during generation", () => {
    render(
      <QaComposer
        placeholder="Ask"
        images={[]}
        onImagesChange={vi.fn()}
        canSend={false}
        canStop
        running
        showStop
        status="Скребу по сусекам…"
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(
      (screen.getByRole("button", { name: "Остановить" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(screen.queryByRole("button", { name: "Отправить" })).toBeNull();
  });

  it("renders the running status inside the composer", () => {
    render(
      <QaComposer
        placeholder="Ask"
        images={[]}
        onImagesChange={vi.fn()}
        canSend={false}
        canStop
        running
        showStop
        status="Скребу по сусекам…"
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(screen.getByText("Скребу по сусекам…")).toBeTruthy();
  });

  it("sends a quick question from the empty-chat shortcuts", async () => {
    const send = vi.fn(async () => true);
    render(
      <QaComposer
        placeholder="Спросите"
        images={[]}
        onImagesChange={vi.fn()}
        quickQuestions={["Что ты умеешь?", "С чего начать?"]}
        canSend
        canStop={false}
        running={false}
        showStop
        status={null}
        onSend={send}
        onStop={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Что ты умеешь?" }));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith("Что ты умеешь?", []),
    );
  });
});

describe("QA message", () => {
  it("copies visible assistant text from the icon action", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <QaMessage
        message={{
          id: "assistant:1",
          role: "assistant",
          text: "Useful answer",
          status: "committed",
        }}
        renderMarkdown
        showTimestamp={false}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Скопировать сообщение" }),
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("Useful answer"),
    );
    expect(screen.getByRole("button", { name: "Скопировано" })).toBeTruthy();
  });

  it("reveals date, duration, TTFT and token speed for assistant answers", () => {
    render(
      <QaMessage
        message={{
          id: "assistant:1",
          role: "assistant",
          text: "Answer",
          status: "committed",
          timestamp: new Date(2026, 8, 9, 15, 44).getTime(),
          stats: { durationMs: 8_000, ttftMs: 1_100, tokensPerSecond: 89 },
        }}
        renderMarkdown={false}
        showTimestamp={false}
      />,
    );
    const meta = document.querySelector(".dsh-qa-message__meta");
    expect(meta?.textContent).toContain("9 сент 15:44");
    expect(meta?.textContent).toContain("8 с");
    expect(meta?.textContent).toContain("TTFT 1,1 с");
    expect(meta?.textContent).toContain("89 ток/с");
    expect(
      document.querySelector(".dsh-qa-message__actions[data-persistent]"),
    ).toBeNull();
  });

  it("opens the exact canonical source snapshot from the answer footer", () => {
    const onOpenSources = vi.fn();
    const sources: readonly QaSource[] = [
      {
        id: "web:https://example.com/docs",
        kind: "web",
        title: "Documentation",
        uri: "https://example.com/docs",
        locations: [],
        evidence: "fetched",
        origins: [{ sessionId: "s1", turn: 1, role: "parent" }],
        score: 100,
      },
    ];
    render(
      <QaMessage
        message={{
          id: "assistant:source",
          role: "assistant",
          text: "Answer with evidence",
          status: "committed",
          turn: 1,
          sources,
        }}
        renderMarkdown={false}
        showTimestamp={false}
        onOpenSources={onOpenSources}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Источники · 1" }));
    expect(onOpenSources).toHaveBeenCalledWith(sources, true, undefined);
  });

  it("keeps the metadata row persistent when timestamps are enabled", () => {
    render(
      <QaMessage
        message={{
          id: "assistant:1",
          role: "assistant",
          text: "Answer",
          status: "committed",
          timestamp: 1_000,
          stats: { durationMs: 500, ttftMs: null, tokensPerSecond: null },
        }}
        renderMarkdown={false}
        showTimestamp
      />,
    );
    expect(
      document.querySelector(".dsh-qa-message__actions[data-persistent]"),
    ).not.toBeNull();
    expect(
      document.querySelector(".dsh-qa-message__meta")?.textContent,
    ).not.toContain("TTFT");
  });

  it("shows the date on the user message", () => {
    render(
      <QaMessage
        message={{
          id: "user:1",
          role: "user",
          text: "Вопрос",
          status: "committed",
          timestamp: new Date(2026, 8, 9, 15, 50).getTime(),
        }}
        renderMarkdown={false}
        showTimestamp={false}
      />,
    );
    expect(
      document.querySelector(".dsh-qa-message__meta")?.textContent,
    ).toContain("9 сент 15:50");
    expect(screen.queryByRole("button", { name: "Нравится" })).toBeNull();
  });

  it("attaches images from files and removes them before send", async () => {
    const png = new File([new Uint8Array([137, 80, 78, 71])], "shot.png", {
      type: "image/png",
    });
    const onImagesChange = vi.fn();
    const view = render(
      <QaComposer
        placeholder="Ask"
        images={[]}
        onImagesChange={onImagesChange}
        canSend
        canStop={false}
        running={false}
        showStop
        status={null}
        onSend={vi.fn(async () => true)}
        onStop={vi.fn()}
      />,
    );
    const input = document.querySelector(
      "input[type='file']",
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [png] });
    fireEvent.change(input);
    await waitFor(() => expect(onImagesChange).toHaveBeenCalled());
    const firstCall = onImagesChange.mock.calls[0] as unknown as [
      readonly QaImageDraft[],
    ];
    const drafts = firstCall[0];
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.mediaType).toBe("image/png");

    // With a draft attached, sending clears both text and images.
    const onSend = vi.fn(async () => true);
    view.rerender(
      <QaComposer
        placeholder="Ask"
        images={drafts}
        onImagesChange={onImagesChange}
        canSend
        canStop={false}
        running={false}
        showStop
        status={null}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );
    const input2 = screen.getByLabelText("Задать вопрос");
    fireEvent.change(input2, { target: { value: "Смотри" } });
    fireEvent.keyDown(input2, { key: "Enter" });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("Смотри", drafts));
    expect(onImagesChange).toHaveBeenCalledWith([]);
  });

  it("rejects non-image files with a readable message", async () => {
    const onImagesChange = vi.fn();
    render(
      <QaComposer
        placeholder="Ask"
        images={[]}
        onImagesChange={onImagesChange}
        canSend
        canStop={false}
        running={false}
        showStop
        status={null}
        onSend={vi.fn(async () => true)}
        onStop={vi.fn()}
      />,
    );
    const txt = new File(["hello"], "note.txt", { type: "text/plain" });
    const input = document.querySelector(
      "input[type='file']",
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [txt] });
    fireEvent.change(input);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("PNG"),
    );
    expect(onImagesChange).not.toHaveBeenCalled();
  });

  it("exposes the regenerate action on demand", () => {
    const onRegenerate = vi.fn();
    const view = render(
      <QaMessage
        message={{
          id: "assistant:2",
          role: "assistant",
          text: "Answer",
          status: "committed",
        }}
        renderMarkdown={false}
        showTimestamp={false}
        onRegenerate={onRegenerate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Перегенерировать" }));
    expect(onRegenerate).toHaveBeenCalledOnce();
    view.rerender(
      <QaMessage
        message={{
          id: "assistant:2",
          role: "assistant",
          text: "Answer",
          status: "committed",
        }}
        renderMarkdown={false}
        showTimestamp={false}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Перегенерировать" }),
    ).toBeNull();
  });

  it("rates answers with mutually exclusive, persisted like and dislike", () => {
    window.localStorage.clear();
    // The surface scopes the ratings prefix to the chat: message ids repeat
    // across chats, so the key below is what QaSurface hands to QaMessage.
    const stateKey = "dsh-qa-surface.session:v1:/qa:chat:session-a";
    const view = render(
      <QaMessage
        message={{
          id: "assistant:7",
          role: "assistant",
          text: "Answer",
          status: "committed",
        }}
        renderMarkdown={false}
        showTimestamp={false}
        stateKey={stateKey}
      />,
    );
    const like = screen.getByRole("button", {
      name: "Нравится",
    }) as HTMLButtonElement;
    const dislike = screen.getByRole("button", {
      name: "Не нравится",
    }) as HTMLButtonElement;
    expect(like.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(like);
    expect(like.getAttribute("aria-pressed")).toBe("true");
    expect(
      JSON.parse(window.localStorage.getItem(`${stateKey}:ratings`) ?? "{}"),
    ).toEqual({ "assistant:7": "up" });
    fireEvent.click(dislike);
    expect(dislike.getAttribute("aria-pressed")).toBe("true");
    expect(like.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(dislike);
    expect(dislike.getAttribute("aria-pressed")).toBe("false");
    expect(window.localStorage.getItem(`${stateKey}:ratings`)).toBe("{}");
    view.unmount();
    render(
      <QaMessage
        message={{
          id: "assistant:7",
          role: "assistant",
          text: "Answer",
          status: "committed",
        }}
        renderMarkdown={false}
        showTimestamp={false}
        stateKey={stateKey}
      />,
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Нравится",
        }) as HTMLButtonElement
      ).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("keeps equal message ids of different chats rated independently", () => {
    window.localStorage.clear();
    const chatA = "dsh-qa-surface.session:v1:/qa:chat:session-a";
    const chatB = "dsh-qa-surface.session:v1:/qa:chat:session-b";
    const message = {
      id: "assistant:3",
      role: "assistant" as const,
      text: "Answer",
      status: "committed" as const,
    };
    const base = { message, renderMarkdown: false, showTimestamp: false };
    const first = render(<QaMessage {...base} stateKey={chatA} />);
    fireEvent.click(screen.getByRole("button", { name: "Нравится" }));
    first.unmount();
    const second = render(<QaMessage {...base} stateKey={chatB} />);
    expect(
      (
        screen.getByRole("button", {
          name: "Нравится",
        }) as HTMLButtonElement
      ).getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      JSON.parse(window.localStorage.getItem(`${chatA}:ratings`) ?? "{}"),
    ).toEqual({ "assistant:3": "up" });
    expect(window.localStorage.getItem(`${chatB}:ratings`)).toBeNull();
    second.unmount();
  });
});

describe("sources drawer", () => {
  const fileSource: QaSource = {
    id: "file:docs/guide.md",
    kind: "file",
    title: "guide.md",
    path: "docs/guide.md",
    locations: [{ path: "docs/guide.md", lineStart: 2, lineEnd: 3 }],
    evidence: "inherited",
    origins: [
      {
        sessionId: "child",
        turn: 1,
        role: "subagent",
        subagentRunId: "run-1",
      },
    ],
    score: 100,
  };

  it("groups unique sources and exposes incomplete provenance", () => {
    const config = resolveConfig().sources;
    render(
      <QaSourcesDrawer
        sources={[
          fileSource,
          {
            id: "web:https://example.com",
            kind: "web",
            title: "Example",
            uri: "https://example.com",
            locations: [],
            evidence: "fetched",
            origins: [{ sessionId: "root", turn: 1, role: "parent" }],
            score: 100,
          },
        ]}
        complete={false}
        incompleteOrigins={[{ subagentRunId: "opaque-1", reason: "opaque" }]}
        sessionId="root"
        sourceApi={
          {
            sources: vi.fn(),
            readSourceFile: vi.fn(),
          } as never
        }
        display={config.display}
        filePreview={config.filePreview}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Документы")).toBeTruthy();
    expect(screen.getByText("Web")).toBeTruthy();
    expect(screen.getByText(/делегированных запусков/u)).toBeTruthy();
  });

  it("opens Markdown rendered, toggles to raw and highlights referenced lines", async () => {
    const config = resolveConfig({
      sources: { display: { showOriginBadges: true } },
    }).sources;
    const readSourceFile = vi.fn(async () => ({
      ok: true as const,
      value: {
        path: "docs/guide.md",
        content:
          "# Guide\nReferenced text\nMore text\n<script>alert(1)</script>",
        size: 70,
        truncated: false,
        markdown: true,
        renderableMarkdown: true,
      },
    }));
    render(
      <QaSourcesDrawer
        sources={[fileSource]}
        complete
        sessionId="root"
        sourceApi={{ sources: vi.fn(), readSourceFile }}
        display={config.display}
        filePreview={config.filePreview}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /guide\.md/u }));
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Rendered" })
          .getAttribute("aria-pressed"),
      ).toBe("true"),
    );
    expect(screen.getByRole("heading", { name: "Guide" })).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Raw" }));
    expect(
      document.querySelectorAll(".dsh-qa-preview__line--highlight"),
    ).toHaveLength(2);
    expect(readSourceFile).toHaveBeenCalledWith("root", "docs/guide.md");
  });
});

describe("QA work group", () => {
  it("starts collapsed for completed work and exposes all details together", () => {
    render(
      <QaWorkGroup
        status="complete"
        startedAt={1_000}
        endedAt={101_000}
        renderMarkdown
        items={[
          {
            id: "reasoning:1",
            kind: "reasoning",
            text: "Inspect the repository first.",
            status: "complete",
          },
          {
            id: "tool:1",
            kind: "tool",
            name: "bash",
            label: "Bash",
            summary: "Find TODOs",
            input: '{\n  "command": "rg TODO"\n}',
            output: "src/a.ts: TODO",
            status: "ok",
          },
        ]}
      />,
    );

    const toggle = screen.getByRole("button", {
      name: "Готово за 1 мин 40 с",
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Inspect the repository first.")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Inspect the repository first.")).toBeTruthy();
    expect(screen.getByText("Find TODOs")).toBeTruthy();
  });

  it("collapses automatically when a running turn completes", async () => {
    const startedAt = Date.now() - 5_000;
    const view = render(
      <QaWorkGroup
        status="running"
        startedAt={startedAt}
        renderMarkdown={false}
        items={[
          {
            id: "reasoning:live",
            kind: "reasoning",
            text: "Still thinking",
            status: "running",
          },
        ]}
      />,
    );
    const running = screen.getByRole("button", {
      name: /Скребу по сусекам|Кумекаю|Навожу резкость|Собираю мысли|Раскладываю|Сверяю/u,
    });
    expect(running.getAttribute("aria-expanded")).toBe("true");

    view.rerender(
      <QaWorkGroup
        status="complete"
        startedAt={startedAt}
        endedAt={startedAt + 5_000}
        renderMarkdown={false}
        items={[
          {
            id: "reasoning:live",
            kind: "reasoning",
            text: "Still thinking",
            status: "complete",
          },
        ]}
      />,
    );

    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Готово за 5 с" })
          .getAttribute("aria-expanded"),
      ).toBe("false"),
    );
  });

  it("formats short and minute-scale durations", () => {
    expect(formatWorkDuration(100)).toBe("< 1 с");
    expect(formatWorkDuration(17_000)).toBe("17 с");
    expect(formatWorkDuration(1_060_000)).toBe("17 мин 40 с");
  });
});

describe("subagent panel", () => {
  const byId = {
    parent: {
      id: "parent",
      displayTitle: "Chat",
      running: false,
      blank: false,
      updatedAt: 1_000,
    },
    childRunning: {
      id: "child-running",
      displayTitle: "Count words in README.md",
      running: true,
      blank: false,
      updatedAt: 3_000,
      parentId: "parent",
      origin: "subagent",
    },
    childDone: {
      id: "child-done",
      displayTitle: "Print a greeting",
      running: false,
      blank: false,
      updatedAt: 2_000,
      parentId: "parent",
      origin: "subagent",
      completed: true,
    },
    stranger: {
      id: "stranger",
      displayTitle: "Unrelated chat",
      running: false,
      blank: false,
      updatedAt: 4_000,
    },
    grandchild: {
      id: "grandchild",
      displayTitle: "Nested",
      running: false,
      blank: false,
      updatedAt: 5_000,
      parentId: "child-running",
      origin: "subagent",
    },
  } as unknown as Record<string, SessionSummary>;

  it("lists direct subagent children running first", () => {
    const rows = collectSubagents(byId, "parent", 90_000);
    expect(rows.map((row) => row.id)).toEqual(["child-running", "child-done"]);
    expect(rows[0]).toMatchObject({
      title: "Count words in README.md",
      running: true,
      meta: "1 мин",
    });
    expect(rows[1]).toMatchObject({ completed: true });
  });

  it("follows the viewed subagent and ignores unrelated sessions", () => {
    expect(collectSubagents(byId, null, 90_000)).toEqual([]);
    expect(
      collectSubagents(byId, "child-running", 90_000).map((row) => row.id),
    ).toEqual(["grandchild"]);
    expect(collectSubagents(byId, "stranger", 90_000)).toEqual([]);
  });
});

describe("variant grouping", () => {
  it("groups consecutive answer turns under their user message", () => {
    const messages = [
      { id: "user:1", role: "user", text: "Q", status: "committed" },
      {
        id: "assistant:1",
        role: "assistant",
        text: "A1",
        status: "committed",
        turn: 1,
      },
      {
        id: "assistant:2",
        role: "assistant",
        text: "A2",
        status: "committed",
        turn: 2,
      },
      { id: "user:2", role: "user", text: "Q2", status: "committed" },
      {
        id: "assistant:3",
        role: "assistant",
        text: "A3",
        status: "committed",
        turn: 3,
      },
    ] as Parameters<typeof collectVariantGroups>[0];
    const groups = collectVariantGroups(messages);
    expect(groups).toEqual([
      { groupId: "user:1", turns: [1, 2] },
      { groupId: "user:2", turns: [3] },
    ]);
  });

  it("ignores answers that precede any user message", () => {
    const groups = collectVariantGroups([
      {
        id: "assistant:0",
        role: "assistant",
        text: "Boot",
        status: "committed",
        turn: 0,
      },
    ] as Parameters<typeof collectVariantGroups>[0]);
    expect(groups).toEqual([]);
  });
});

describe("safe Markdown", () => {
  it("renders formatting without interpreting HTML or unsafe links", () => {
    const { container } = render(
      <Markdown
        text={"**bold** <script>alert(1)</script> [bad](javascript:alert(1))"}
      />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("renders GFM tables with alignment and inline formatting", () => {
    const { container } = render(
      <Markdown
        text={
          "before\n\n| Name | Uses |\n| :--- | ---: |\n| **glob** | find `*.ts` |\n| grep | regex |\n\nafter"
        }
      />,
    );
    const table = container.querySelector(".dsh-qa-md-table table");
    expect(table).toBeTruthy();
    expect(container.querySelectorAll("thead th").length).toBe(2);
    expect(container.querySelectorAll("tbody tr").length).toBe(2);
    expect(container.querySelector("thead th")?.getAttribute("style")).toBe(
      "text-align: left;",
    );
    expect(
      container.querySelectorAll("thead th")[1]?.getAttribute("style"),
    ).toBe("text-align: right;");
    expect(container.querySelector("tbody strong")?.textContent).toBe("glob");
    expect(container.querySelector("tbody code")?.textContent).toBe("*.ts");
    const before = container.textContent ?? "";
    expect(before.indexOf("before")).toBeLessThan(before.indexOf("Name"));
    expect(before.indexOf("regex")).toBeLessThan(before.indexOf("after"));
  });

  it("renders ordered lists and horizontal rules", () => {
    const { container } = render(
      <Markdown text={"1. first step\n2. second step\n\n---\n\ndone"} />,
    );
    expect(container.querySelectorAll("ol li").length).toBe(2);
    expect(container.querySelector("ol li")?.textContent).toBe("first step");
    expect(container.querySelector("hr")).toBeTruthy();
    expect(container.textContent).toContain("done");
  });

  it("does not turn a single pipe sentence into a table", () => {
    const { container } = render(<Markdown text={"a | b sentence"} />);
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector("p")?.textContent).toBe("a | b sentence");
  });
});

describe("QA sidebar", () => {
  const byId = {
    "s-1": {
      id: "s-1",
      displayTitle: "How do I reset the cache?",
      running: false,
      blank: false,
      updatedAt: 1_000,
    },
    "s-2": {
      id: "s-2",
      displayTitle: "s-2",
      running: true,
      blank: true,
      updatedAt: 2_000,
    },
  } as unknown as Record<string, SessionSummary>;

  it("projects indexed ids onto the host session list, newest update first", () => {
    const rows = buildChatRows(["s-1", "s-2", "gone"], byId, "s-1", 90_000);
    expect(rows).toEqual([
      {
        id: "s-2",
        title: "Новый чат",
        running: true,
        active: false,
        meta: "1 мин",
        updatedAt: 2_000,
      },
      {
        id: "s-1",
        title: "How do I reset the cache?",
        running: false,
        active: true,
        meta: "1 мин",
        updatedAt: 1_000,
      },
    ]);
  });

  it("renders rows with the active mark and a new-chat control", () => {
    const onSwitch = vi.fn();
    const rows = buildChatRows(["s-2", "s-1"], byId, "s-2", 90_000);
    render(
      <QaSidebar
        rows={rows}
        title="DeepSeek QA"
        logoUrl={null}
        stateKey="dsh-qa-surface.session:v1:/qa"
        showNewChat
        busy={false}
        onSwitch={onSwitch}
        onNewChat={vi.fn()}
      />,
    );
    const items = document.querySelectorAll(".dsh-qa-sidebar__item");
    expect(items.length).toBe(2);
    const active = document.querySelector(
      ".dsh-qa-sidebar__item--active .dsh-qa-sidebar__item-main",
    );
    expect(active?.getAttribute("aria-current")).toBe("true");
    expect(active?.textContent).toContain("Новый чат");
    expect(document.querySelector(".dsh-qa-sidebar__dot")).toBeTruthy();
    fireEvent.click(
      document.querySelector(".dsh-qa-sidebar__new") as HTMLElement,
    );
    fireEvent.click(
      (items[1] as HTMLElement).querySelector(
        ".dsh-qa-sidebar__item-main",
      ) as HTMLElement,
    );
    expect(onSwitch).toHaveBeenCalledWith("s-1");
  });

  it("shows the brand head and filters rows through the search field", () => {
    const rows = buildChatRows(["s-2", "s-1"], byId, null, 90_000);
    render(
      <QaSidebar
        rows={rows}
        title="DeepSeek QA"
        logoUrl={null}
        stateKey="dsh-qa-surface.session:v1:/qa"
        showNewChat={false}
        busy={false}
        onSwitch={vi.fn()}
        onNewChat={vi.fn()}
      />,
    );
    expect(screen.getByText("DeepSeek QA")).toBeTruthy();
    const search = screen.getByLabelText("Поиск по чатам") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "cache" } });
    const items = document.querySelectorAll(".dsh-qa-sidebar__item");
    expect(items.length).toBe(1);
    expect(items[0]?.textContent).toContain("How do I reset the cache?");
    fireEvent.change(search, { target: { value: "нет такого" } });
    expect(screen.getByText("Ничего не найдено")).toBeTruthy();
    fireEvent.change(search, { target: { value: "  " } });
    expect(document.querySelectorAll(".dsh-qa-sidebar__item").length).toBe(2);
  });

  it("collapses to a rail and expands again, remembering the state", () => {
    window.localStorage.clear();
    const rows = buildChatRows(["s-1"], byId, null, 90_000);
    const view = render(
      <QaSidebar
        rows={rows}
        title="DeepSeek QA"
        logoUrl={null}
        stateKey="dsh-qa-surface.session:v1:/qa"
        showNewChat
        busy={false}
        onSwitch={vi.fn()}
        onNewChat={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Свернуть историю чатов" }),
    );
    expect(document.querySelector(".dsh-qa-sidebar--collapsed")).toBeTruthy();
    expect(
      window.localStorage.getItem(
        "dsh-qa-surface.session:v1:/qa:sidebar-collapsed",
      ),
    ).toBe("1");
    fireEvent.click(
      screen.getByRole("button", { name: "Развернуть историю чатов" }),
    );
    expect(
      view.container.querySelector(".dsh-qa-sidebar--collapsed"),
    ).toBeNull();
    expect(
      window.localStorage.getItem(
        "dsh-qa-surface.session:v1:/qa:sidebar-collapsed",
      ),
    ).toBe("0");
  });

  it("renders the empty state without a new-chat control", () => {
    render(
      <QaSidebar
        rows={[]}
        title="DeepSeek QA"
        logoUrl={null}
        stateKey="dsh-qa-surface.session:v1:/qa"
        showNewChat={false}
        busy={false}
        onSwitch={vi.fn()}
        onNewChat={vi.fn()}
      />,
    );
    expect(screen.getByText("Здесь пока пусто")).toBeTruthy();
    expect(screen.getByText("DeepSeek QA")).toBeTruthy();
  });
});

it("deletes a chat after a second confirming click", () => {
  const onDelete = vi.fn();
  const rows = [
    {
      id: "s-1",
      title: "Chat",
      running: false,
      active: false,
      meta: "1m",
      updatedAt: 1,
    },
  ];
  const { container } = render(
    <QaSidebar
      rows={rows}
      title="DeepSeek QA"
      logoUrl={null}
      stateKey="dsh-qa-surface.session:v1:/qa"
      showNewChat={false}
      busy={false}
      onSwitch={vi.fn()}
      onNewChat={vi.fn()}
      onDelete={onDelete}
    />,
  );
  const del = container.querySelector(
    ".dsh-qa-sidebar__item-delete",
  ) as HTMLElement;
  expect(del.getAttribute("aria-label")).toBe("Удалить чат");
  fireEvent.click(del);
  expect(onDelete).not.toHaveBeenCalled();
  expect(del.getAttribute("aria-label")).toBe("Подтвердить удаление чата");
  fireEvent.click(del);
  expect(onDelete).toHaveBeenCalledWith("s-1");
});

it("hides the delete control when the deployment omits it", () => {
  const rows = [
    {
      id: "s-1",
      title: "Chat",
      running: false,
      active: false,
      meta: "1m",
      updatedAt: 1,
    },
  ];
  const { container } = render(
    <QaSidebar
      rows={rows}
      title="DeepSeek QA"
      logoUrl={null}
      stateKey="dsh-qa-surface.session:v1:/qa"
      showNewChat={false}
      busy={false}
      onSwitch={vi.fn()}
      onNewChat={vi.fn()}
    />,
  );
  expect(container.querySelector(".dsh-qa-sidebar__item-delete")).toBeNull();
});

describe("sidebar version and changelog", () => {
  it("opens the changelog dialog from the footer version button", () => {
    const { container } = render(
      <QaSidebar
        rows={[]}
        title="DeepSeek QA"
        logoUrl={null}
        stateKey="dsh-qa-surface.session:v1:/qa"
        showNewChat={false}
        busy={false}
        onSwitch={vi.fn()}
        onNewChat={vi.fn()}
      />,
    );
    expect(container.querySelector(".dsh-qa-changelog")).toBeNull();
    const version = screen.getByRole("button", { name: /Версия / });
    expect(version.textContent).toBe(`Версия ${QA_VERSION}`);
    fireEvent.click(version);
    const dialog = document.querySelector(".dsh-qa-changelog") as HTMLElement;
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByText("История версий")).toBeTruthy();
    expect(document.querySelectorAll(".dsh-qa-changelog__entry").length).toBe(
      QA_CHANGELOG.length,
    );
    expect(document.querySelectorAll(".dsh-qa-changelog__current").length).toBe(
      1,
    );
    fireEvent.click(screen.getByLabelText("Закрыть историю версий"));
    expect(document.querySelector(".dsh-qa-changelog")).toBeNull();
  });

  it("closes the changelog dialog on Escape and backdrop clicks", () => {
    render(
      <QaSidebar
        rows={[]}
        title="DeepSeek QA"
        logoUrl={null}
        stateKey="dsh-qa-surface.session:v1:/qa"
        showNewChat={false}
        busy={false}
        onSwitch={vi.fn()}
        onNewChat={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Версия / }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.querySelector(".dsh-qa-changelog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Версия / }));
    fireEvent.click(document.querySelector(".dsh-qa-changelog") as HTMLElement);
    expect(document.querySelector(".dsh-qa-changelog")).toBeNull();
    // A click inside the panel does not close the dialog.
    fireEvent.click(screen.getByRole("button", { name: /Версия / }));
    fireEvent.click(
      document.querySelector(".dsh-qa-changelog__panel") as HTMLElement,
    );
    expect(document.querySelector(".dsh-qa-changelog")).toBeTruthy();
  });

  it("keeps the bundled version in sync with the package and changelog", async () => {
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    // jsdom gives import.meta.url an http scheme; resolve from the package root.
    const packageJson = JSON.parse(
      await readFile(resolve(process.cwd(), "package.json"), "utf8"),
    ) as { version: string };
    expect(QA_VERSION).toBe(packageJson.version);
    const changelog = await readFile(
      resolve(process.cwd(), "CHANGELOG.md"),
      "utf8",
    );
    const released = [
      // git-cliff releases use "## X.Y.Z (date)", the legacy header " - ".
      ...changelog.matchAll(/^## (\d+\.\d+\.\d+)(?: \(| - )/gmu),
    ].map((match) => match[1] as string);
    expect(QA_CHANGELOG.map((entry) => entry.version)).toEqual(released);
  });
});

describe("render equality helpers", () => {
  // The projection rebuilds every object per frame; the memoized render path
  // must treat a field-identical copy as equal and spot any content change.
  const userMessage = {
    id: "user:1",
    role: "user" as const,
    text: "Как сбросить кэш?",
    status: "committed" as const,
    timestamp: 90_000,
    images: [{ attachmentId: "att-1", mediaType: "image/png" as const }],
  };
  const assistantMessage = {
    id: "assistant:2",
    role: "assistant" as const,
    text: "Откройте настройки.",
    status: "committed" as const,
    timestamp: 95_000,
    turn: 1,
    stats: { durationMs: 9_000, ttftMs: 900, tokensPerSecond: 42 },
  };
  const systemMessage = {
    id: "context:3",
    role: "system" as const,
    text: "Субагент a1b2c3d4 завершён",
    status: "info" as const,
    timestamp: 97_000,
    notice: { title: "Субагент a1b2c3d4 завершён", body: "Готово." },
  };
  const reasoningItem: Extract<QaWorkItem, { kind: "reasoning" | "progress" }> =
    {
      id: "reasoning:1:0",
      kind: "reasoning",
      text: "Мысль.",
      status: "complete",
    };
  const toolItem: Extract<QaWorkItem, { kind: "tool" }> = {
    id: "tool:1:a",
    kind: "tool",
    name: "read",
    label: "Чтение",
    summary: "D:/file.ts",
    input: '{ "path": "D:/file.ts" }',
    output: "Содержимое",
    status: "ok",
    startedAt: 90_100,
    endedAt: 90_400,
  };
  const workMessage = {
    id: "work:1",
    role: "work" as const,
    turn: 1,
    status: "complete" as const,
    startedAt: 90_000,
    endedAt: 95_000,
    items: [reasoningItem, toolItem],
  };

  it("treats a fresh field-identical copy of each message variant as equal", () => {
    expect(sameMessage(userMessage, { ...userMessage })).toBe(true);
    expect(sameMessage(assistantMessage, { ...assistantMessage })).toBe(true);
    expect(sameMessage(systemMessage, { ...systemMessage })).toBe(true);
    expect(sameMessage(workMessage, { ...workMessage })).toBe(true);
  });

  it("spots content changes on each message variant", () => {
    expect(
      sameMessage(assistantMessage, {
        ...assistantMessage,
        text: "Другой текст.",
      }),
    ).toBe(false);
    expect(
      sameMessage(assistantMessage, {
        ...assistantMessage,
        stats: { durationMs: 9_001, ttftMs: 900, tokensPerSecond: 42 },
      }),
    ).toBe(false);
    expect(
      sameMessage(assistantMessage, {
        ...assistantMessage,
        stats: undefined,
      }),
    ).toBe(false);
    expect(
      sameMessage(userMessage, {
        ...userMessage,
        images: [{ attachmentId: "att-2", mediaType: "image/png" as const }],
      }),
    ).toBe(false);
    expect(
      sameMessage(systemMessage, {
        ...systemMessage,
        notice: { title: "Субагент a1b2c3d4 завершён", body: "Другое." },
      }),
    ).toBe(false);
    expect(
      sameMessage(workMessage, { ...workMessage, status: "running" }),
    ).toBe(false);
    expect(
      sameMessage(
        { ...assistantMessage },
        { ...userMessage, id: "assistant:2" },
      ),
    ).toBe(false);
  });

  it("compares work items by rendered content", () => {
    expect(sameWorkItem(reasoningItem, { ...reasoningItem })).toBe(true);
    expect(sameWorkItem(toolItem, { ...toolItem })).toBe(true);
    expect(
      sameWorkItem(reasoningItem, { ...reasoningItem, text: "Другая мысль." }),
    ).toBe(false);
    expect(sameWorkItem(toolItem, { ...toolItem, output: "Другое" })).toBe(
      false,
    );
    expect(sameWorkItem(toolItem, { ...toolItem, status: "error" })).toBe(
      false,
    );
    expect(sameWorkItem(reasoningItem, toolItem)).toBe(false);
    expect(sameWorkItems(workMessage.items, [...workMessage.items])).toBe(true);
    expect(sameWorkItems(workMessage.items, [reasoningItem])).toBe(false);
  });

  it("compares sidebar rows by content", () => {
    const row = {
      id: "s-1",
      title: "Chat",
      running: false,
      active: false,
      meta: "1m",
      updatedAt: 1,
    };
    expect(sameChatRows([row], [{ ...row }])).toBe(true);
    expect(sameChatRows([row], [{ ...row, meta: "2m" }])).toBe(false);
    expect(sameChatRows([row], [])).toBe(false);
  });
});

describe("QA auth gate", () => {
  function accountsApi(
    overrides: Partial<Record<keyof QaAccountsApi, unknown>> = {},
  ): QaAccountsApi {
    return {
      accountsWhoami: vi.fn(async () => ({
        ok: true as const,
        value: { authenticated: false } as never,
      })),
      accountsLogin: vi.fn(async () => ({
        ok: false as const,
        error: new Error("refused (reason: invalid-credentials)"),
      })),
      accountsRegister: vi.fn(async () => ({
        ok: false as const,
        error: new Error("refused (reason: email-taken)"),
      })),
      accountsClaimSessions: vi.fn(async () => ({
        ok: true as const,
        value: { claimed: 0, conflicts: [] },
      })),
      accountsOwnedSessions: vi.fn(async () => ({
        ok: true as const,
        value: { ids: [] },
      })),
      ...overrides,
    } as QaAccountsApi;
  }

  function gate(api: QaAccountsApi) {
    const accounts = new QaAccountsController({
      remote: api,
      storage: window.localStorage,
      config: () => resolveConfig(),
    });
    return accounts;
  }

  function GateView({
    accounts,
    allowRegistration,
  }: {
    readonly accounts: QaAccountsController;
    readonly allowRegistration: boolean;
  }) {
    // Mirror the surface: project the controller through a live subscription.
    const snapshot = useSyncExternalStore(
      accounts.subscribe,
      accounts.getSnapshot,
      accounts.getSnapshot,
    );
    return (
      <QaAuthGate
        accounts={accounts}
        snapshot={snapshot}
        title="DeepSeek QA"
        logoUrl={null}
        allowRegistration={allowRegistration}
      />
    );
  }

  async function mountedGate(api: QaAccountsApi, allowRegistration = true) {
    const accounts = gate(api);
    const view = render(
      <GateView accounts={accounts} allowRegistration={allowRegistration} />,
    );
    void accounts.start();
    await waitFor(() => {
      expect(accounts.getSnapshot().stage).toBe("gate");
    });
    return { accounts, view };
  }

  it("renders the login card and switches to registration", async () => {
    await mountedGate(accountsApi());
    expect(screen.getByText("DeepSeek QA")).toBeTruthy();
    expect(screen.getByLabelText(/Email/)).toBeTruthy();
    expect(screen.getByText("Регистрация")).toBeTruthy();
    fireEvent.click(screen.getByText("Регистрация"));
    expect(screen.getByText("Зарегистрироваться")).toBeTruthy();
  });

  it("hides the registration tab when the deployment disables signup", async () => {
    await mountedGate(accountsApi(), false);
    expect(screen.queryByText("Регистрация")).toBeNull();
    expect(screen.getByText("Войти")).toBeTruthy();
  });

  it("reports coarse refusals as audience-safe copy", async () => {
    await mountedGate(accountsApi(), false);
    fireEvent.change(screen.getByLabelText(/Email/), {
      target: { value: "a@b.co" },
    });
    fireEvent.change(screen.getByLabelText(/Пароль/), {
      target: { value: "wrong-password-1" },
    });
    fireEvent.click(screen.getByText("Войти"));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "Неверный email или пароль",
      );
    });
  });

  it("renders the account chip with a logout action in the sidebar", () => {
    const onLogout = vi.fn();
    render(
      <QaSidebar
        rows={[]}
        title="DeepSeek QA"
        logoUrl={null}
        stateKey="dsh-qa-surface.session:v1:/qa"
        showNewChat={false}
        busy={false}
        onSwitch={vi.fn()}
        onNewChat={vi.fn()}
        account={{ email: "a@b.co", role: "admin", onLogout }}
      />,
    );
    const chip = document.querySelector(".dsh-qa-sidebar__account");
    expect(chip?.textContent).toContain("a@b.co");
    expect(chip?.textContent).toContain("admin");
    fireEvent.click(
      document.querySelector(".dsh-qa-sidebar__account-exit") as HTMLElement,
    );
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});
