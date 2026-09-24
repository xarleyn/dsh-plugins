// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { formatWorkDuration } from "../../../src/client/components/format.js";
import { QaWorkGroup } from "../../../src/client/components/QaWorkGroup.js";
import { DEFAULT_THINKING_PHRASES } from "../../../src/client/components/thinking-phrases.js";

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
      name: (name: string): boolean =>
        DEFAULT_THINKING_PHRASES.some((phrase) => name.startsWith(phrase)),
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

  it("labels a provider-failed turn as interrupted and starts collapsed", () => {
    render(
      <QaWorkGroup
        status="error"
        startedAt={1_000}
        endedAt={5_000}
        renderMarkdown={false}
        items={[
          {
            id: "reasoning:1",
            kind: "reasoning",
            text: "Reading the tree.",
            status: "complete",
          },
        ]}
      />,
    );

    const toggle = screen.getByRole("button", { name: "Прервано за 4 с" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Reading the tree.")).toBeTruthy();
  });

  it("collapses automatically when a running turn fails", async () => {
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

    view.rerender(
      <QaWorkGroup
        status="error"
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
          .getByRole("button", { name: "Прервано за 5 с" })
          .getAttribute("aria-expanded"),
      ).toBe("false"),
    );
  });

  it("cycles the operator's phrases instead of the built-in ones", () => {
    render(
      <QaWorkGroup
        status="running"
        startedAt={Date.now() - 4_500}
        renderMarkdown={false}
        thinkingPhrases={["Точу", "Полирую"]}
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

    expect(
      screen
        .getByRole("button", { name: /^Полирую/u })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("formats short and minute-scale durations", () => {
    expect(formatWorkDuration(100)).toBe("< 1 с");
    expect(formatWorkDuration(17_000)).toBe("17 с");
    expect(formatWorkDuration(1_060_000)).toBe("17 мин 40 с");
  });
});
