/**
 * The launch-token bridge, on its own.
 *
 * The `/qa` route asks this source on every cookie-less navigation, so its one
 * interesting property is what happens between the first request — which can
 * race plugin init, before `connection` is answerable — and the next one.
 */
import { describe, expect, it, vi } from "vitest";

import { makeLaunchTokenSource } from "../../src/launch-token.js";

/** A connection service that answers with a token. */
function connection(token: string) {
  return {
    authenticatedUrl: (baseUrl: string) => `${baseUrl}/?token=${token}`,
  };
}

describe("launch-token bridge", () => {
  it("reads the token out of the host's authenticated url", () => {
    const warn = vi.fn();
    expect(makeLaunchTokenSource(() => connection("secret"), warn)()).toBe(
      "secret",
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("drops the host and scheme the host's url carries", () => {
    const source = makeLaunchTokenSource(
      () => ({
        authenticatedUrl: () => "https://stand.example.test:8443/?token=t#x",
      }),
      vi.fn(),
    );
    expect(source()).toBe("t");
  });

  it("asks once for a token it resolved: the launch token is stable", () => {
    const getConnection = vi.fn(() => connection("secret"));
    const source = makeLaunchTokenSource(getConnection, vi.fn());

    expect(source()).toBe("secret");
    expect(source()).toBe("secret");
    expect(getConnection).toHaveBeenCalledOnce();
  });

  it("retries a connection service that was not ready at the first request", () => {
    const answers: (ReturnType<typeof connection> | undefined)[] = [
      undefined,
      connection("late"),
    ];
    const warn = vi.fn();
    const source = makeLaunchTokenSource(() => answers.shift(), warn);

    // The navigation that raced plugin init falls back to the marker hand-off…
    expect(source()).toBeUndefined();
    // …and the next one must still install the cookie, or every later browser
    // without the host cookie dead-ends at the token screen for this process.
    expect(source()).toBe("late");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("retries an authenticated url that carried no token, and a bridge that threw", () => {
    const noToken = { authenticatedUrl: () => "http://127.0.0.1/" };
    const throwing = {
      authenticatedUrl: () => {
        throw new Error("connection not ready");
      },
    };
    const answers: unknown[] = [noToken, throwing, connection("finally")];
    const warn = vi.fn();
    const source = makeLaunchTokenSource(
      () => answers.shift() as ReturnType<typeof connection> | undefined,
      warn,
    );

    expect(source()).toBeUndefined();
    expect(source()).toBeUndefined();
    expect(source()).toBe("finally");
    // One line per kind of failure, not one per navigation.
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("reports a missing bridge once and keeps retrying quietly", () => {
    const warn = vi.fn();
    const source = makeLaunchTokenSource(() => undefined, warn);

    expect(source()).toBeUndefined();
    expect(source()).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatch(/no connection\.authenticatedUrl/u);
  });
});
