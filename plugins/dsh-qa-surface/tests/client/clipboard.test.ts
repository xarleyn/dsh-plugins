// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canCopyToClipboard,
  copyTextToClipboard,
} from "../../src/client/clipboard.js";

/**
 * The stand is served over plain HTTP on a LAN address, and there the browser
 * never exposes `navigator.clipboard`. These cases pin which path a copy takes
 * and, above all, that a copy which cannot happen is reported rather than
 * swallowed — the defect was a button that looked like it worked.
 */

type ClipboardStub = { writeText?: (text: string) => Promise<void> };

function setClipboard(clipboard: ClipboardStub | undefined): void {
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: clipboard,
  });
}

function setExecCommand(command: ((id: string) => boolean) | undefined): void {
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: command,
  });
}

afterEach(() => {
  setClipboard(undefined);
  setExecCommand(undefined);
});

describe("QA clipboard copy", () => {
  it("writes through the clipboard API where the browser exposes it", async () => {
    const writeText = vi.fn(async () => undefined);
    setClipboard({ writeText });
    setExecCommand(() => true);
    await expect(copyTextToClipboard("answer")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("answer");
  });

  it("takes the copy command on an insecure page with no clipboard API", async () => {
    setClipboard(undefined);
    const execCommand = vi.fn(() => true);
    setExecCommand(execCommand);
    expect(canCopyToClipboard()).toBe(true);
    await expect(copyTextToClipboard("npm run build")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
    // The throwaway field only existed for the moment of the copy.
    expect(document.querySelectorAll("textarea")).toHaveLength(0);
  });

  it("carries the text into the field it selects", async () => {
    setClipboard(undefined);
    let copiedValue = "";
    setExecCommand(() => {
      copiedValue = document.querySelector("textarea")?.value ?? "";
      return true;
    });
    await expect(copyTextToClipboard("the answer")).resolves.toBe(true);
    expect(copiedValue).toBe("the answer");
  });

  it("still copies by command when the API refuses the write", async () => {
    setClipboard({
      writeText: vi.fn(async () => {
        throw new DOMException("denied");
      }),
    });
    const execCommand = vi.fn(() => true);
    setExecCommand(execCommand);
    await expect(copyTextToClipboard("answer")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("says the copy failed when neither path is there", async () => {
    setClipboard(undefined);
    setExecCommand(undefined);
    expect(canCopyToClipboard()).toBe(false);
    await expect(copyTextToClipboard("answer")).resolves.toBe(false);
  });

  it("says the copy failed when the browser refuses the command", async () => {
    setClipboard(undefined);
    setExecCommand(() => false);
    await expect(copyTextToClipboard("answer")).resolves.toBe(false);
  });
});
