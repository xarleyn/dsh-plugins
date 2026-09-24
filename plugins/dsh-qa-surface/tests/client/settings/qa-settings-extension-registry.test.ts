import { QaUserSettingsSectionRegistry } from "../../../src/client/settings-extensions/registry.js";

describe("QA user settings extension registry", () => {
  it("orders pages deterministically and disposes registrations idempotently", () => {
    const registry = new QaUserSettingsSectionRegistry();
    const component = () => null;
    const changes: number[] = [];
    registry.subscribe(() => changes.push(registry.getSnapshot().revision));
    const removeB = registry.register({
      id: "b",
      title: "B",
      order: 20,
      component,
    });
    registry.register({ id: "a", title: "A", order: 10, component });
    expect(registry.getSnapshot().sections.map(({ id }) => id)).toEqual([
      "a",
      "b",
    ]);
    removeB();
    removeB();
    expect(registry.getSnapshot().sections.map(({ id }) => id)).toEqual(["a"]);
    expect(changes).toEqual([1, 2, 3]);
  });

  it("rejects duplicate ids and registration after disposal", () => {
    const registry = new QaUserSettingsSectionRegistry();
    const component = () => null;
    registry.register({ id: "integrations", title: "Интеграции", component });
    expect(() =>
      registry.register({ id: "integrations", title: "Duplicate", component }),
    ).toThrow(/duplicate id/u);
    registry.dispose();
    expect(() =>
      registry.register({ id: "later", title: "Later", component }),
    ).toThrow(/disposed/u);
  });
});
