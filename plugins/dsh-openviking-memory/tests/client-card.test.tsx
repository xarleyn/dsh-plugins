// @vitest-environment jsdom
/**
 * The OpenViking Memory card: shell contract, configuration controls, the
 * immediate-write path and whose `mutate` it uses, the override projection the
 * form feeds it, and the two views the Plugins page renders this entry in.
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
import {
  OPENVIKING_MEMORY_ROW_SUMMARY,
  OpenVikingMemoryCard,
  OpenVikingMemoryCardEntry,
} from "../src/client/card.js";

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

const READY: FormSnapshot = {
  status: "ready",
  value: CONFIG,
  base: undefined,
  user: undefined,
  revision: 1,
  writable: true,
  mode: "host",
};

/** The namespace form this entry resolves and hands the card through its face. */
function makeForm(
  snapshot: Partial<FormSnapshot> = {},
  mutate: (ops: unknown) => Promise<boolean> = () => Promise.resolve(true),
) {
  const current: FormSnapshot = { ...READY, ...snapshot };
  return {
    form: {
      getSnapshot: () => current,
      subscribe: () => () => undefined,
      mutate: vi.fn(mutate),
      set: vi.fn(() => Promise.resolve(true)),
      unset: vi.fn(() => Promise.resolve(true)),
    },
  };
}

/**
 * The owner prop the row seat spreads over the face: the page's `{ state, mutate }`
 * view of the same namespace, which carries no subscription and no `set`/`unset`.
 */
function makePageForm(snapshot: Partial<FormSnapshot> = {}) {
  return {
    state: { ...READY, ...snapshot },
    mutate: vi.fn(() => Promise.resolve(true)),
  };
}

/** A field write, in the one-op shape the Host's own `set` expands to. */
const setOp = (field: string, value: unknown) => [
  { op: "set", path: [field], value },
];

/** A field clear, in the one-op shape the Host's own `unset` expands to. */
const unsetOp = (field: string) => [{ op: "unset", path: [field] }];

/** The slot runtime props do not exist outside the host, so tests pass them by hand. */
const Card = OpenVikingMemoryCard as unknown as (props: {
  settingsForm: unknown;
  form?: unknown;
}) => ReactElement;

const Entry = OpenVikingMemoryCardEntry as unknown as (props: {
  view: "summary" | "page";
  settingsForm: unknown;
  form?: unknown;
}) => ReactElement;

function openCard(settingsForm: unknown, pageForm?: unknown): HTMLElement {
  const view = render(<Card settingsForm={settingsForm} form={pageForm} />);
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
    const closed = render(<Card settingsForm={form} />);
    expect(closed.container.querySelector(".dsh-plugin-card__body")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Show settings: OpenViking Memory" }),
    ).not.toBeNull();
    cleanup();

    const gone = render(
      <Card
        settingsForm={
          makeForm({ status: "unavailable", value: undefined }).form
        }
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
      expect(form.mutate).toHaveBeenCalledWith(setOp("autoInject", false));
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
      expect(form.mutate).toHaveBeenCalledWith(setOp("qaUserScoping", true));
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
      expect(form.mutate).toHaveBeenCalledWith(
        setOp("endpoint", "http://ov.example:1933"),
      );
    });

    fireEvent.change(endpoint, { target: { value: "   " } });
    fireEvent.blur(endpoint);
    await waitFor(() => {
      expect(form.mutate).toHaveBeenCalledWith(unsetOp("endpoint"));
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
      expect(form.mutate).toHaveBeenCalledWith(
        setOp("recallTokenBudget", 4096),
      );
    });

    fireEvent.change(budget, { target: { value: "" } });
    fireEvent.blur(budget);
    await waitFor(() => {
      expect(form.mutate).toHaveBeenCalledWith(unsetOp("recallTokenBudget"));
    });

    fireEvent.change(budget, { target: { value: "999999" } });
    fireEvent.blur(budget);
    await waitFor(() => {
      expect(
        screen.getByTestId("openviking-card-write-error").textContent,
      ).toMatch(/outside this field's configured range/u);
    });
    expect(form.mutate).not.toHaveBeenCalledWith(
      setOp("recallTokenBudget", 999999),
    );
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
      expect(form.mutate).toHaveBeenCalledWith(
        setOp("recallPeerScope", "actor"),
      );
    });

    fireEvent.change(peerScope, { target: { value: "" } });
    await waitFor(() => {
      expect(form.mutate).toHaveBeenCalledWith(unsetOp("recallPeerScope"));
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
      expect(form.mutate).toHaveBeenCalledWith(
        setOp("captureFilters", ["s/x/y/", "d|noise|"]),
      );
    });

    fireEvent.change(area, { target: { value: "  \n " } });
    fireEvent.blur(area);
    await waitFor(() => {
      expect(form.mutate).toHaveBeenCalledWith(unsetOp("captureFilters"));
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
    const { form } = makeForm({}, () =>
      Promise.reject(new Error("revision conflict")),
    );
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

describe("whose form the card writes through", () => {
  it("takes the page's `mutate` for every write while the seat supplies a form", async () => {
    const { form } = makeForm();
    const page = makePageForm();
    openCard(form, page);

    fireEvent.click(
      labeledInput("autoInject", "openviking-card-presentation-auto-inject"),
    );
    await waitFor(() => {
      expect(page.mutate).toHaveBeenCalledWith(setOp("autoInject", false));
    });

    const endpoint = labeledInput(
      "endpoint",
      "openviking-card-connection-endpoint",
    );
    fireEvent.change(endpoint, { target: { value: "" } });
    fireEvent.blur(endpoint);
    await waitFor(() => {
      expect(page.mutate).toHaveBeenCalledWith(unsetOp("endpoint"));
    });

    // The per-field `set`/`unset` of the resolved form are not the write path any
    // more, and neither is its `mutate`: the page's form fences the namespace.
    expect(form.set).not.toHaveBeenCalled();
    expect(form.unset).not.toHaveBeenCalled();
    expect(form.mutate).not.toHaveBeenCalled();
  });

  it("resets every override in the bulk mutation the page's form takes", async () => {
    const { form } = makeForm({
      user: { apiKey: "secret-token", syncTurns: true },
    });
    const page = makePageForm();
    openCard(form, page);

    fireEvent.click(screen.getByTestId("openviking-card-reset-all"));
    await waitFor(() => {
      expect(page.mutate).toHaveBeenCalledWith([
        { op: "unset", path: ["apiKey"] },
        { op: "unset", path: ["syncTurns"] },
      ]);
    });
  });

  it("still writes when the seat hands no form at all", async () => {
    // `form` is `undefined` on a Host that does not serve this namespace as a page
    // form, and a card that only knew how to write through the seat would go dead.
    const { form } = makeForm();
    const view = render(
      <Entry view="page" settingsForm={form} form={undefined} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Show settings: OpenViking Memory" }),
    );
    fireEvent.click(
      labeledInput("autoInject", "openviking-card-presentation-auto-inject"),
    );
    await waitFor(() => {
      expect(form.mutate).toHaveBeenCalledWith(setOp("autoInject", false));
    });
    expect(view.container.querySelector("li.dsh-plugin-card")).not.toBeNull();
  });

  it("surfaces a refusal the page's form answers with as an error line", async () => {
    const { form } = makeForm();
    const page = makePageForm();
    page.mutate.mockImplementationOnce(() =>
      Promise.reject(new Error("the Host refused that write")),
    );
    openCard(form, page);

    fireEvent.click(
      labeledInput("autoInject", "openviking-card-presentation-auto-inject"),
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("openviking-card-write-error").textContent,
      ).toBe("the Host refused that write");
    });
  });
});

describe("the row entry the Plugins page renders", () => {
  it("answers the summary view with the row's one-liner, not a second card", () => {
    const { form } = makeForm();
    const view = render(
      <Entry view="summary" settingsForm={form} form={makePageForm()} />,
    );

    // The page puts this inside its own `<p>`, so it has to stay text.
    expect(view.container.textContent).toBe(OPENVIKING_MEMORY_ROW_SUMMARY);
    expect(view.container.querySelector("li.dsh-plugin-card")).toBeNull();
  });

  it("renders the card shell inside its own list for the page view", () => {
    const { form } = makeForm();
    const view = render(
      <Entry view="page" settingsForm={form} form={makePageForm()} />,
    );

    const card = view.container.querySelector("li.dsh-plugin-card");
    expect(card?.parentElement?.tagName).toBe("UL");
  });

  it("keeps the face's form while the seat spreads its own `form` over it", () => {
    // The renderer passes the owner props after the injected face, so a face member
    // named `form` would be overwritten by the seat's `ConfigPageForm`; the entry
    // has to read the resolved form from `settingsForm` to subscribe at all.
    const { form } = makeForm();
    const page = makePageForm();
    const view = render(<Entry view="page" settingsForm={form} form={page} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Show settings: OpenViking Memory" }),
    );

    expect(view.container.querySelector("li.dsh-plugin-card")).not.toBeNull();
    expect(
      labeledInput("endpoint", "openviking-card-connection-endpoint").value,
    ).toBe("http://127.0.0.1:1933");
  });
});
