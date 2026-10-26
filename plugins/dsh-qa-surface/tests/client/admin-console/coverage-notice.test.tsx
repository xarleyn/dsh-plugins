// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CoverageNotice } from "../../../src/client/admin/CoverageNotice.js";
import { OVERVIEW } from "./qa-admin-console.helpers.js";

describe("partial journal coverage", () => {
  it("labels the counters and explains why the percentage is unavailable", () => {
    render(
      <CoverageNotice
        metrics={{
          ...OVERVIEW.metrics,
          coverage: {
            complete: false,
            readConversations: 2,
            totalConversations: 7,
          },
        }}
      />,
    );
    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("2 из 7");
    expect(notice.textContent).toContain(
      "доля оценённых ответов пока не рассчитана",
    );
    expect(notice.textContent).toContain(
      "Оценки пользователей учтены полностью",
    );
  });
  it("hides the warning when every journal is readable", () => {
    render(
      <CoverageNotice
        metrics={{
          ...OVERVIEW.metrics,
          coverage: {
            complete: true,
            readConversations: 7,
            totalConversations: 7,
          },
        }}
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });
});
