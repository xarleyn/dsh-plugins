// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  QaHeader,
  type QaHeaderProps,
} from "../../../src/client/components/QaHeader.js";
import { QaThemeSwitcher } from "../../../src/client/components/QaThemeSwitcher.js";
import {
  QA_DARK_THEME_ATTRIBUTE,
  QA_THEME_PREFERENCES,
  applyQaThemePreference,
  readQaThemePreference,
  readQaThemeScheme,
  resolveQaThemeScheme,
  useQaThemePreference,
  writeQaThemePreference,
  type QaThemeDocument,
  type QaThemePreference,
} from "../../../src/client/theme-preference.js";

const STORAGE_KEY = "dsh-qa-surface.session:v1:/qa:theme";

/** The two document nodes the palette hangs on, recorded instead of painted. */
function fakeThemeDocument(): QaThemeDocument & { readonly writes: string[] } {
  const writes: string[] = [];
  let dark = false;
  return {
    writes,
    documentElement: {
      style: {
        set colorScheme(value: string) {
          writes.push(`color-scheme:${value}`);
        },
      },
    },
    body: {
      hasAttribute: (name: string) => name === QA_DARK_THEME_ATTRIBUTE && dark,
      setAttribute(name, value) {
        writes.push(`${name}=${value || "(empty)"}`);
        dark = true;
      },
      removeAttribute(name) {
        writes.push(`-${name}`);
        dark = false;
      },
    },
  };
}

interface FakeColorSchemeQuery {
  readonly matches: boolean;
  readonly set: (dark: boolean) => void;
}

/**
 * A `prefers-color-scheme` the test can flip. jsdom implements no `matchMedia`
 * at all, so without this the surface would only ever see the guarded
 * no-query path and «Системная тема» could not be proved to follow the OS.
 */
function stubPrefersColorScheme(initial: boolean): FakeColorSchemeQuery {
  const listeners = new Set<() => void>();
  let matches = initial;
  const query = {
    get matches(): boolean {
      return matches;
    },
    addEventListener: (_type: string, listener: () => void): void => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: () => void): void => {
      listeners.delete(listener);
    },
    set: (dark: boolean): void => {
      matches = dark;
      for (const listener of listeners) listener();
    },
  };
  vi.stubGlobal("matchMedia", () => query);
  return {
    get matches() {
      return query.matches;
    },
    set: query.set,
  };
}

function paintState(): { scheme: string; dark: boolean } {
  return {
    scheme: document.documentElement.style.colorScheme,
    dark: document.body.hasAttribute(QA_DARK_THEME_ATTRIBUTE),
  };
}

function resetDocument(): void {
  document.documentElement.style.colorScheme = "";
  document.body.removeAttribute(QA_DARK_THEME_ATTRIBUTE);
}

/** The hook and the control over it, mounted as one surface fragment. */
function Harness({ active = true }: { readonly active?: boolean }) {
  const theme = useQaThemePreference({
    active,
    storage: window.localStorage,
    storageKey: STORAGE_KEY,
  });
  return (
    <QaThemeSwitcher preference={theme.preference} onSelect={theme.select} />
  );
}

function press(label: string): void {
  fireEvent.click(screen.getByRole("button", { name: label }));
}

const THEME_LABELS = ["Светлая тема", "Тёмная тема", "Системная тема"] as const;

/** The preferences the control currently marks as chosen. */
function pressedThemes(): string[] {
  return THEME_LABELS.filter(
    (label) =>
      screen
        .getByRole("button", { name: label })
        .getAttribute("aria-pressed") === "true",
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetDocument();
  window.localStorage.clear();
});

describe("QA theme preference", () => {
  it("offers the three preferences the Host uses", () => {
    expect(QA_THEME_PREFERENCES).toEqual(["light", "dark", "system"]);
  });

  it("resolves each preference to one painted scheme", () => {
    // A fixed preference is itself whatever the OS asks for; only `system`
    // hands the answer over.
    expect(resolveQaThemeScheme("light", true)).toBe("light");
    expect(resolveQaThemeScheme("dark", false)).toBe("dark");
    expect(resolveQaThemeScheme("system", false)).toBe("light");
    expect(resolveQaThemeScheme("system", true)).toBe("dark");
  });

  it("writes the two document fields the Host palette selects on", () => {
    const cases: readonly {
      readonly preference: QaThemePreference;
      readonly systemDark: boolean;
      readonly writes: readonly string[];
    }[] = [
      {
        preference: "light",
        systemDark: true,
        writes: ["color-scheme:light", "-data-ds-dark-theme"],
      },
      {
        preference: "dark",
        systemDark: false,
        writes: ["color-scheme:dark", "data-ds-dark-theme=(empty)"],
      },
      {
        preference: "system",
        systemDark: false,
        writes: ["color-scheme:light", "-data-ds-dark-theme"],
      },
      {
        preference: "system",
        systemDark: true,
        writes: ["color-scheme:dark", "data-ds-dark-theme=(empty)"],
      },
    ];
    for (const testCase of cases) {
      const target = fakeThemeDocument();
      applyQaThemePreference(target, testCase.preference, testCase.systemDark);
      expect(target.writes).toEqual(testCase.writes);
    }
  });

  it("keeps only a stored preference and survives denied storage", () => {
    const stored = new Map<string, string>();
    const bag = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => {
        stored.set(key, value);
      },
    };
    expect(readQaThemePreference(bag, STORAGE_KEY)).toBeNull();
    writeQaThemePreference(bag, STORAGE_KEY, "dark");
    expect(readQaThemePreference(bag, STORAGE_KEY)).toBe("dark");

    stored.set(STORAGE_KEY, "neon");
    expect(readQaThemePreference(bag, STORAGE_KEY)).toBeNull();

    const refusing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readQaThemePreference(refusing, STORAGE_KEY)).toBeNull();
    expect(() => {
      writeQaThemePreference(refusing, STORAGE_KEY, "light");
    }).not.toThrow();
  });

  it("reads the painted palette back through the Host contract", () => {
    // The Host publishes its *preference* nowhere in the DOM — only the
    // resolved palette — so this is all an untouched control can honestly show.
    const target = fakeThemeDocument();
    expect(readQaThemeScheme(target)).toBe("light");
    target.body.setAttribute(QA_DARK_THEME_ATTRIBUTE, "");
    expect(readQaThemeScheme(target)).toBe("dark");
    target.body.removeAttribute(QA_DARK_THEME_ATTRIBUTE);
    expect(readQaThemeScheme(target)).toBe("light");
  });
});

describe("QA theme switcher", () => {
  it("renders three named options and marks the chosen one", () => {
    render(<QaThemeSwitcher preference="system" onSelect={() => undefined} />);
    const group = screen.getByRole("group", { name: "Тема оформления" });
    expect(group.querySelectorAll("button")).toHaveLength(3);
    for (const [label, pressed] of [
      ["Светлая тема", false],
      ["Тёмная тема", false],
      ["Системная тема", true],
    ] as const) {
      expect(
        screen
          .getByRole("button", { name: label })
          .getAttribute("aria-pressed"),
      ).toBe(String(pressed));
    }
  });

  it("hands the clicked preference over", () => {
    const picked: QaThemePreference[] = [];
    render(
      <QaThemeSwitcher
        preference="light"
        onSelect={(preference) => {
          picked.push(preference);
        }}
      />,
    );
    press("Тёмная тема");
    press("Системная тема");
    expect(picked).toEqual(["dark", "system"]);
  });
});

describe("QA palette in the surface", () => {
  beforeEach(resetDocument);

  it("writes nothing while this browser has no choice", () => {
    // What the Host's own boot script leaves behind: a resolved palette and no
    // published preference. The surface must not touch either — a visitor who
    // never reached for the control leaves the stand as it was configured, and
    // a default `system` here would silently repaint it from the OS.
    document.documentElement.style.colorScheme = "dark";
    document.body.setAttribute(QA_DARK_THEME_ATTRIBUTE, "");
    render(<Harness />);
    expect(paintState()).toEqual({ scheme: "dark", dark: true });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    // The control reports the palette the visitor is looking at, and claims no
    // preference nobody picked.
    expect(
      screen
        .getByRole("button", { name: "Тёмная тема" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Системная тема" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("restores this browser's choice over the palette the page booted with", () => {
    window.localStorage.setItem(STORAGE_KEY, "light");
    document.documentElement.style.colorScheme = "dark";
    document.body.setAttribute(QA_DARK_THEME_ATTRIBUTE, "");
    render(<Harness />);
    expect(paintState()).toEqual({ scheme: "light", dark: false });
  });

  it("switches through all three themes and keeps the choice", () => {
    stubPrefersColorScheme(false);
    render(<Harness />);

    press("Тёмная тема");
    expect(paintState()).toEqual({ scheme: "dark", dark: true });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("dark");

    press("Светлая тема");
    expect(paintState()).toEqual({ scheme: "light", dark: false });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("light");

    press("Системная тема");
    expect(paintState()).toEqual({ scheme: "light", dark: false });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("system");
    // The pressed cube names the preference, not the resolved palette.
    expect(
      screen
        .getByRole("button", { name: "Системная тема" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("follows the OS while the choice is system", () => {
    const os = stubPrefersColorScheme(false);
    window.localStorage.setItem(STORAGE_KEY, "system");
    render(<Harness />);
    expect(paintState()).toEqual({ scheme: "light", dark: false });

    act(() => {
      os.set(true);
    });
    expect(paintState()).toEqual({ scheme: "dark", dark: true });
  });

  it("leaves the document alone off its own route", () => {
    // Outside /qa the overlay is mounted and invisible; painting from there
    // would be the QA stand restyling the harness behind the visitor's back.
    window.localStorage.setItem(STORAGE_KEY, "dark");
    render(<Harness active={false} />);
    expect(paintState()).toEqual({ scheme: "", dark: false });
  });

  it("hands the palette back when the route goes away", async () => {
    // The choice owns the document only while the surface is what the visitor
    // sees, and then has to give it back: once off-route the control is not on
    // screen anywhere to undo what it did, so a harness left recolored would
    // stay recolored for the rest of the visit. The empty `color-scheme` also
    // proves the restore puts back what was *worn* rather than painting light.
    window.localStorage.setItem(STORAGE_KEY, "dark");
    const { rerender } = render(<Harness />);
    expect(paintState()).toEqual({ scheme: "dark", dark: true });
    // The restore itself is synchronous; the control's subscribed read answers
    // it in a microtask, so the act is awaited.
    await act(async () => {
      rerender(<Harness active={false} />);
    });
    expect(paintState()).toEqual({ scheme: "", dark: false });
  });

  it("hands the palette back when the surface unmounts", () => {
    window.localStorage.setItem(STORAGE_KEY, "light");
    document.documentElement.style.colorScheme = "dark";
    document.body.setAttribute(QA_DARK_THEME_ATTRIBUTE, "");
    const { unmount } = render(<Harness />);
    expect(paintState()).toEqual({ scheme: "light", dark: false });
    unmount();
    expect(paintState()).toEqual({ scheme: "dark", dark: true });
  });

  it("follows a palette the Host repaints under an untouched control", async () => {
    // A browser with no choice of its own writes nothing, so the cube answers
    // the document — including a repaint nobody told React about, which is why
    // the painted palette is subscribed to rather than read while rendering.
    render(<Harness />);
    expect(pressedThemes()).toEqual(["Светлая тема"]);
    await act(async () => {
      document.body.setAttribute(QA_DARK_THEME_ATTRIBUTE, "");
    });
    expect(pressedThemes()).toEqual(["Тёмная тема"]);
    await act(async () => {
      document.body.removeAttribute(QA_DARK_THEME_ATTRIBUTE);
    });
    expect(pressedThemes()).toEqual(["Светлая тема"]);
  });
});

describe("header palette control", () => {
  const BASE: QaHeaderProps = {
    logoUrl: null,
    title: "Чат",
    viewingSubagent: false,
    onCloseSubagent: () => undefined,
    agentCount: 0,
    agentsOpen: false,
    onToggleAgents: () => undefined,
    sourcesVisible: true,
    sourcesCount: 0,
    sourcesComplete: true,
    sourcesOpen: false,
    onOpenSources: () => undefined,
    fileCount: 0,
    filesEnabled: false,
    filesOpen: false,
    onOpenFiles: () => undefined,
    showReset: false,
    resetDisabled: false,
    onReset: () => undefined,
  };

  it("keeps the palette control beside the role control", () => {
    const { container } = render(
      <QaHeader
        {...BASE}
        roleSelector={<span data-testid="role">Роль</span>}
        themeSwitcher={
          <QaThemeSwitcher preference="dark" onSelect={() => undefined} />
        }
      />,
    );
    const row = container.querySelector(".dsh-qa-header__title-row");
    const theme = container.querySelector(".dsh-qa-theme");
    expect(row?.contains(theme ?? null)).toBe(true);
    expect(theme?.previousElementSibling?.getAttribute("data-testid")).toBe(
      "role",
    );
    // Not in the right-hand action cluster, which is what runs off the edge of
    // a phone-sized header first.
    expect(
      container
        .querySelector(".dsh-qa-header__actions")
        ?.contains(theme ?? null),
    ).toBe(false);
  });
});
