import { describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../src/resolve-config.js";
import { QaSessionController } from "../src/client/QaSessionController.js";
import { harness } from "./helpers/session-fakes.js";

describe("QA session controller", () => {
  it("surfaces a parked approval of a running chat and answers it", async () => {
    const world = harness();
    const request = {
      id: "request-1",
      sessionId: "created-1",
      toolName: "glob",
      reason: "Safety gate requests approval",
      createdAt: 1,
      delegated: false,
    };
    let parked: readonly (typeof request)[] = [];
    const pendingApprovals = vi.fn(async () => ({
      ok: true as const,
      value: parked,
    }));
    const answerApproval = vi.fn(async () => ({
      ok: true as const,
      value: true,
    }));
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig({ interaction: { approvals: "interactive" } }),
      approvalApi: { pendingApprovals, answerApproval },
    });
    await controller.ensureSession();
    // Binding reads what the Host parks even before a turn reports itself:
    // that is how a request survives a reload. This chat has none yet.
    await vi.waitFor(() => {
      expect(pendingApprovals).toHaveBeenCalledWith("", "created-1");
    });
    expect(controller.getSnapshot().approvals).toEqual([]);
    parked = [request];
    const face = world.faces.get("created-1");
    face?.source.set({ ...face.source.getSnapshot(), running: true });
    await vi.waitFor(() => {
      expect(controller.getSnapshot().approvals).toEqual([request]);
    });

    parked = [];
    await controller.answerApproval("request-1", "allowed-once");
    expect(answerApproval).toHaveBeenCalledWith(
      "",
      "created-1",
      "request-1",
      "allowed-once",
    );
    expect(controller.getSnapshot().approvals).toEqual([]);
    controller.dispose();
  });

  it("surfaces a parked question of a running chat and answers it", async () => {
    const world = harness();
    const request = {
      id: "question-1",
      sessionId: "created-1",
      createdAt: 1,
      questions: [
        {
          id: "target",
          question: "Куда писать отчёт?",
          header: null,
          detail: null,
          multiSelect: false,
          options: [{ label: "В чат", description: null }],
        },
      ],
    };
    let parked: readonly (typeof request)[] = [];
    const pendingQuestions = vi.fn(async () => ({
      ok: true as const,
      value: parked,
    }));
    const answerQuestion = vi.fn(async () => ({
      ok: true as const,
      value: true,
    }));
    const cancelQuestion = vi.fn(async () => ({
      ok: true as const,
      value: true,
    }));
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig({ interaction: { questions: "interactive" } }),
      questionApi: { pendingQuestions, answerQuestion, cancelQuestion },
    });
    await controller.ensureSession();
    await vi.waitFor(() => {
      expect(pendingQuestions).toHaveBeenCalledWith("", "created-1");
    });
    parked = [request];
    const face = world.faces.get("created-1");
    face?.source.set({ ...face.source.getSnapshot(), running: true });
    await vi.waitFor(() => {
      expect(controller.getSnapshot().questions).toEqual([request]);
    });

    parked = [];
    await controller.answerQuestion("question-1", [
      { id: "target", selected: ["В чат"] },
    ]);
    expect(answerQuestion).toHaveBeenCalledWith("", "created-1", "question-1", [
      { id: "target", selected: ["В чат"] },
    ]);
    expect(controller.getSnapshot().questions).toEqual([]);

    await controller.cancelQuestion("question-1");
    expect(cancelQuestion).toHaveBeenCalledWith("", "created-1", "question-1");
    controller.dispose();
  });

  it("recovers a question parked before the page was reloaded", async () => {
    // A reload re-binds the chat before any turn reports itself over the fresh
    // stream. The question the model is still waiting on is Host state, so the
    // page has to ask for it on binding: an empty composer with the agent
    // waiting behind it is exactly the state this must never leave behind.
    const world = harness();
    const request = {
      id: "question-1",
      sessionId: "created-1",
      createdAt: 1,
      questions: [
        {
          id: "target",
          question: "Куда писать отчёт?",
          header: null,
          detail: null,
          multiSelect: false,
          options: [{ label: "В чат", description: null }],
        },
      ],
    };
    const pendingQuestions = vi.fn(async () => ({
      ok: true as const,
      value: [request],
    }));
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig({ interaction: { questions: "interactive" } }),
      questionApi: {
        pendingQuestions,
        answerQuestion: vi.fn(async () => ({ ok: true as const, value: true })),
        cancelQuestion: vi.fn(async () => ({ ok: true as const, value: true })),
      },
    });
    await controller.ensureSession();
    await vi.waitFor(() => {
      expect(controller.getSnapshot().questions).toEqual([request]);
    });
    // Nothing is running, and the composer still belongs to the question.
    expect(controller.getSnapshot().phase).toBe("ready");
    expect(controller.getSnapshot().canSend).toBe(false);
    expect(await controller.send("не туда")).toBe(false);
    expect(world.faces.get("created-1")?.prompt).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("takes a settled question off the screen once its turn is over", async () => {
    const world = harness();
    const request = {
      id: "question-1",
      sessionId: "created-1",
      createdAt: 1,
      questions: [
        {
          id: "target",
          question: "Куда писать отчёт?",
          header: null,
          detail: null,
          multiSelect: false,
          options: [{ label: "В чат", description: null }],
        },
      ],
    };
    let parked: readonly (typeof request)[] = [request];
    const pendingQuestions = vi.fn(async () => ({
      ok: true as const,
      value: parked,
    }));
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig({ interaction: { questions: "interactive" } }),
      questionApi: {
        pendingQuestions,
        answerQuestion: vi.fn(async () => ({ ok: true as const, value: true })),
        cancelQuestion: vi.fn(async () => ({ ok: true as const, value: true })),
      },
    });
    await controller.ensureSession();
    const face = world.faces.get("created-1");
    face?.source.set({ ...face.source.getSnapshot(), running: true });
    await vi.waitFor(() => {
      expect(controller.getSnapshot().questions).toEqual([request]);
    });
    // The turn is stopped and the Host settles what it can no longer answer:
    // the form has to leave the screen instead of staying as a live-looking
    // control nothing reads.
    parked = [];
    face?.source.set({ ...face.source.getSnapshot(), running: false });
    await vi.waitFor(
      () => {
        expect(controller.getSnapshot().questions).toEqual([]);
      },
      { timeout: 4000 },
    );
    expect(controller.getSnapshot().canSend).toBe(true);
    controller.dispose();
  });

  it("never polls approvals while the deployment blocks them", async () => {
    const world = harness();
    const pendingApprovals = vi.fn(async () => ({
      ok: true as const,
      value: [],
    }));
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
      approvalApi: {
        pendingApprovals,
        answerApproval: vi.fn(async () => ({ ok: true as const, value: true })),
      },
    });
    await controller.ensureSession();
    const face = world.faces.get("created-1");
    face?.source.set({ ...face.source.getSnapshot(), running: true });
    await Promise.resolve();
    expect(pendingApprovals).not.toHaveBeenCalled();
    expect(controller.getSnapshot().approvals).toEqual([]);
    controller.dispose();
  });
});
