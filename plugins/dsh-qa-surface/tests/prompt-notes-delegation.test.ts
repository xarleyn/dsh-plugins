import { describe, expect, it } from "vitest";
import { QA_DELEGATION_NOTE } from "../src/prompt-notes.js";
import {
  config,
  harness,
  noteNames,
  noteText,
} from "./prompt-notes.helpers.js";

describe("delegation naming note", () => {
  it("asks the model to name its delegations in an attested chat", async () => {
    const { createSession, step } = harness({
      config: config(),
      qaSessions: ["session-root"],
    });
    const session = createSession("session-root");
    const appended = await step(session);
    expect(noteNames(appended[1])).toEqual([QA_DELEGATION_NOTE]);
    expect(noteText(appended[1])).toMatch(/description field/u);
    expect(await step(session)).toEqual([]);
  });

  it("stays out of chats the QA surface never attested", async () => {
    const { createSession, step } = harness({ config: config() });
    expect(await step(createSession("session-operator"))).toEqual([]);
  });
});
