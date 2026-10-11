import { describe, expect, it } from "vitest";
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
    expect(notes.map(noteText).join("\n")).toContain("document_workflow_begin");
    expect(await world.step(branch)).toEqual([]);
  });
});
