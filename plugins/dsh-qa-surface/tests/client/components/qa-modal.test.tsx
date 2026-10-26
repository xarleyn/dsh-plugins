// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isQaModalOpen,
  QaModal,
} from "../../../src/client/components/QaModal.js";

afterEach(cleanup);

describe("QA modal focus lifetime", () => {
  it("leaves Escape to an expanded control inside the dialog", () => {
    const close = vi.fn();
    render(
      <QaModal
        open
        title="Demo settings"
        closeLabel="Close settings"
        onClose={close}
      >
        <input
          role="combobox"
          aria-expanded="true"
          aria-label="Choose option"
        />
      </QaModal>,
    );
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
  });

  it("owns Escape before a Host tooltip consumes document capture", () => {
    const close = vi.fn();
    const tooltip = (event: KeyboardEvent) => {
      if (event.key === "Escape") event.stopPropagation();
    };
    document.addEventListener("keydown", tooltip, true);
    try {
      render(
        <QaModal
          open
          title="Demo history"
          closeLabel="Close history"
          onClose={close}
        >
          History
        </QaModal>,
      );
      fireEvent.keyDown(screen.getByRole("button", { name: "Close history" }), {
        key: "Escape",
      });
      expect(close).toHaveBeenCalledOnce();
    } finally {
      document.removeEventListener("keydown", tooltip, true);
    }
  });

  it("keeps a field's focus and caret when its parent changes the close callback", () => {
    const firstClose = vi.fn();
    const latestClose = vi.fn();
    const content = (
      <input aria-label="Demo access token" defaultValue="demo-token" />
    );
    const mounted = render(
      <QaModal
        open
        title="Demo settings"
        closeLabel="Close demo settings"
        onClose={firstClose}
      >
        {content}
      </QaModal>,
    );
    const field = screen.getByRole("textbox", {
      name: "Demo access token",
    }) as HTMLInputElement;
    field.focus();
    field.setSelectionRange(3, 3);
    mounted.rerender(
      <QaModal
        open
        title="Updated demo settings"
        closeLabel="Close demo settings"
        onClose={latestClose}
      >
        {content}
      </QaModal>,
    );
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(3);
    expect(field.selectionEnd).toBe(3);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(firstClose).not.toHaveBeenCalled();
    expect(latestClose).toHaveBeenCalledOnce();
  });

  it("lets a controlled field keep typing through parent state updates", () => {
    function Parent() {
      const [value, setValue] = useState("");
      const [open, setOpen] = useState(true);
      return (
        <QaModal
          open={open}
          title="Demo settings"
          closeLabel="Close demo settings"
          onClose={() => setOpen(false)}
        >
          <input
            aria-label="Demo access token"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </QaModal>
      );
    }
    render(<Parent />);
    const field = screen.getByRole("textbox", {
      name: "Demo access token",
    }) as HTMLInputElement;
    field.focus();
    for (const value of ["d", "de", "demo-token"]) {
      expect(document.activeElement).toBe(field);
      fireEvent.change(document.activeElement!, { target: { value } });
      expect(document.activeElement).toBe(field);
      expect(field.value).toBe(value);
      expect(field.selectionStart).toBe(value.length);
    }
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the nested modal on top across outer callback updates", () => {
    const originalOuterClose = vi.fn();
    const latestOuterClose = vi.fn();
    const innerClose = vi.fn();
    const view = (innerOpen: boolean, outerClose: () => void) => (
      <QaModal
        open
        title="Outer demo"
        closeLabel="Close outer demo"
        onClose={outerClose}
      >
        <QaModal
          open={innerOpen}
          title="Inner demo"
          closeLabel="Close inner demo"
          onClose={innerClose}
        >
          <input aria-label="Inner demo field" />
        </QaModal>
      </QaModal>
    );
    const mounted = render(view(false, originalOuterClose));
    mounted.rerender(view(true, originalOuterClose));
    const field = screen.getByRole("textbox", { name: "Inner demo field" });
    field.focus();
    mounted.rerender(view(true, latestOuterClose));
    expect(document.activeElement).toBe(field);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(innerClose).toHaveBeenCalledOnce();
    expect(originalOuterClose).not.toHaveBeenCalled();
    expect(latestOuterClose).not.toHaveBeenCalled();
    mounted.rerender(view(false, latestOuterClose));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(latestOuterClose).toHaveBeenCalledOnce();
    expect(innerClose).toHaveBeenCalledOnce();
  });

  it("focuses the close control on each opening and removes closed dialogs from the stack", () => {
    const close = vi.fn();
    const view = (open: boolean) => (
      <QaModal
        open={open}
        title="Demo settings"
        closeLabel="Close demo settings"
        onClose={close}
      >
        <input aria-label="Demo field" />
      </QaModal>
    );
    const mounted = render(view(false));
    expect(isQaModalOpen()).toBe(false);
    mounted.rerender(view(true));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close demo settings" }),
    );
    screen.getByRole("textbox", { name: "Demo field" }).focus();
    mounted.rerender(view(false));
    expect(isQaModalOpen()).toBe(false);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
    mounted.rerender(view(true));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close demo settings" }),
    );
    mounted.unmount();
    expect(isQaModalOpen()).toBe(false);
  });
});
