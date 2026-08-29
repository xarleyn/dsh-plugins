import { describe, expect, it } from "vitest";
import { isExpectedBrowserError } from "../scripts/browser-errors.mjs";

describe("packed browser error classification", () => {
  it.each([
    "Failed to load resource: net::ERR_INCOMPLETE_CHUNKED_ENCODING",
    "WebSocket connection failed: net::ERR_CONNECTION_REFUSED",
    "Failed to load resource: net::ERR_CONNECTION_RESET",
    "WebSocket connection failed: Connection closed before receiving a handshake response",
  ])("allows host outage noise during a deliberate restart: %s", (message) => {
    expect(isExpectedBrowserError({ message, duringHostOutage: true })).toBe(
      true,
    );
  });

  it("does not hide the same network failure outside a deliberate restart", () => {
    expect(
      isExpectedBrowserError({
        message: "WebSocket connection failed: net::ERR_CONNECTION_REFUSED",
        duringHostOutage: false,
      }),
    ).toBe(false);
  });

  it("does not hide unrelated errors during a deliberate restart", () => {
    expect(
      isExpectedBrowserError({
        message: "TypeError: Cannot read properties of undefined",
        duringHostOutage: true,
      }),
    ).toBe(false);
  });
});
