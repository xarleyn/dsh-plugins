// @vitest-environment jsdom
/**
 * The OpenViking Memory card: shell contract, configuration controls, the
 * immediate-write path, and the override projection the scope feeds it.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

import type { Config } from "../src/config.js";
import { OpenVikingMemoryCard } from "../src/client/card.js";

const CONFIG: Config = {
  autoInject: true,
  injectStartupProfile: true,
  injectStepProfile: true,
  autoRecall: true,
  endpoint: "http://127.0.0.1:1933",
  apiKey: "secret-token",
  workspacePeer: true,
  recallTokenBudget: 2000,
  recallMaxContentChars: 500,
  recallPreferAbstract: true,
  scoreThreshold: 0.35,
  minQueryLength: 3,
  profileTokenBudget: 10000,
  recallRewrite: "off",
  recallDedupTurns: 5,
  recallContextTimeoutMs: 0,
  commitTokenThreshold: 20000,
  commitKeepRecentCount: 10,
  syncTurns: true,
  captureToolResults: false,
  captureMaxLength: 24000,
  captureToolMaxChars: 1000000,
  captureAssistantTurns: true,
  captureFilters: ["s/a/b/"],
  skipSubagentSessions: false,
  requestTimeoutMs: 10000,
  mcpToolCallTimeoutMs: 60000,
};

type ScopeSnapshot = {
  status: "loading" | "ready" | "unavailable";
  value: Config | undefined;
  base: unknown;
  user: unknown;
  revision: number | undefined;
  writable: boolean;
  mode: "host" | "memory";
};

function makeScope(
  snapshot: Partial<ScopeSnapshot> = {},
  mutate: (ops: unknown) => Promise<void> = () => Promise.resolve(),
) {
  const current: ScopeSnapshot = {
    status: "ready",
    value: CONFIG,
    base: undefined,
    user: undefined,
    revision: 1,
    writable: true,
    mode: "host",
    ...snapshot,
  };
  return {
    scope: {
      getSnapshot: () => current,
      subscribe: () => () => undefined,
      mutate: vi.fn(mutate),
      set: vi.fn(() => Promise.resolve()),
      unset: vi.fn(() => Promise.resolve()),
    },
  };
}

/** The slot runtime props do not exist outside the host; only the face does. */
const Card = OpenVikingMemoryCard as unknown as (props: {
  scope: unknown;
}) => ReactElement;

function openCard(scope: unknown): HTMLElement {
  const view = render(<Card scope={scope} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Show settings: OpenViking Memory" }),
  );
  return view.container;
}

function labeledInput(label: string): HTMLInputElement {
  const element = screen.getByLabelText(label);
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`${label} is not an input`);
  }
  return element;
}

afterEach(cleanup);

describe("shell contract", () => {
  it("renders the canonical card shell with the SVG chevron", () => {
    const { scope } = makeScope();
    const container = openCard(scope);

    const card = container.querySelector("li.dsh-plugin-card");
    expect(card).not.toBeNull();
    expect(card?.className).toBe("dsh-plugin-card dsh-plugin-card--open");

    const header = container.querySelector<HTMLButtonElement>(
      "button.dsh-plugin-card__header",
    );
    expect(header).not.toBeNull();
    expect(header?.getAttribute("aria-expanded")).toBe("true");
    expect(header?.getAttribute("aria-label")).toBe(
      "Hide settings: OpenViking Memory",
    );

    const chevron = container.querySelector<SVGPathElement>(
      "svg.dsh-plugin-card__chevron path",
    );
    expect(chevron?.getAttribute("d")).toBe("m3.5 5.25 3.5 3.5 3.5-3.5");

    // The badge projects the master switch, not live state.
    expect(
      container.querySelector(".dsh-plugin-card__badge")?.textContent,
    ).toBe("Auto-inject");
  });

  it("renders no body while collapsed and none at all when unavailable", () => {
    const { scope } = makeScope();
    const closed = render(<Card scope={scope} />);
    expect(closed.container.querySelector(".dsh-plugin-card__body")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Show settings: OpenViking Memory" }),
    ).not.toBeNull();
    cleanup();

    const gone = render(
      <Card
        scope={makeScope({ status: "unavailable", value: undefined }).scope}
      />,
    );
    expect(gone.container.querySelector("li.dsh-plugin-card")).toBeNull();
  });

  it("shows the loading text before the first accepted section", () => {
    const { scope } = makeScope({ status: "loading", value: undefined });
    openCard(scope);
    expect(
      screen.getByText(/Loading the OpenViking Memory configuration/),
    ).not.toBeNull();
  });

  it("projects the manual-recall badge when auto-inject is off", () => {
    const { scope } = makeScope({ value: { ...CONFIG, autoInject: false } });
    openCard(scope);
    expect(document.querySelector(".dsh-plugin-card__badge")?.textContent).toBe(
      "Manual recall",
    );
  });
});

describe("controls and writes", () => {
  it("renders configured values and placeholders", () => {
    const { scope } = makeScope();
    openCard(scope);

    expect(labeledInput("endpoint").value).toBe("http://127.0.0.1:1933");
    expect(labeledInput("apiKey").type).toBe("password");
    expect(labeledInput("scoreThreshold").value).toBe("0.35");
    // Unset in the composition: the placeholder shows the upstream default.
    expect(labeledInput("recallLimit").value).toBe("");
    expect(labeledInput("recallLimit").placeholder).toBe("10");
  });

  it("disables every control while the namespace is read-only", () => {
    const { scope } = makeScope({ writable: false });
    openCard(scope);

    for (const input of document.querySelectorAll("input")) {
      expect(input.disabled).toBe(true);
    }
    for (const select of document.querySelectorAll("select")) {
      expect(select.disabled).toBe(true);
    }
    for (const area of document.querySelectorAll("textarea")) {
      expect(area.disabled).toBe(true);
    }
  });

  it("writes a toggle flip immediately", async () => {
    const { scope } = makeScope();
    openCard(scope);

    fireEvent.click(screen.getByLabelText("autoInject"));
    await waitFor(() => {
      expect(scope.set).toHaveBeenCalledWith("autoInject", false);
    });
  });

  it("commits a text draft on blur and clears an emptied one", async () => {
    const { scope } = makeScope();
    openCard(scope);

    const endpoint = labeledInput("endpoint");
    fireEvent.change(endpoint, { target: { value: "http://ov.example:1933" } });
    fireEvent.blur(endpoint);
    await waitFor(() => {
      expect(scope.set).toHaveBeenCalledWith(
        "endpoint",
        "http://ov.example:1933",
      );
    });

    fireEvent.change(endpoint, { target: { value: "   " } });
    fireEvent.blur(endpoint);
    await waitFor(() => {
      expect(scope.unset).toHaveBeenCalledWith("endpoint");
    });
  });

  it("commits a number on blur, clears when emptied, rejects out of range", async () => {
    const { scope } = makeScope();
    openCard(scope);

    const budget = labeledInput("recallTokenBudget");
    fireEvent.change(budget, { target: { value: "4096" } });
    fireEvent.blur(budget);
    await waitFor(() => {
      expect(scope.set).toHaveBeenCalledWith("recallTokenBudget", 4096);
    });

    fireEvent.change(budget, { target: { value: "" } });
    fireEvent.blur(budget);
    await waitFor(() => {
      expect(scope.unset).toHaveBeenCalledWith("recallTokenBudget");
    });

    fireEvent.change(budget, { target: { value: "999999" } });
    fireEvent.blur(budget);
    await waitFor(() => {
      expect(
        screen.getByText(/outside this field's configured range/),
      ).not.toBeNull();
    });
    expect(scope.set).not.toHaveBeenCalledWith("recallTokenBudget", 999999);
  });

  it("selects an enum value and clears back to inherit", async () => {
    const { scope } = makeScope();
    openCard(scope);

    const peerScope = screen.getByLabelText("recallPeerScope");
    if (!(peerScope instanceof HTMLSelectElement)) {
      throw new Error("recallPeerScope is not a select");
    }
    fireEvent.change(peerScope, { target: { value: "actor" } });
    await waitFor(() => {
      expect(scope.set).toHaveBeenCalledWith("recallPeerScope", "actor");
    });

    fireEvent.change(peerScope, { target: { value: "" } });
    await waitFor(() => {
      expect(scope.unset).toHaveBeenCalledWith("recallPeerScope");
    });
  });

  it("commits the filter list line by line and clears when empty", async () => {
    const { scope } = makeScope();
    openCard(scope);

    const area = document.querySelector("textarea");
    if (!(area instanceof HTMLTextAreaElement)) throw new Error("missing area");
    fireEvent.change(area, { target: { value: "s/x/y/\n\nd|noise|" } });
    fireEvent.blur(area);
    await waitFor(() => {
      expect(scope.set).toHaveBeenCalledWith("captureFilters", [
        "s/x/y/",
        "d|noise|",
      ]);
    });

    fireEvent.change(area, { target: { value: "  \n " } });
    fireEvent.blur(area);
    await waitFor(() => {
      expect(scope.unset).toHaveBeenCalledWith("captureFilters");
    });
  });
});

describe("overrides", () => {
  it("marks overridden fields and offers a reset", async () => {
    const { scope } = makeScope({
      user: { apiKey: "secret-token", syncTurns: true },
    });
    openCard(scope);

    expect(screen.getAllByText("override")).toHaveLength(2);
    const reset = screen.getByRole("button", { name: "Reset 2 overrides" });
    fireEvent.click(reset);
    await waitFor(() => {
      expect(scope.mutate).toHaveBeenCalledWith([
        { op: "unset", path: ["apiKey"] },
        { op: "unset", path: ["syncTurns"] },
      ]);
    });
  });

  it("offers no reset when nothing is overridden", () => {
    const { scope } = makeScope();
    openCard(scope);
    expect(screen.queryByRole("button", { name: /Reset/ })).toBeNull();
  });

  it("surfaces a failed write as an error line", async () => {
    const { scope } = makeScope();
    const set = scope.set as unknown as ReturnType<typeof vi.fn>;
    set.mockReturnValueOnce(Promise.reject(new Error("revision conflict")));
    openCard(scope);

    fireEvent.click(screen.getByLabelText("autoInject"));
    await waitFor(() => {
      expect(screen.getByText("revision conflict")).not.toBeNull();
    });
  });
});
