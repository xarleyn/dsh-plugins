import type { SessionLogSnapshot, SessionRecord } from "@deepseek-ai/dsh-session-query";
import { describe, expect, it, vi } from "vitest";
import { SessionSource } from "../src/dsh/sessions.js";
import { header } from "./fixtures/sessions.js";

describe("SessionSource", () => {
  it("filters the logical corpus by workspace and delegates detached reads", async () => {
    const wanted = header("wanted", "C:\\work\\project");
    const other = header("other", "C:\\work\\other");
    const records = [wanted, other].map(
      (value) => ({ header: value, live: false, persisted: true }) as SessionRecord,
    );
    const snapshot = { session: wanted, events: [] } as SessionLogSnapshot;
    const readSession = vi.fn(async () => snapshot);
    const source = new SessionSource({
      async listSessions() {
        return records;
      },
      readSession,
    });

    await expect(source.list({ cwd: "C:\\work\\project" })).resolves.toEqual([records[0]]);
    await expect(source.read("wanted")).resolves.toBe(snapshot);
    expect(readSession).toHaveBeenCalledWith("wanted");
  });

  it("applies date range and newest-session limit after workspace filtering", async () => {
    const records = [3, 2, 1].map((createdAt) => ({
      header: { ...header(`session-${createdAt}`), createdAt },
      live: false,
      persisted: true,
    })) as SessionRecord[];
    const source = new SessionSource({
      async listSessions() {
        return records;
      },
      async readSession() {
        throw new Error("not used");
      },
    });
    const result = await source.list({
      cwd: "C:\\work\\project",
      from: 2,
      to: 3,
      lastSessions: 1,
    });
    expect(result.map(({ header: value }) => value.id)).toEqual(["session-3"]);
  });
});
