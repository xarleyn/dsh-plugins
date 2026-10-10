import { describe, expect, it } from "vitest";
import { projectBoundSessionState } from "../../src/client/project-session-state.js";
import { QA_SESSION_IDLE_STATE } from "../../src/client/types.js";
import { resolveConfig } from "../../src/resolve-config.js";
import { sessionFace } from "../helpers/session-fakes.js";
import type { QaSource, QaTurnSources } from "../../src/types.js";

const source: QaSource = { id: "file:guide.md", kind: "file", title: "guide.md", path: "guide.md",
  locations: [], evidence: "read", score: 100, origins: [{ sessionId: "root", turn: 1, role: "parent" }] };
const bundles: QaTurnSources[] = [
  { version: 1, sessionId: "root", turn: 1, complete: true, sources: [source] },
  { version: 1, sessionId: "root", turn: 2, complete: false,
    incompleteOrigins: [{ provider: "docs_read", reason: "source-address-unavailable" }],
    sources: [{ ...source, origins: [{ sessionId: "root", turn: 2, role: "parent" }] },
      { ...source, id: "file:other.md", title: "other.md", path: "other.md" }] },
  { version: 1, sessionId: "root", turn: 3, complete: true, sources: [] },
];

describe("whole-chat sources", () => {
  it("retains earlier sources after an empty latest turn and combines completeness and origins", () => {
    const state = projectBoundSessionState({ connected: true, sessionId: "root", chatKey: 1,
      sessionSnapshot: sessionFace("root").face.getSnapshot(), conversationSnapshot: undefined,
      sourceBundles: bundles, queuedMessages: [], admittedSubmissions: new Set(),
      approvals: [], questions: [], operationError: null, requestQueue: null, policyReady: true,
      admissionPending: false, chatsRevision: 0, viewingSubagent: null,
      slash: QA_SESSION_IDLE_STATE.slash, config: resolveConfig() });
    expect(state.sources).toHaveLength(2);
    expect(state.sources.find((item) => item.id === source.id)?.origins).toHaveLength(2);
    expect(state.sourcesComplete).toBe(false);
    expect(state.incompleteSourceOrigins).toEqual(bundles[1]?.incompleteOrigins);
  });
});
