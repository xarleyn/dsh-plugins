import { describe, expect, it } from "vitest";
import { createWorkflowTools } from "../../../dsh-documents/src/workflow/tools.js";
import { QA_BRANCH_NOTE } from "../../src/prompt-notes.js";
import {
  config,
  harness,
  noteNames,
  noteText,
} from "./prompt-notes.helpers.js";

describe("branch model context", () => {
  it("uses the branch as root and explains the inherited workflow boundary once", async () => {
    const world = harness({ config: config(), qaSessions: ["branch"] });
    world.createSession("parent");
    const branch = world.createSession("branch", "parent");
    Object.assign(branch.header, { isSeeded: true });
    const notes = await world.step(branch);
    expect(notes.flatMap(noteNames)).toContain(QA_BRANCH_NOTE);
    const names = notes
      .map(noteText)
      .join("\n")
      .match(/document_workflow_\w+/gu);
    const registered = createWorkflowTools({} as never, {} as never).map(
      (tool) => tool.name,
    );
    expect(names).toEqual(["document_workflow_start"]);
    expect(registered).toContain(names![0]);
    expect(await world.step(branch)).toEqual([]);
  });
});
