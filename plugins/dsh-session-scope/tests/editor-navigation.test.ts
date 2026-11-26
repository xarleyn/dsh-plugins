// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ScopeEditor } from "../src/client/scope-editor.js";

const workspace = "/demo";
function listing(path: string, children: string[] = []) {
  const parts = path.slice(1).split("/");
  return {
    ok: true,
    value: {
      path,
      crumbs: parts.map((name, index) => ({
        name,
        path: "/" + parts.slice(0, index + 1).join("/"),
      })),
      entries: children.map((name) => ({ name, path: path + "/" + name })),
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

it("ignores a save completing after its editor was closed", async () => {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  const onClose = vi.fn();
  let complete!: (value: { ok: boolean }) => void;
  const runCommand = vi.fn(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  try {
    await act(async () => {
      root.render(
        createElement(ScopeEditor, {
          sessionId: "first",
          workspaceRoot: workspace,
          scopeMode: "full",
          scopeRoots: [],
          runCommand,
          listLevel: async () => listing(workspace),
          onClose,
        }),
      );
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".wss-btnDanger")!.click();
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".wss-btnPrimary")!.click();
    });
    expect(runCommand).toHaveBeenCalledOnce();
    await act(async () => {
      root.render(null);
    });
    await act(async () => {
      complete({ ok: true });
    });
    expect(onClose).not.toHaveBeenCalled();
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
});

it("keeps the latest breadcrumb when earlier directory reads finish afterwards", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const middle = workspace + "/a";
  let firstVisit = true;
  let resume!: (value: ReturnType<typeof listing>) => void;
  const listLevel = vi.fn(async (_session: string, path: string) => {
    if (path === workspace) return listing(path, ["a"]);
    if (path === middle && firstVisit) {
      firstVisit = false;
      return listing(path, ["b"]);
    }
    if (path === middle)
      return new Promise<ReturnType<typeof listing>>((resolve) => {
        resume = resolve;
      });
    return listing(path);
  });
  const click = async (element: Element | undefined) => {
    expect(element).toBeInstanceOf(HTMLElement);
    await act(async () => {
      (element as HTMLElement).click();
    });
  };
  try {
    await act(async () => {
      root.render(
        createElement(ScopeEditor, {
          sessionId: "demo",
          workspaceRoot: workspace,
          scopeMode: "focused",
          scopeRoots: [],
          runCommand: vi.fn(),
          listLevel,
          onClose: vi.fn(),
        }),
      );
    });
    await click([...document.querySelectorAll(".wss-row")].at(-1));
    await click([...document.querySelectorAll(".wss-row")].at(-1));
    expect(document.querySelectorAll(".wss-crumb")).toHaveLength(3);
    await click(document.querySelectorAll(".wss-crumb")[1]);
    await click(document.querySelectorAll(".wss-crumb")[0]);
    await act(async () => {
      resume(listing(middle, ["b"]));
    });
    expect(
      [...document.querySelectorAll(".wss-crumb")].map((el) => el.textContent),
    ).toEqual(["."]);
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
});
