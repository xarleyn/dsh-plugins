// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  QA_TURN_NOTICE_COPY,
  QaTurnNotice,
} from "../src/client/components/QaTurnNotice.js";
import type { QaTurnNoticeItem } from "../src/client/notifications/notification-dispatcher.js";

const items: readonly QaTurnNoticeItem[] = [
  { key: "b:2", sessionId: "b", title: "Подбор оборудования" },
  { key: "a:1", sessionId: "a", title: "Монтаж кондиционера" },
];

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(() => cleanup());

function mount(
  overrides: {
    onOpen?: (sessionId: string) => void;
    onDismiss?: (key: string) => void;
    onEnableDesktop?: () => void;
  } = {},
) {
  render(
    <QaTurnNotice
      items={items}
      onOpen={overrides.onOpen ?? vi.fn()}
      onDismiss={overrides.onDismiss ?? vi.fn()}
      {...(overrides.onEnableDesktop === undefined
        ? {}
        : { onEnableDesktop: overrides.onEnableDesktop })}
    />,
  );
}

describe("turn completion notice", () => {
  it("lists one line per finished chat, announced politely", () => {
    mount();
    const region = screen.getByRole("region", {
      name: QA_TURN_NOTICE_COPY.region,
    });
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(screen.getAllByText(QA_TURN_NOTICE_COPY.finished)).toHaveLength(2);
    expect(screen.getByText("Подбор оборудования")).toBeTruthy();
    expect(screen.getByText("Монтаж кондиционера")).toBeTruthy();
  });

  it("opens the chat a line is about", () => {
    const onOpen = vi.fn();
    mount({ onOpen });
    fireEvent.click(screen.getByText("Монтаж кондиционера"));
    expect(onOpen).toHaveBeenCalledWith("a");
  });

  it("takes one line out without touching the others", () => {
    const onDismiss = vi.fn();
    mount({ onDismiss });
    fireEvent.click(
      screen.getByLabelText(
        `${QA_TURN_NOTICE_COPY.dismiss}: Подбор оборудования`,
      ),
    );
    expect(onDismiss).toHaveBeenCalledWith("b:2");
  });

  it("renders nothing while there is nothing to report", () => {
    render(<QaTurnNotice items={[]} onOpen={vi.fn()} onDismiss={vi.fn()} />);
    expect(document.querySelector(".dsh-qa-turn-notice")).toBeNull();
  });

  it("offers the desktop channel only when the caller allows it", () => {
    mount();
    expect(
      screen.queryByRole("button", {
        name: QA_TURN_NOTICE_COPY.offerAction,
      }),
    ).toBeNull();

    cleanup();
    const onEnableDesktop = vi.fn();
    mount({ onEnableDesktop });
    fireEvent.click(
      screen.getByRole("button", {
        name: QA_TURN_NOTICE_COPY.offerAction,
      }),
    );
    expect(onEnableDesktop).toHaveBeenCalledTimes(1);
  });
});
