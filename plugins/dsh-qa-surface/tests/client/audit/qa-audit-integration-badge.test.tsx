// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QaAuditRowBadge } from "../../../src/client/audit/QaAuditRowBadge.js";
import { QaSidebar } from "../../../src/client/components/QaSidebar.js";
import { summary } from "./qa-audit-integration.helpers.js";

describe("QaAuditRowBadge", () => {
  it("separates 'an audit exists' from 'what it found'", () => {
    const { container } = render(
      <QaAuditRowBadge
        mark={{
          verdict: "poor",
          critical: 0,
          major: 2,
          minor: 0,
          observation: 0,
          other: 0,
        }}
        withDelete={false}
        onOpen={() => {}}
      />,
    );

    // The check mark is existence; the verdict carries the quality, and for a
    // poor audit it must not read as approval.
    expect(container.querySelector("svg path")).not.toBeNull();
    const verdict = container.querySelector(
      ".dsh-qa-sidebar__item-audit-verdict",
    );
    expect(verdict?.textContent).toBe("Poor");
    expect(verdict?.className).toContain("--bad");
  });

  it("describes itself for assistive technology and on hover", () => {
    render(
      <QaAuditRowBadge
        mark={{
          verdict: "good",
          critical: 0,
          major: 1,
          minor: 2,
          observation: 0,
          other: 0,
        }}
        withDelete={false}
        onOpen={() => {}}
      />,
    );

    const button = screen.getByRole("button", { name: /Открыть аудит/u });
    expect(button.getAttribute("title")).toContain("Good");
    expect(button.getAttribute("title")).toContain("1 major");
  });

  it("opens on click", () => {
    const onOpen = vi.fn();
    render(
      <QaAuditRowBadge
        mark={{
          verdict: "good",
          critical: 0,
          major: 0,
          minor: 0,
          observation: 0,
          other: 0,
        }}
        withDelete={false}
        onOpen={onOpen}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Открыть аудит/u }));

    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("leaves room for a delete control when the row has one", () => {
    const { container } = render(
      <QaAuditRowBadge
        mark={{
          verdict: "good",
          critical: 0,
          major: 0,
          minor: 0,
          observation: 0,
          other: 0,
        }}
        withDelete
        onOpen={() => {}}
      />,
    );

    expect(
      container.querySelector(".dsh-qa-sidebar__item-audit--with-delete"),
    ).not.toBeNull();
  });
});

describe("QaSidebar with audits", () => {
  const rows = [
    {
      id: "session-a",
      title: "Первый чат",
      running: false,
      active: false,
      meta: "1 мин",
      updatedAt: 2,
    },
    {
      id: "session-b",
      title: "Второй чат",
      running: false,
      active: false,
      meta: "2 мин",
      updatedAt: 1,
    },
  ];
  const base = {
    rows,
    title: "Демо",
    logoUrl: null,
    stateKey: "qa-audit-test",
    showNewChat: true,
    busy: false,
    onSwitch: () => {},
    onNewChat: () => {},
  } as const;

  it("badges only the audited chat", () => {
    render(
      <QaSidebar
        {...base}
        audits={new Map([["session-a", summary()]])}
        onAudit={() => {}}
      />,
    );

    expect(
      screen.getAllByRole("button", { name: /Открыть аудит/u }),
    ).toHaveLength(1);
  });

  it("badges nothing when the audit plugin is absent", () => {
    render(
      <QaSidebar {...base} audits={new Map([["session-a", summary()]])} />,
    );

    expect(screen.queryByRole("button", { name: /Открыть аудит/u })).toBeNull();
  });

  it("badges nothing when no chat has an audit", () => {
    render(<QaSidebar {...base} audits={new Map()} onAudit={() => {}} />);

    expect(screen.queryByRole("button", { name: /Открыть аудит/u })).toBeNull();
  });
});
