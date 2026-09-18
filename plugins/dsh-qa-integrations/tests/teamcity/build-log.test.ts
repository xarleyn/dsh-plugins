import { IntegrationError } from "../../src/errors.js";
import { TeamcityProvider } from "../../src/providers/teamcity/index.js";
import {
  logMode,
  sanitizeLog,
  selectLogWindow,
} from "../../src/providers/teamcity/logs.js";
import { config, credentialFor, stub, TOKEN } from "./shared.js";

describe("teamcity build log", () => {
  const LOG = [
    "\u001B[32mStarting build\u001B[0m",
    "compiling…",
    "ERROR: cannot find symbol",
    "  at com.example.Main.main(Main.java:10)",
    "token=abcdefghijklmnopqrstuvwxyz012345",
    "BUILD FAILED",
  ].join("\n");

  it("returns the tail of the log, cleaned and redacted", async () => {
    const { calls, fetcher } = stub(() => ({ text: LOG }));
    const provider = new TeamcityProvider(config(), fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(fetcher) },
      "builds.log",
      { buildId: 5, mode: "tail", maxLines: 3 },
    )) as Record<string, unknown>;
    expect(calls[0]?.url.pathname).toBe("/downloadBuildLog.html");
    expect(calls[0]?.url.searchParams.get("buildId")).toBe("5");
    expect(calls[0]?.url.searchParams.get("plain")).toBe("true");
    expect(answer["returnedLines"]).toBe(3);
    expect(answer["truncated"]).toBe(true);
    expect(answer["logTruncated"]).toBe(false);
    const text = String(answer["text"]);
    // Terminal colouring is gone, and a printed secret is not handed over.
    expect(text).not.toContain("\u001B");
    expect(text).not.toContain(TOKEN);
    expect(text).toContain("[REDACTED]");
    expect(text.endsWith("BUILD FAILED")).toBe(true);
  });

  it("finds lines the model asks about, with context and gap markers", async () => {
    const { fetcher } = stub(() => ({ text: LOG }));
    const provider = new TeamcityProvider(config(), fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(fetcher) },
      "builds.log",
      { buildId: 5, mode: "search", query: "ERROR", maxLines: 10 },
    )) as Record<string, unknown>;
    expect(answer["matched"]).toBe(1);
    expect(String(answer["text"])).toContain("cannot find symbol");
    expect(String(answer["text"])).toContain("compiling");
    // A required query is the one thing search cannot do without.
    await expect(
      provider.execute({ credential: credentialFor(fetcher) }, "builds.log", {
        buildId: 5,
        mode: "search",
      }),
    ).rejects.toMatchObject({ code: "InvalidRequest" });
    expect(() => logMode("middle")).toThrow(IntegrationError);
  });

  it("says so when the log is longer than the deployment download budget", async () => {
    const big = Array.from(
      { length: 4_000 },
      (_, index) => `line ${index}`,
    ).join("\n");
    const { fetcher } = stub(() => ({ text: big }));
    const provider = new TeamcityProvider(
      config({ maxLogBytes: 2_048, maxLogLines: 100 }),
      fetcher,
    );
    const answer = (await provider.execute(
      { credential: credentialFor(fetcher) },
      "builds.log",
      { buildId: 5, mode: "tail", maxLines: 5 },
    )) as Record<string, unknown>;
    expect(answer["logTruncated"]).toBe(true);
    expect(answer["returnedLines"]).toBe(5);
    // The window is the end of what was downloaded, and the answer says so.
    expect(String(answer["text"]).split("\n")).toHaveLength(5);
  });

  it("never answers with more lines than the deployment allows", async () => {
    const { fetcher } = stub(() => ({ text: "a\nb\nc\nd\ne" }));
    const provider = new TeamcityProvider(config({ maxLogLines: 2 }), fetcher);
    const answer = (await provider.execute(
      { credential: credentialFor(fetcher) },
      "builds.log",
      { buildId: 5, maxLines: 500 },
    )) as Record<string, unknown>;
    expect(answer["returnedLines"]).toBe(2);
  });

  it("strips what a log can carry and repairs what cannot be encoded", () => {
    const cleaned = sanitizeLog(
      "a\u001B[31mb\u001B[0m\u0007c\r\nd\uD800e\u001B]0;title\u0007f",
    );
    expect(cleaned).toBe("abc\nd\uFFFDe f".replace(" f", "f"));
    expect(selectLogWindow("x\ny\nz", "head", 2, undefined).text).toBe("x\ny");
    expect(selectLogWindow("x\ny\nz", "tail", 2, undefined).text).toBe("y\nz");
  });
});
