import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONTENT, UPDATE, workflowFixture } from "./workflow.helpers.js";

let fixture: Awaited<ReturnType<typeof workflowFixture>>;
beforeEach(async () => {
  fixture = await workflowFixture();
});
afterEach(async () => fixture.cleanup());

describe("grounded document completeness", () => {
  async function start() {
    return fixture.service.start(fixture.scope, {
      kind: "proposal",
      template: "proposal",
      productVersion: "1.0",
      request: "Мониторинг",
    });
  }
  it("reports missing required facts before generating a final document", async () => {
    const state = await start();
    expect(state.blockers).toContain("missing required fact: customer");
    expect(state.templateContent).toContain("Функциональные требования");
    await expect(
      fixture.service.review(fixture.scope, state.id, state.revision, "Human"),
    ).rejects.toMatchObject({ code: "WORKFLOW_INCOMPLETE" });
  });
  it.each([
    {
      name: "excluded module",
      data: {
        ...UPDATE,
        requirements: [{ ...UPDATE.requirements[0]!, modules: ["events"] }],
      },
      expected: "excluded module used",
    },
    {
      name: "wrong product version",
      data: {
        ...UPDATE,
        requirements: [
          {
            ...UPDATE.requirements[0]!,
            evidence: [
              {
                source: "docs/old.md",
                quote: "Monitoring",
                productVersion: "0.9",
              },
            ],
          },
        ],
      },
      expected: "conflicting product version",
    },
    {
      name: "unsupported capability",
      data: {
        ...UPDATE,
        requirements: [{ ...UPDATE.requirements[0]!, evidence: [] }],
      },
      expected: "missing versioned product evidence",
    },
    {
      name: "partial coverage",
      data: {
        ...UPDATE,
        requirements: [
          { ...UPDATE.requirements[0]!, coverage: "partial" as const },
        ],
      },
      expected: "unresolved requirement",
    },
    {
      name: "open commercial decision",
      data: { ...UPDATE, unresolved: ["Confirm payment terms"] },
      expected: "Confirm payment terms",
    },
    {
      name: "missing pricing decision",
      data: {
        ...UPDATE,
        facts: UPDATE.facts.filter((f) => f.key !== "pricingDecision"),
      },
      expected: "confirm pricingDecision",
    },
    {
      name: "priced proposal without confirmed prices",
      data: {
        ...UPDATE,
        facts: UPDATE.facts.map((f) =>
          f.key === "pricingDecision" ? { ...f, value: "priced" } : f,
        ),
      },
      expected: "confirmed price and quantity sources",
    },
  ])("blocks $name even when a draft exists", async ({ data, expected }) => {
    const state = await start();
    const updated = await fixture.service.update(fixture.scope, state.id, {
      ...data,
      revision: state.revision,
    });
    const draft = await fixture.service.draft(
      fixture.scope,
      state.id,
      updated.revision,
      CONTENT,
    );
    expect(draft.blockers.some((b) => b.includes(expected))).toBe(true);
    await expect(
      fixture.service.review(fixture.scope, state.id, draft.revision, "Human"),
    ).rejects.toMatchObject({ code: "WORKFLOW_INCOMPLETE" });
    expect(fixture.review).not.toHaveBeenCalled();
  });
  it.each(["TODO: price", "{{CUSTOMER}}", "TBD"])(
    "allows an incomplete draft but refuses final review with %s",
    async (placeholder) => {
      const state = await start();
      const updated = await fixture.service.update(fixture.scope, state.id, {
        ...UPDATE,
        revision: state.revision,
      });
      const draft = await fixture.service.draft(
        fixture.scope,
        state.id,
        updated.revision,
        `${CONTENT}\n${placeholder}`,
      );
      expect(draft.blockers).toContain(
        "draft contains unresolved placeholders",
      );
      await expect(
        fixture.service.review(
          fixture.scope,
          state.id,
          draft.revision,
          "Human",
        ),
      ).rejects.toMatchObject({ code: "WORKFLOW_INCOMPLETE" });
    },
  );
  it("requires all mandatory template sections", async () => {
    const state = await start();
    const updated = await fixture.service.update(fixture.scope, state.id, {
      ...UPDATE,
      revision: state.revision,
    });
    const draft = await fixture.service.draft(
      fixture.scope,
      state.id,
      updated.revision,
      "# Only a title",
    );
    expect(draft.blockers).toContain("missing required section: Цель");
  });
  it("does not silently fall back when a content template is missing", async () => {
    await expect(
      fixture.service.start(fixture.scope, {
        kind: "proposal",
        template: "default",
        productVersion: "1.0",
        request: "A proposal",
      }),
    ).rejects.toMatchObject({ code: "WORKFLOW_TEMPLATE_UNAVAILABLE" });
  });
  it("requires an unpriced proposal to disclose that customer decision", async () => {
    const state = await start();
    const updated = await fixture.service.update(fixture.scope, state.id, {
      ...UPDATE,
      revision: state.revision,
    });
    const draft = await fixture.service.draft(
      fixture.scope,
      state.id,
      updated.revision,
      CONTENT.replace(
        "Предложение без указания стоимости по решению заказчика.",
        "Предложение.",
      ),
    );
    expect(draft.blockers).toContain(
      "an explicitly unpriced proposal must disclose that prices are excluded",
    );
  });
});
