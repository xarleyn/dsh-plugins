/**
 * The twelve evaluation scenarios (SPEC §33.2). Each scenario builds a
 * replayable session and labels its tool-result candidates; the danger axis
 * marks scenarios whose `must-keep` rows look prune-worthy to deterministic
 * signals (old, large, cheap-looking) — those catch a dangerous prune.
 */

import type { DshSession } from "./fixtures.js";
import type { CandidateLabel } from "./fixtures.js";
import { appendEvalStep, appendUserText, newSession } from "./fixtures.js";

export type Label = CandidateLabel;

export interface EvalScenario {
  readonly id: string;
  readonly danger: "low" | "medium" | "high";
  readonly intent: string;
  /** callId → expected action grade. */
  readonly labels: Readonly<Record<string, Label>>;
  build(): DshSession;
}

export const SCENARIOS: readonly EvalScenario[] = [
  {
    id: "01-reread-same-file",
    danger: "low",
    intent: "repeated reads of one path; only the newest read matters",
    labels: {
      "call-1": "safe-to-stub",
      "call-2": "safe-to-stub",
      "call-3": "must-keep",
    },
    build() {
      const session = newSession("eval-01");
      appendEvalStep(session, 1, "call-1", {
        name: "read",
        args: '{"path":"src/demo/auth.ts"}',
        chars: 4000,
      });
      appendEvalStep(session, 2, "call-2", {
        name: "read",
        args: '{"path":"src/demo/auth.ts"}',
        chars: 4000,
      });
      appendEvalStep(session, 3, "call-3", {
        name: "read",
        args: '{"path":"src/demo/auth.ts"}',
        chars: 4000,
      });
      appendUserText(session, "Now refactor the token rotation, please.");
      return session;
    },
  },
  {
    id: "02-edit-invalidates-read",
    danger: "low",
    intent:
      "a read before an edit is stale; the read after the edit is evidence",
    labels: { "call-1": "safe-to-stub", "call-2": "must-keep" },
    build() {
      const session = newSession("eval-02");
      appendEvalStep(session, 1, "call-1", {
        name: "read",
        args: '{"path":"src/demo/session.ts"}',
        chars: 4000,
      });
      appendEvalStep(session, 2, "call-edit", {
        name: "edit",
        args: '{"path":"src/demo/session.ts"}',
        chars: 600,
      });
      appendEvalStep(session, 3, "call-2", {
        name: "read",
        args: '{"path":"src/demo/session.ts"}',
        chars: 4000,
      });
      return session;
    },
  },
  {
    id: "03-edit-invalidates-many",
    danger: "medium",
    intent: "one edit invalidates five older reads at once",
    labels: {
      "call-1": "safe-to-stub",
      "call-2": "safe-to-stub",
      "call-3": "safe-to-stub",
      "call-4": "safe-to-stub",
      "call-5": "safe-to-stub",
      "call-6": "must-keep",
    },
    build() {
      const session = newSession("eval-03");
      for (let index = 1; index <= 5; index += 1) {
        appendEvalStep(session, index, `call-${index}`, {
          name: "read",
          args: `{"path":"src/demo/mod${index}.ts"}`,
          chars: 3000,
        });
      }
      appendEvalStep(session, 6, "call-edit", {
        name: "edit",
        args: '{"path":"src/demo/"}',
        chars: 800,
      });
      appendEvalStep(session, 7, "call-6", {
        name: "grep",
        args: '{"pattern":"refreshToken"}',
        chars: 2000,
      });
      return session;
    },
  },
  {
    id: "04-long-grep",
    danger: "low",
    intent: "one huge search result never cited again",
    labels: { "call-1": "safe-to-truncate" },
    build() {
      const session = newSession("eval-04");
      appendEvalStep(session, 1, "call-1", {
        name: "grep",
        args: '{"pattern":"TODO"}',
        chars: 20000,
      });
      appendUserText(session, "Summarize what you found.");
      // The live tail: a small later-turn step keeps the current turn distinct
      // from the pruned history, as in a real session.
      appendEvalStep(session, 90, "call-live", {
        name: "read",
        args: '{"path":"src/demo/live.ts"}',
        chars: 200,
      });
      return session;
    },
  },
  {
    id: "05-grep-cited-later",
    danger: "high",
    intent:
      "the search result the user explicitly asks about — old and big, but load-bearing",
    labels: { "call-1": "must-keep" },
    build() {
      const session = newSession("eval-05");
      appendEvalStep(session, 1, "call-1", {
        name: "grep",
        args: '{"pattern":"refreshToken"}',
        chars: 12000,
        fill: "match src/demo/auth.ts:12 refreshToken rotation guard\n",
      });
      appendUserText(
        session,
        "Explain the refreshToken rotation guard you found and keep the exact line numbers.",
      );
      // The live tail: a small later-turn step keeps the current turn distinct
      // from the pruned history, as in a real session.
      appendEvalStep(session, 90, "call-live", {
        name: "read",
        args: '{"path":"src/demo/live.ts"}',
        chars: 200,
      });
      return session;
    },
  },
  {
    id: "06-test-fail-then-fix",
    danger: "low",
    intent: "an old failing test run superseded by a later green run",
    labels: { "call-1": "safe-to-truncate", "call-2": "must-keep" },
    build() {
      const session = newSession("eval-06");
      appendEvalStep(session, 1, "call-1", {
        name: "test",
        args: '{"command":"pnpm test auth"}',
        chars: 6000,
        isError: true,
      });
      appendEvalStep(session, 2, "call-fix", {
        name: "edit",
        args: '{"path":"src/demo/token.ts"}',
        chars: 500,
      });
      appendEvalStep(session, 3, "call-2", {
        name: "test",
        args: '{"command":"pnpm test auth"}',
        chars: 1500,
      });
      return session;
    },
  },
  {
    id: "07-test-fail-investigating",
    danger: "high",
    intent:
      "the failing run is the current evidence — old, but under investigation",
    labels: { "call-1": "must-keep" },
    build() {
      const session = newSession("eval-07");
      appendEvalStep(session, 1, "call-1", {
        name: "test",
        args: '{"command":"pnpm test rotation"}',
        chars: 9000,
        isError: true,
        fill: "AssertionError: expected 200 got 401\n    at RotationGuard (src/demo/auth.ts:88)\n",
      });
      appendUserText(session, "Why is rotation failing? Quote the assertion.");
      // The live tail: a small later-turn step keeps the current turn distinct
      // from the pruned history, as in a real session.
      appendEvalStep(session, 90, "call-live", {
        name: "read",
        args: '{"path":"src/demo/live.ts"}',
        chars: 200,
      });
      return session;
    },
  },
  {
    id: "08-unique-api-response",
    danger: "high",
    intent:
      "a non-reproducible external response is the only copy of the evidence",
    labels: { "call-1": "must-keep" },
    build() {
      const session = newSession("eval-08");
      appendEvalStep(session, 1, "call-1", {
        name: "web_fetch",
        args: '{"url":"https://api.example.corp/v1/tariff"}',
        chars: 7000,
        fill: "tariff-entry #4471: 0.042 credits/unit (snapshot 2026-09-19T21:00Z)\n",
      });
      appendUserText(
        session,
        "Use the tariff snapshot you fetched for the cost estimate.",
      );
      // The live tail: a small later-turn step keeps the current turn distinct
      // from the pruned history, as in a real session.
      appendEvalStep(session, 90, "call-live", {
        name: "read",
        args: '{"path":"src/demo/live.ts"}',
        chars: 200,
      });
      return session;
    },
  },
  {
    id: "09-docs-lookup",
    danger: "low",
    intent: "generic package documentation, trivially re-fetchable",
    labels: { "call-1": "safe-to-stub" },
    build() {
      const session = newSession("eval-09");
      appendEvalStep(session, 1, "call-1", {
        name: "web_fetch",
        args: '{"url":"https://docs.example.corp/guide"}',
        chars: 5000,
      });
      appendUserText(session, "Continue with the migration script.");
      // The live tail: a small later-turn step keeps the current turn distinct
      // from the pruned history, as in a real session.
      appendEvalStep(session, 90, "call-live", {
        name: "read",
        args: '{"path":"src/demo/live.ts"}',
        chars: 200,
      });
      return session;
    },
  },
  {
    id: "10-user-constraint-fanout",
    danger: "high",
    intent:
      "an explicit user constraint followed by many tools; the constraint-carrying result must survive",
    labels: {
      "call-1": "safe-to-stub",
      "call-2": "safe-to-stub",
      "call-3": "must-keep",
    },
    build() {
      const session = newSession("eval-10");
      appendUserText(
        session,
        "Never modify migrations. Find why PROJ-123 sync lags and keep the failing query output.",
      );
      appendEvalStep(session, 1, "call-1", {
        name: "read",
        args: '{"path":"src/demo/sync.ts"}',
        chars: 3500,
      });
      appendEvalStep(session, 2, "call-2", {
        name: "read",
        args: '{"path":"src/demo/queue.ts"}',
        chars: 3500,
      });
      appendEvalStep(session, 3, "call-3", {
        name: "test",
        args: '{"command":"pnpm test sync-lag"}',
        chars: 5000,
        isError: true,
        fill: "QueryTimeout: sync_cursor_query exceeded 30s\n    at SyncWorker (src/demo/sync.ts:140)\n",
      });
      return session;
    },
  },
  {
    id: "11-long-shell-log",
    danger: "medium",
    intent:
      "a verbose build log where head/tail identity matters, middle does not",
    labels: { "call-1": "safe-to-truncate" },
    build() {
      const session = newSession("eval-11");
      appendEvalStep(session, 1, "call-1", {
        name: "shell",
        args: '{"command":"pnpm build"}',
        chars: 12000,
        fill: "compiling module src/demo/mod.ts\n",
      });
      appendUserText(session, "Did the build finish?");
      // The live tail: a small later-turn step keeps the current turn distinct
      // from the pruned history, as in a real session.
      appendEvalStep(session, 90, "call-live", {
        name: "read",
        args: '{"path":"src/demo/live.ts"}',
        chars: 200,
      });
      return session;
    },
  },
  {
    id: "12-after-summary-checkpoint",
    danger: "medium",
    intent:
      "pruning on a surface that already carries a summary checkpoint from an earlier compaction",
    labels: { "call-1": "safe-to-stub", "call-2": "must-keep" },
    build() {
      const session = newSession("eval-12");
      appendEvalStep(session, 1, "call-1", {
        name: "read",
        args: '{"path":"src/demo/legacy.ts"}',
        chars: 3000,
      });
      // A prior checkpoint: a user message carrying the framed summary text.
      appendUserText(
        session,
        "This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it.\n\n<compacted-summary>\n## Primary Request and Intent\n- demo checkpoint\n</compacted-summary>",
      );
      appendEvalStep(session, 2, "call-2", {
        name: "grep",
        args: '{"pattern":"sync_cursor"}',
        chars: 2500,
      });
      return session;
    },
  },
];
