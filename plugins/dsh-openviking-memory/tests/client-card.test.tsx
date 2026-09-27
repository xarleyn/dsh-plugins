// @vitest-environment jsdom
/**
 * The OpenViking Memory card: shell contract, configuration controls, the
 * immediate-write path, and the override projection the form feeds it.
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

type FormSnapshot = {
  status: "loading" | "ready" | "unavailable";
  value: Config | undefined;
  base: unknown;
  user: unknown;
  revision: number | undefined;
  writable: boolean;
  mode: "host" | "memory";
};

function makeForm(
  snapshot: Partial<FormSnapshot> = {},
  mutate: (ops: unknown) => Promise<void> = () => Promise.resolve(),
) {
  const current: FormSnapshot = {
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
    form: {
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
  form: unknown;
}) => ReactElement;

function openCard(form: unknown): HTMLElement {
  const view = render(<Card form={form} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Show settings: OpenViking Memory" }),
  );
  return view.container;
}

function labeledInput(label: string, testId: string): HTMLInputElement {
  const element = screen.getByTestId(testId);
  // The id is the handle a test reaches the control by; the field's own label
  // stays the name a reader hears, and both have to point at one node.
  expect(screen.getByLabelText(label)).toBe(element);
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`${testId} is not an input`);
  }
  return element;
}

afterEach(cleanup);

describe("shell contract", () => {
  it("renders the canonical card shell with the SVG chevron", () => {
    const { form } = makeForm();
    const container = openCard(form);

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
    expect(screen.getByTestId("openviking-card-badge").textContent).toBe(
      "Auto-inject",
    );
  });

  it("renders no body while collapsed and none at all when unavailable", () => {
    const { form } = makeForm();
    const closed = render(<Card form={form} />);
    expect(closed.container.querySelector(".dsh-plugin-card__body")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Show settings: OpenViking Memory" }),
    ).not.toBeNull();
    cleanup();

    const gone = render(
      <Card
        form={makeForm({ status: "unavailable", value: undefined }).form}
      />,
    );
    expect(gone.container.querySelector("li.dsh-plugin-card")).toBeNull();
  });

  it("shows the loading text before the first accepted section", () => {
    const { form } = makeForm({ status: "loading", value: undefined });
    openCard(form);
    expect(screen.getByTestId("openviking-card-loading").textContent).toMatch(
      /Loading the OpenViking Memory configuration/u,
    );
  });

  it("projects the manual-recall badge when auto-inject is off", () => {
    const { form } = makeForm({ value: { ...CONFIG, autoInject: false } });
    openCard(form);
    expect(screen.getByTestId("openviking-card-badge").textContent).toBe(
      "Manual recall",
    );
  });
});

describe("controls and writes", () => {
  it("renders configured values and placeholders", () => {
    const { form } = makeForm();
    openCard(form);

    expect(
      labeledInput("endpoint", "openviking-card-connection-endpoint").value,
    ).toBe("http://127.0.0.1:1933");
    expect(
      labeledInput("apiKey", "openviking-card-connection-api-key").type,
    ).toBe("password");
    expect(
      labeledInput("scoreThreshold", "openviking-card-recall-score-threshold")
        .value,
    ).toBe("0.35");
    // Unset in the composition: the placeholder shows the upstream default.
    const recallLimit = labeledInput(
      "recallLimit",
      "openviking-card-recall-limit",
    );
    expect(recallLimit.value).toBe("");
    expect(recallLimit.placeholder).toBe("10");
  });

  it("disables every control while the namespace is read-only", () => {
    const { form } = makeForm({ writable: false });
    openCard(form);

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
    const { form } = makeForm();
    openCard(form);

    fireEvent.click(
      labeledInput("autoInject", "openviking-card-presentation-auto-inject"),
    );
    await waitFor(() => {
      expect(form.set).toHaveBeenCalledWith("autoInject", false);
    });
  });

  it("switches per-account memory scoping from the card", async () => {
    const { form } = makeForm({ value: { ...CONFIG, qaUserScoping: false } });
    openCard(form);

    const toggle = labeledInput(
      "qaUserScoping",
      "openviking-card-multi-user-scoping",
    );
    expect(toggle.checked).toBe(false);

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(form.set).toHaveBeenCalledWith("qaUserScoping", true);
    });
  });

  it("keeps per-account scoping on when the deployment never named it", () => {
    // `qaUserScoping` defaults to on, and the card must not read an unset value
    // as "off" — that would show the switch flipped the wrong way round.
    const { form } = makeForm();
    openCard(form);
    expect(
      labeledInput("qaUserScoping", "openviking-card-multi-user-scoping")
        .checked,
    ).toBe(true);
  });

  it("commits a text draft on blur and clears an emptied one", async () => {
    const { form } = makeForm();
    openCard(form);

    const endpoint = labeledInput(
      "endpoint",
      "openviking-card-connection-endpoint",
    );
    fireEvent.change(endpoint, { target: { value: "http://ov.example:1933" } });
    fireEvent.blur(endpoint);
    await waitFor(() => {
      expect(form.set).toHaveBeenCalledWith(
        "endpoint",
        "http://ov.example:1933",
      );
    });

    fireEvent.change(endpoint, { target: { value: "   " } });
    fireEvent.blur(endpoint);
    await waitFor(() => {
      expect(form.unset).toHaveBeenCalledWith("endpoint");
    });
  });

  it("commits a number on blur, clears when emptied, rejects out of range", async () => {
    const { form } = makeForm();
    openCard(form);

    const budget = labeledInput(
      "recallTokenBudget",
      "openviking-card-recall-token-budget",
    );
    fireEvent.change(budget, { target: { value: "4096" } });
    fireEvent.blur(budget);
    await waitFor(() => {
      expect(form.set).toHaveBeenCalledWith("recallTokenBudget", 4096);
    });

    fireEvent.change(budget, { target: { value: "" } });
    fireEvent.blur(budget);
    await waitFor(() => {
      expect(form.unset).toHaveBeenCalledWith("recallTokenBudget");
    });

    fireEvent.change(budget, { target: { value: "999999" } });
    fireEvent.blur(budget);
    await waitFor(() => {
      expect(
        screen.getByTestId("openviking-card-write-error").textContent,
      ).toMatch(/outside this field's configured range/u);
    });
    expect(form.set).not.toHaveBeenCalledWith("recallTokenBudget", 999999);
  });

  it("selects an enum value and clears back to inherit", async () => {
    const { form } = makeForm();
    openCard(form);

    const peerScope = screen.getByTestId("openviking-card-recall-peer-scope");
    expect(screen.getByLabelText("recallPeerScope")).toBe(peerScope);
    if (!(peerScope instanceof HTMLSelectElement)) {
      throw new Error("recallPeerScope is not a select");
    }
    fireEvent.change(peerScope, { target: { value: "actor" } });
    await waitFor(() => {
      expect(form.set).toHaveBeenCalledWith("recallPeerScope", "actor");
    });

    fireEvent.change(peerScope, { target: { value: "" } });
    await waitFor(() => {
      expect(form.unset).toHaveBeenCalledWith("recallPeerScope");
    });
  });

  it("commits the filter list line by line and clears when empty", async () => {
    const { form } = makeForm();
    openCard(form);

    const area = screen.getByTestId("openviking-card-capture-filters");
    expect(screen.getByLabelText("captureFilters")).toBe(area);
    if (!(area instanceof HTMLTextAreaElement)) throw new Error("missing area");
    fireEvent.change(area, { target: { value: "s/x/y/\n\nd|noise|" } });
    fireEvent.blur(area);
    await waitFor(() => {
      expect(form.set).toHaveBeenCalledWith("captureFilters", [
        "s/x/y/",
        "d|noise|",
      ]);
    });

    fireEvent.change(area, { target: { value: "  \n " } });
    fireEvent.blur(area);
    await waitFor(() => {
      expect(form.unset).toHaveBeenCalledWith("captureFilters");
    });
  });
});

describe("overrides", () => {
  it("marks overridden fields and offers a reset", async () => {
    const { form } = makeForm({
      user: { apiKey: "secret-token", syncTurns: true },
    });
    openCard(form);

    expect(screen.getAllByTestId(/-override$/u)).toHaveLength(2);
    expect(
      screen.getByTestId("openviking-card-connection-api-key-override"),
    ).toBeDefined();
    expect(
      screen.getByTestId("openviking-card-capture-sync-turns-override"),
    ).toBeDefined();
    const reset = screen.getByTestId("openviking-card-reset-all");
    expect(screen.getByRole("button", { name: "Reset 2 overrides" })).toBe(
      reset,
    );
    fireEvent.click(reset);
    await waitFor(() => {
      expect(form.mutate).toHaveBeenCalledWith([
        { op: "unset", path: ["apiKey"] },
        { op: "unset", path: ["syncTurns"] },
      ]);
    });
  });

  it("offers no reset when nothing is overridden", () => {
    const { form } = makeForm();
    openCard(form);
    expect(screen.queryByTestId("openviking-card-reset-all")).toBeNull();
    expect(screen.queryByRole("button", { name: /Reset/u })).toBeNull();
  });

  it("surfaces a failed write as an error line", async () => {
    const { form } = makeForm();
    const set = form.set as unknown as ReturnType<typeof vi.fn>;
    set.mockReturnValueOnce(Promise.reject(new Error("revision conflict")));
    openCard(form);

    fireEvent.click(
      labeledInput("autoInject", "openviking-card-presentation-auto-inject"),
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("openviking-card-write-error").textContent,
      ).toBe("revision conflict");
    });
  });
});
