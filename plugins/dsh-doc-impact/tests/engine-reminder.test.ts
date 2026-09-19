import { describe, expect, it } from "vitest";

import {
  DEFAULT_LIMIT_TEMPLATE,
  DEFAULT_REMINDER_TEMPLATE,
  buildReminderMessage,
  buildLimitMessage,
} from "../src/engine/reminder.js";
import type { DetectorOptions } from "../src/index.js";

const SINGLE_IMPACT = {
  id: "fp1",
  ruleId: "auth",
  direction: "code-to-docs" as const,
  triggerSide: "code" as const,
  targetSide: "docs" as const,
  triggerFiles: ["src/auth/session.ts"],
  targetFiles: ["docs/authentication.md"],
  relation: "documents" as const,
  mode: "remind" as const,
  status: "pending" as const,
  detectedAt: 0,
};

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

  it("reproduces the legacy layout with the default templates", () => {
    const message = buildReminderMessage([SINGLE_IMPACT], new Set(), "own");
    const lines = message.split("\n");
    expect(lines[0]).toBe("Documentation impact check");
    expect(message).toContain(
      "Your changes affect documentation linked by project rules.",
    );
    expect(message).toContain("Update the documents if behavior changed.");
    // Header, intro, count, body, tail stay in order with blank separators.
    const introAt = lines.indexOf(
      "Your changes affect documentation linked by project rules.",
    );
    const countAt = lines.indexOf("1 rule was triggered.");
    const bodyAt = lines.findIndex((line) => line.startsWith("1. auth"));
    const tailAt = lines.indexOf("Update the documents if behavior changed.");
    expect(introAt).toBeGreaterThan(0);
    expect(countAt).toBeGreaterThan(introAt);
    expect(bodyAt).toBeGreaterThan(countAt);
    expect(tailAt).toBeGreaterThan(bodyAt);

    const limit = buildLimitMessage([SINGLE_IMPACT], 2);
    expect(limit.split("\n")[0]).toBe(
      "Documentation impact check: reminder limit reached",
    );
  });

  it("renders a custom reminder template around the generated payload", () => {
    const message = buildReminderMessage(
      [SINGLE_IMPACT],
      new Set(),
      "own",
      "Проверь документацию!\n\n{count}\n\n{body}\n\n{tail}",
    );
    expect(message.startsWith("Проверь документацию!")).toBe(true);
    expect(message).toContain("1 rule was triggered.");
    expect(message).toContain("1. auth");
    expect(message).toContain("Update the documents if behavior changed.");
    expect(message).not.toContain("Documentation impact check");
  });

  it("keeps unknown placeholders verbatim and drops the header by omission", () => {
    const message = buildReminderMessage(
      [SINGLE_IMPACT],
      new Set(),
      "own",
      "{body} {unknown-token}",
    );
    expect(message.startsWith("1. auth")).toBe(true);
    expect(message.endsWith(" {unknown-token}")).toBe(true);
  });

  it("falls back to the default template when the payload placeholder is missing", () => {
    const fallback = buildReminderMessage(
      [SINGLE_IMPACT],
      new Set(),
      "own",
      "No payload here",
    );
    expect(fallback).toBe(
      buildReminderMessage([SINGLE_IMPACT], new Set(), "own"),
    );

    const limitFallback = buildLimitMessage(
      [SINGLE_IMPACT],
      3,
      "rounds: {rounds}",
    );
    expect(limitFallback).toContain("3 reminder round(s)");
    expect(limitFallback).toContain("Documentation impact check: reminder");
  });

  it("exposes defaults that carry their own required placeholders", () => {
    expect(DEFAULT_REMINDER_TEMPLATE).toContain("{body}");
    expect(DEFAULT_LIMIT_TEMPLATE).toContain("{impacts}");
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
