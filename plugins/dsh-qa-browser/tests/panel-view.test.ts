/**
 * The panel's derived view, on its own.
 *
 * These are the decisions the container used to make inline, twice: the tests
 * below pin each one where the DOM tests can only see it through a render.
 */
import { describe, expect, it } from "vitest";

import {
  addressValue,
  collectRefusals,
  DEFAULT_VIEWPORT,
  leadRefusal,
  ownsLease,
  panelView,
  refusalKindLabel,
  refusalTitle,
} from "../src/client/panel-view.js";
import type {
  BrowserPanelState,
  BrowserPolicyRefusal,
  BrowserSessionInfo,
} from "../src/types.js";

import { panelState, tab } from "./browser-panel.helpers.js";

const HOLDER = "panel-1";
const OTHER = "panel-2";

function refusal(
  overrides: Partial<BrowserPolicyRefusal> = {},
): BrowserPolicyRefusal {
  return {
    code: "BROWSER_HOST_BLOCKED",
    kind: "resource",
    host: "api.intranet.example.corp",
    message: "Private-network destinations are blocked by Browser policy.",
    count: 1,
    ...overrides,
  };
}

function withControl(
  state: BrowserPanelState,
  control: BrowserSessionInfo["control"],
): BrowserPanelState {
  return {
    ...state,
    session: state.session === null ? null : { ...state.session, control },
  };
}

describe("collectRefusals", () => {
  it("keeps the page's own refusals in front of the session's", () => {
    const page = refusal({ host: "page.example.corp" });
    const sessionWide = refusal({
      kind: "document",
      host: "blocked.example.corp",
    });
    const state = panelState([tab()], "tab-a", {
      policyRefusals: [sessionWide],
    });
    const selected = { ...tab(), policyRefusals: [page] };

    expect(collectRefusals(state, selected)).toEqual([page, sessionWide]);
  });

  it("passes the page's list through untouched when nothing is session-wide", () => {
    const page = refusal();
    const state = panelState([tab()], "tab-a");
    const selected = { ...tab(), policyRefusals: [page] };

    // Identity, not equality: an empty session list must not allocate a copy
    // the render would then treat as a new list on every poll.
    expect(collectRefusals(state, selected)).toBe(selected.policyRefusals);
  });

  it("answers an empty list with no page and no session", () => {
    expect(collectRefusals(null, undefined)).toEqual([]);
  });
});

describe("leadRefusal", () => {
  it("prefers the blocked page over the requests it never made", () => {
    const request = refusal();
    const blocked = refusal({ kind: "document", host: "blocked.example.corp" });

    expect(leadRefusal([request, blocked])).toBe(blocked);
  });

  it("falls back to the first entry, and to nothing at all", () => {
    const first = refusal({ host: "first.example.corp" });
    expect(leadRefusal([first, refusal()])).toBe(first);
    expect(leadRefusal([])).toBeUndefined();
  });
});

describe("refusalTitle", () => {
  it("names the host a navigation was stopped at", () => {
    expect(
      refusalTitle([
        refusal({ kind: "document", host: "blocked.example.corp" }),
      ]),
    ).toBe("Политика Browser не пускает на blocked.example.corp");
  });

  it("says a single blocked request and counts several", () => {
    expect(refusalTitle([refusal()])).toMatch(/запрос заблокирован/u);
    expect(refusalTitle([refusal(), refusal({ count: 3 })])).toMatch(
      /заблокировано запросов — 2/u,
    );
  });
});

describe("refusalKindLabel", () => {
  it("reads a navigation, one request and many requests apart", () => {
    expect(refusalKindLabel(refusal({ kind: "document" }))).toBe("переход");
    expect(refusalKindLabel(refusal())).toBe("запрос страницы");
    expect(refusalKindLabel(refusal({ count: 4 }))).toBe("запросы страницы ×4");
  });
});

describe("addressValue", () => {
  it("shows the selected tab while nobody is typing", () => {
    expect(
      addressValue(tab({ url: "https://example.test/app" }), {
        editing: false,
        value: null,
      }),
    ).toBe("https://example.test/app");
  });

  it("lets the draft win while the field is being edited", () => {
    expect(
      addressValue(tab(), { editing: true, value: "second.test/page" }),
    ).toBe("second.test/page");
  });

  it("ignores a draft without a value, and a tab without a url", () => {
    expect(addressValue(tab(), { editing: true, value: null })).toBe(
      "https://example.test/app",
    );
    expect(
      addressValue(tab({ url: "" }), { editing: false, value: null }),
    ).toBe("about:blank");
    expect(addressValue(undefined, { editing: false, value: null })).toBe(
      "about:blank",
    );
  });
});

describe("ownsLease", () => {
  it("answers for this panel, not for any human", () => {
    const state = panelState([tab()], "tab-a");
    const human = withControl(state, {
      owner: "human",
      clientId: OTHER,
      leaseExpiresAt: 1,
    }).session;

    expect(ownsLease(human, OTHER)).toBe(true);
    expect(ownsLease(human, HOLDER)).toBe(false);
    expect(ownsLease(state.session, HOLDER)).toBe(false);
    expect(ownsLease(null, HOLDER)).toBe(false);
  });
});

describe("panelView", () => {
  it("reads the status, the chip and the address off one state", () => {
    const state = withControl(
      panelState([tab(), tab({ id: "tab-b" })], "tab-a"),
      {
        owner: "human",
        clientId: HOLDER,
        leaseExpiresAt: 1,
      },
    );
    const view = panelView(state, false, HOLDER, {
      editing: false,
      value: null,
    });

    expect(view.selected?.id).toBe("tab-a");
    expect(view.ownsControl).toBe(true);
    expect(view.canDrive).toBe(true);
    expect(view.statusLine).toBe("Управляет пользователь");
    expect(view.ownerLabel).toBe("Управляет пользователь");
    expect(view.address).toBe("https://example.test/app");
    expect(view.viewport).toEqual({
      width: 1_440,
      height: 900,
      deviceScaleFactor: 1,
    });
    expect(view.tabCount).toBe(2);
    expect(view.menuControl).toEqual({
      action: "release",
      label: "Вернуть агенту",
      disabled: false,
    });
    expect(view.chipControl?.action).toBe("release");
  });

  it("keeps the menu usable while another panel drives, and disables the chip", () => {
    const state = withControl(panelState([tab()], "tab-a"), {
      owner: "human",
      clientId: OTHER,
      leaseExpiresAt: 1,
    });
    const view = panelView(state, false, HOLDER, {
      editing: false,
      value: null,
    });

    expect(view.canDrive).toBe(false);
    expect(view.chipControl).toEqual({
      action: "take",
      label: "Занято другой панелью",
      disabled: true,
    });
    // Both are disabled while somebody else drives; only the chip says so in
    // words, because the chip is the readout and the menu is the action.
    expect(view.menuControl).toEqual({
      action: "take",
      label: "Взять управление",
      disabled: true,
    });
  });

  it("offers the menu entry but no chip when the deployment disables control", () => {
    const state = panelState([tab()], "tab-a", { humanControlEnabled: false });
    const view = panelView(state, false, HOLDER, {
      editing: false,
      value: null,
    });

    expect(view.chipControl).toBeNull();
    expect(view.menuControl.disabled).toBe(true);
  });

  it("draws a default viewport and an empty stage before the first state", () => {
    const view = panelView(null, true, HOLDER, { editing: false, value: null });

    expect(view.session).toBeNull();
    expect(view.selected).toBeUndefined();
    expect(view.canDrive).toBe(false);
    expect(view.viewport).toEqual(DEFAULT_VIEWPORT);
    expect(view.tabCount).toBe(0);
    expect(view.refusalHeadline).toBeNull();
    expect(view.statusLine).toBe("Получаем состояние…");
    expect(view.emptyMessage).toMatch(/ещё не запускался/u);
  });

  it("has a headline only when something was refused", () => {
    const state = panelState(
      [{ ...tab(), policyRefusals: [refusal({ kind: "document" })] }],
      "tab-a",
    );
    const view = panelView(state, false, HOLDER, {
      editing: false,
      value: null,
    });

    expect(view.refusalHeadline).toBe(
      "Политика Browser не пускает на api.intranet.example.corp",
    );
    expect(view.leadRefusal?.kind).toBe("document");
  });

  it("falls back to the plain lease state when the session has no tab", () => {
    const state = panelState([], null);
    const view = panelView(state, true, HOLDER, {
      editing: false,
      value: null,
    });

    expect(view.selected).toBeUndefined();
    expect(view.statusLine).toBe("Управляет агент");
    expect(view.emptyMessage).toBe("Получаем изображение…");
  });
});
