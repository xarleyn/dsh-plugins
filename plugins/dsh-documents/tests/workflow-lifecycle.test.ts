import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DocumentWorkflowService } from "../src/workflow/service.js";
import { WorkflowStore } from "../src/workflow/store.js";
import { CONTENT, UPDATE, ready, workflowFixture } from "./workflow.helpers.js";

let fixture: Awaited<ReturnType<typeof workflowFixture>>;
beforeEach(async () => {
  fixture = await workflowFixture();
});
afterEach(async () => fixture.cleanup());

describe("managed document lifecycle", () => {
  it("preserves the complete long review packet beyond the expert task limit", async () => {
    const base = await ready(fixture);
    const markdown = `${CONTENT}\n${"Long content\n".repeat(1800)}\nFINAL DRAFT MARKER`;
    const draft = await fixture.service.draft(
      fixture.scope,
      base.id,
      base.revision,
      markdown,
    );
    const human = `${"Confirmed decision\n".repeat(1000)}FINAL HUMAN MARKER`;
    fixture.review.mockImplementationOnce(async (task) => {
      expect(task.length).toBeLessThan(12_000);
      const relative = task.match(/review-packet: ([^\n]+)/u)?.[1];
      expect(relative).toBeDefined();
      const packet = await readFile(
        path.join(fixture.scope.workspaceRoot, relative!),
        "utf8",
      );
      expect(packet.endsWith(markdown)).toBe(true);
      expect(packet).toContain(`## Original human context\n\n${human}`);
      const metadata = JSON.parse(
        packet.slice(
          packet.indexOf("{"),
          packet.indexOf("\n\n## Original human context"),
        ),
      );
      expect(metadata.primaryVisibleTools).toEqual(["read"]);
      expect(metadata.document.draft.sha256).toBe(draft.draft!.sha256);
      expect(task).toContain("Read ALL lines");
      return { pass: true, summary: "Full packet verified", issues: [] };
    });
    const reviewed = await fixture.service.review(
      fixture.scope,
      draft.id,
      draft.revision,
      human,
      ["read"],
    );
    expect(reviewed.status).toBe("reviewed");
  });

  it("rejects a passing review when its saved packet was changed", async () => {
    const draft = await ready(fixture);
    fixture.review.mockImplementationOnce(async (task) => {
      const relative = task.match(/review-packet: ([^\n]+)/u)?.[1];
      expect(relative).toBeDefined();
      await writeFile(
        path.join(fixture.scope.workspaceRoot, relative!),
        "Changed packet",
      );
      return { pass: true, summary: "Passing altered snapshot", issues: [] };
    });
    await expect(
      fixture.service.review(
        fixture.scope,
        draft.id,
        draft.revision,
        "Human ".repeat(3000),
      ),
    ).rejects.toMatchObject({ code: "REVIEW_PACKET_CHANGED" });
    expect(
      (await fixture.service.read(fixture.scope, draft.id)).draft?.review,
    ).toBeUndefined();
  });

  it.each(["proposal", "specification"] as const)(
    "saves, reviews, approves and exports the exact %s revision",
    async (kind) => {
      const draft = await ready(fixture, kind);
      expect(draft.status).toBe("draft");
      expect(draft.blockers).toEqual([]);
      expect(
        await readFile(
          path.join(fixture.scope.workspaceRoot, draft.draft!.path),
          "utf8",
        ),
      ).toBe(CONTENT);
      await expect(
        fixture.service.export(fixture.scope, draft.id, draft.revision, [
          "docx",
        ]),
      ).rejects.toMatchObject({ code: "WORKFLOW_NOT_APPROVED" });
      const reviewed = await fixture.service.review(
        fixture.scope,
        draft.id,
        draft.revision,
        "Human asked for monitoring and excluded events",
      );
      expect(reviewed.status).toBe("reviewed");
      expect(fixture.review.mock.calls[0]?.[0]).toContain(
        CONTENT.replace(/\n/gu, "\\n"),
      );
      expect(fixture.review.mock.calls[0]?.[0]).toContain(
        "findings contain objections only",
      );
      expect(fixture.review.mock.calls[0]?.[0]).toContain(
        "assumptions contain unsupported assumptions only",
      );
      const approved = await fixture.service.approve(
        fixture.scope,
        draft.id,
        draft.revision,
        draft.draft!.sha256,
        "human-owner",
      );
      expect(approved.status).toBe("approved");
      expect(approved.draft?.approval?.actor).toBe("human");
      const exported = await fixture.service.export(
        fixture.scope,
        draft.id,
        draft.revision,
        ["docx"],
      );
      expect(exported.files[0]?.status).toBe("created");
      expect(await readFile(exported.source!.path, "utf8")).toBe(CONTENT);
      expect((await fixture.service.read(fixture.scope, draft.id)).status).toBe(
        "exported",
      );
    },
  );

  it("recovers facts, open questions and the draft after a new service instance", async () => {
    const draft = await ready(fixture);
    const restarted = new DocumentWorkflowService(
      () => fixture.runtime,
      new WorkflowStore(path.join(fixture.root, "host-state")),
      { review: fixture.review },
    );
    expect(await restarted.read(fixture.scope, draft.id)).toEqual(draft);
    await expect(
      restarted.authorizeGeneralRender(fixture.scope),
    ).rejects.toMatchObject({ code: "MANAGED_DOCUMENT_REQUIRED" });
  });

  it("prevents finalisation bypass through general conversion in an active workflow", async () => {
    await expect(
      fixture.service.authorizeGeneralRender(fixture.scope),
    ).resolves.toBeUndefined();
    await ready(fixture);
    await expect(
      fixture.service.authorizeGeneralRender(fixture.scope),
    ).rejects.toMatchObject({ code: "MANAGED_DOCUMENT_REQUIRED" });
    await expect(
      fixture.service.authorizeGeneralRender({
        ...fixture.scope,
        sessionId: "other",
      }),
    ).resolves.toBeUndefined();
  });

  it("invalidates consent when the registered content template changes", async () => {
    const draft = await ready(fixture);
    await fixture.service.review(
      fixture.scope,
      draft.id,
      draft.revision,
      "Human",
    );
    await fixture.service.approve(
      fixture.scope,
      draft.id,
      draft.revision,
      draft.draft!.sha256,
      "owner",
    );
    await writeFile(
      path.join(fixture.templates, "content.md"),
      `${CONTENT}\nNew required layout`,
    );
    expect(
      (await fixture.service.read(fixture.scope, draft.id)).blockers,
    ).toContain(
      "registered template changed; update facts and regenerate the draft",
    );
    await expect(
      fixture.service.export(fixture.scope, draft.id, draft.revision, ["docx"]),
    ).rejects.toMatchObject({ code: "WORKFLOW_NOT_APPROVED" });
    expect(fixture.stub.calls.docx).toHaveLength(0);
  });

  it("invalidates review and approval on a new draft or changed facts", async () => {
    const draft = await ready(fixture);
    await fixture.service.review(
      fixture.scope,
      draft.id,
      draft.revision,
      "Human",
    );
    await fixture.service.approve(
      fixture.scope,
      draft.id,
      draft.revision,
      draft.draft!.sha256,
      "owner",
    );
    const next = await fixture.service.draft(
      fixture.scope,
      draft.id,
      draft.revision,
      `${CONTENT}\nНовое уточнение.`,
    );
    expect(next.draft?.review).toBeUndefined();
    expect(next.draft?.approval).toBeUndefined();
    await expect(
      fixture.service.approve(
        fixture.scope,
        draft.id,
        draft.revision,
        draft.draft!.sha256,
        "owner",
      ),
    ).rejects.toMatchObject({ code: "STALE_WORKFLOW_REVISION" });
    await expect(
      fixture.service.export(fixture.scope, next.id, next.revision, ["docx"]),
    ).rejects.toMatchObject({ code: "WORKFLOW_NOT_APPROVED" });
    const update = await fixture.service.update(fixture.scope, next.id, {
      ...UPDATE,
      revision: next.revision,
    });
    expect(update.draft).toBeUndefined();
  });

  it("never accepts a failed or unavailable reviewer as a PASS", async () => {
    const draft = await ready(fixture);
    fixture.review.mockResolvedValueOnce({
      pass: false,
      summary: "Missing source",
      issues: ["unsupported claim"],
    });
    const reviewed = await fixture.service.review(
      fixture.scope,
      draft.id,
      draft.revision,
      "Human",
    );
    expect(reviewed.draft?.review?.verdict).toBe("revise");
    await expect(
      fixture.service.approve(
        fixture.scope,
        draft.id,
        draft.revision,
        draft.draft!.sha256,
        "owner",
      ),
    ).rejects.toMatchObject({ code: "WORKFLOW_NOT_REVIEWED" });
    fixture.review.mockRejectedValueOnce(new Error("unavailable"));
    await expect(
      fixture.service.review(fixture.scope, draft.id, draft.revision, "Human"),
    ).rejects.toThrow("unavailable");
    expect(
      (await fixture.service.read(fixture.scope, draft.id)).draft?.review
        ?.verdict,
    ).toBe("revise");
  });

  it("refuses wrong hashes and files changed outside the workflow", async () => {
    const draft = await ready(fixture);
    await fixture.service.review(
      fixture.scope,
      draft.id,
      draft.revision,
      "Human",
    );
    await expect(
      fixture.service.approve(
        fixture.scope,
        draft.id,
        draft.revision,
        "wrong",
        "owner",
      ),
    ).rejects.toMatchObject({ code: "WORKFLOW_NOT_REVIEWED" });
    await fixture.service.approve(
      fixture.scope,
      draft.id,
      draft.revision,
      draft.draft!.sha256,
      "owner",
    );
    await writeFile(
      path.join(fixture.scope.workspaceRoot, draft.draft!.path),
      "changed",
    );
    await expect(
      fixture.service.export(fixture.scope, draft.id, draft.revision, ["docx"]),
    ).rejects.toMatchObject({ code: "DRAFT_CHANGED" });
    expect(fixture.stub.calls.docx).toHaveLength(0);
    await expect(
      fixture.service.read(fixture.scope, draft.id),
    ).rejects.toMatchObject({
      code: "DRAFT_CHANGED",
      message: expect.stringContaining(`current revision is ${draft.revision}`),
    });
    const replacement = await fixture.service.draft(
      fixture.scope,
      draft.id,
      draft.revision,
      CONTENT,
    );
    expect(replacement.revision).toBe(draft.revision + 1);
    expect(replacement.draft?.review).toBeUndefined();
    expect(replacement.draft?.approval).toBeUndefined();
    await expect(
      fixture.service.export(fixture.scope, draft.id, replacement.revision, [
        "docx",
      ]),
    ).rejects.toMatchObject({ code: "WORKFLOW_NOT_APPROVED" });
  });

  it("cannot access or approve a workflow from another session", async () => {
    const draft = await ready(fixture);
    const other = { ...fixture.scope, sessionId: "session-2" };
    await expect(fixture.service.read(other, draft.id)).rejects.toMatchObject({
      code: "WORKFLOW_NOT_FOUND",
    });
    await expect(
      fixture.service.approve(
        other,
        draft.id,
        draft.revision,
        draft.draft!.sha256,
        "other",
      ),
    ).rejects.toThrow();
  });

  it("rejects one of two concurrent edits using the same revision", async () => {
    const draft = await ready(fixture);
    const results = await Promise.allSettled([
      fixture.service.draft(
        fixture.scope,
        draft.id,
        draft.revision,
        `${CONTENT}\nA`,
      ),
      fixture.service.draft(
        fixture.scope,
        draft.id,
        draft.revision,
        `${CONTENT}\nB`,
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("does not record a review when the draft changed during independent verification", async () => {
    const draft = await ready(fixture);
    fixture.review.mockImplementationOnce(async () => {
      await fixture.service.draft(
        fixture.scope,
        draft.id,
        draft.revision,
        `${CONTENT}\nChanged`,
      );
      return { pass: true, summary: "Old version", issues: [] };
    });
    await expect(
      fixture.service.review(fixture.scope, draft.id, draft.revision, "Human"),
    ).rejects.toMatchObject({ code: "STALE_WORKFLOW_REVISION" });
    expect(
      (await fixture.service.read(fixture.scope, draft.id)).draft?.review,
    ).toBeUndefined();
  });
});
