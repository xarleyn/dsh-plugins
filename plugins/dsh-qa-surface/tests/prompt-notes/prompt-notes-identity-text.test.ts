import { describe, expect, it } from "vitest";
import { renderUserIdentity } from "../../src/prompt-notes.js";
import { FIELDS } from "./prompt-notes.helpers.js";

describe("user identity text", () => {
  it("says nothing without an account address", () => {
    expect(
      renderUserIdentity({
        email: "  ",
        profile: {
          fullName: "Иван",
          identities: { jira: "i.ivanov" },
          instructions: "Кратко",
          updatedAt: null,
        },
        identities: FIELDS,
      }),
    ).toEqual({ identity: "", instructions: "" });
  });

  it("renders the name, handles and the self-declared caveat", () => {
    const rendered = renderUserIdentity({
      email: "i.ivanov@example.com",
      profile: {
        fullName: "Иван Иванов",
        identities: { jira: "i.ivanov", gitlab: "@iivanov" },
        instructions: "",
        updatedAt: null,
      },
      identities: FIELDS,
    });
    expect(rendered.identity).toContain(
      "Current QA user: Иван Иванов <i.ivanov@example.com>",
    );
    expect(rendered.identity).toContain("- Jira: i.ivanov");
    expect(rendered.identity).toContain("- GitLab: @iivanov");
    expect(rendered.identity).toMatch(/self-declared/u);
    expect(rendered.identity).toMatch(/name the identifier you used/u);
    expect(rendered.instructions).toBe("");
  });

  it("asks for the missing handle rather than guessing one", () => {
    const rendered = renderUserIdentity({
      email: "i.ivanov@example.com",
      profile: {
        fullName: "",
        identities: {},
        instructions: "",
        updatedAt: null,
      },
      identities: FIELDS,
    });
    expect(rendered.identity).toContain(
      "Current QA user: i.ivanov@example.com",
    );
    expect(rendered.identity).toMatch(/instead of guessing a handle/u);
  });

  it("frames the user's own instructions as preferences, not policy", () => {
    const rendered = renderUserIdentity({
      email: "i.ivanov@example.com",
      profile: {
        fullName: "",
        identities: { jira: "i.ivanov" },
        instructions: "Отвечай кратко.",
        updatedAt: null,
      },
      identities: FIELDS,
    });
    expect(rendered.instructions).toContain("not deployment policy");
    expect(rendered.instructions).toContain("Отвечай кратко.");
    expect(rendered.instructions).toContain('"""');
  });
});
