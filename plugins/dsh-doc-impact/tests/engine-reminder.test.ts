import { describe, expect, it } from "vitest";

import {
  buildReminderMessage,
  buildLimitMessage,
} from "../src/engine/reminder.js";
import type { DetectorOptions } from "../src/index.js";

describe("reminder messages", () => {
  it("mentions missing documentation targets and groups rules", () => {
    const message = buildReminderMessage(
      [
        {
          id: "fp1",
          ruleId: "auth",
          direction: "code-to-docs",
          triggerSide: "code",
          targetSide: "docs",
          triggerFiles: ["src/auth/session.ts"],
          targetFiles: ["docs/authentication.md", "docs/missing.md"],
          relation: "documents",
          mode: "require-resolution",
          status: "pending",
          detectedAt: 0,
        },
      ],
      new Set(["src/auth/session.ts", "docs/authentication.md"]),
      "own",
    );
    expect(message).toContain("1 rule");
    expect(message).toContain("does not exist: docs/missing.md");
    expect(message).toContain("reviewed-current");
  });

  it("flags uncertain attribution for concurrent agents (SPEC §49)", () => {
    const message = buildReminderMessage(
      [
        {
          id: "fp1",
          ruleId: "auth",
          direction: "code-to-docs",
          triggerSide: "code",
          targetSide: "docs",
          triggerFiles: ["src/auth/session.ts"],
          targetFiles: ["docs/authentication.md"],
          relation: "documents",
          mode: "remind",
          status: "pending",
          detectedAt: 0,
        },
      ],
      new Set(["docs/authentication.md"]),
      "uncertain",
    );
    expect(message).toContain("changed while this agent was active");
  });

  it("renders the limit notice with rule ids", () => {
    const message = buildLimitMessage(
      [
        {
          id: "fp1",
          ruleId: "auth",
          direction: "code-to-docs",
          triggerSide: "code",
          targetSide: "docs",
          triggerFiles: ["src/auth/session.ts"],
          targetFiles: ["docs/authentication.md"],
          relation: "documents",
          mode: "require-resolution",
          status: "pending",
          detectedAt: 0,
        },
      ],
      2,
    );
    expect(message).toContain("auth");
    expect(message).toContain("docs/authentication.md");
    expect(message).toContain("2 reminder round(s)");
  });
});

describe("detector options", () => {
  it("accepts the enforced selector shape", () => {
    const options: DetectorOptions = {
      selectors: [{ include: ["src/**"], exclude: ["**/*.test.ts"] }],
      maxFiles: 10_000,
    };
    expect(options.selectors[0]!.include).toEqual(["src/**"]);
  });
});
