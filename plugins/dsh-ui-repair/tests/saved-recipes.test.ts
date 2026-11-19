// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { UIRepairRuntime } from "../src/client/runtime.js";
import type { RepairRecipe } from "../src/shared/recipes.js";
import { dimensions, quietLogger } from "./runtime.helpers.js";

const PACKAGE = "@example/layout-fixture";

function mount(version = "1.0.0", marker = "data-dsh-ui-repair-scroll-x") {
  document.body.innerHTML = `
    <section data-plugin-package="${PACKAGE}" data-dsh-ui-repair-root="panel"
      data-dsh-ui-repair-version="${version}" data-dsh-ui-repair-scope="foreign-scope">
      <div data-dsh-ui-repair-anchor="content" ${marker}
        data-dsh-ui-repair-target="foreign-target r005-1"></div>
    </section>
  `;
  const root = document.querySelector("section")!;
  const target = root.querySelector("div")!;
  dimensions(target, {
    clientHeight: 100,
    scrollHeight: 100,
    clientWidth: 200,
    scrollWidth: 260,
  });
  return { root, target };
}

const runtimes: UIRepairRuntime[] = [];
function runtime(mode: "suggest" | "auto" = "suggest") {
  const service = new UIRepairRuntime(
    document,
    {
      mode,
      scanOnStartup: false,
      observeMutations: false,
      observeResize: false,
    },
    quietLogger(),
  );
  runtimes.push(service);
  return service;
}

function styles() {
  return document.head.querySelectorAll("[data-dsh-ui-repair-style]");
}

async function capture(service: UIRepairRuntime): Promise<RepairRecipe> {
  service.setPluginVersions(new Map([[PACKAGE, "1.0.0"]]));
  const issue = (await service.scan()).issues.find(
    ({ ruleId }) => ruleId === "R005",
  );
  expect(issue).toBeDefined();
  expect(await service.apply(issue!.id)).toBe(true);
  const recipe = service.savableRepairs()[0]?.recipe;
  expect(recipe).toBeDefined();
  return recipe!;
}

afterEach(() => {
  for (const service of runtimes.splice(0)) service.dispose();
  document.body.replaceChildren();
});

describe("saved repair recipes", () => {
  it("captures verified intent, restores it on browser restart, and removes only owned tokens", async () => {
    const { root, target } = mount();
    const first = runtime();
    const recipe = await capture(first);
    expect(recipe).toMatchObject({
      schemaVersion: 1,
      origin: "verified-scan",
      packageName: PACKAGE,
      rootKey: "panel",
      targetKey: "content",
      targetTag: "div",
      ruleId: "R005",
      originalVersion: "1.0.0",
      checkedVersion: "1.0.0",
    });
    expect(recipe).not.toHaveProperty("suggestedCss");
    first.dispose();
    expect(root.getAttribute("data-dsh-ui-repair-scope")).toBe("foreign-scope");
    expect(target.getAttribute("data-dsh-ui-repair-target")).toBe(
      "foreign-target r005-1",
    );
    const next = runtime();
    next.setRecipes([recipe]);
    await next.scan();
    expect(styles()).toHaveLength(0);
    next.setPluginVersions(new Map([[PACKAGE, "1.0.0"]]));
    await next.scan();
    expect(styles()).toHaveLength(1);
    expect(next.recipeStatus(recipe).active).toBe(true);
    next.setRecipes([]);
    expect(styles()).toHaveLength(0);
    expect(target.getAttribute("data-dsh-ui-repair-target")).toBe(
      "foreign-target r005-1",
    );
  });

  it("holds an updated package until a fresh scope check is accepted, even in auto mode", async () => {
    mount();
    const first = runtime();
    const recipe = await capture(first);
    first.dispose();
    const { root, target } = mount("2.0.0");
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    root.append(dialog);
    dialog.append(target);
    const service = runtime("auto");
    service.setRecipes([recipe]);
    service.setPluginVersions(new Map([[PACKAGE, "2.0.0"]]));
    await service.scan();
    expect(styles()).toHaveLength(0);
    expect(service.recipeStatus(recipe).message).toContain("Revalidate before");
    const checked = service.revalidateRecipe(recipe);
    expect(checked).toMatchObject({
      recipe: { originalVersion: "1.0.0", checkedVersion: "2.0.0" },
    });
    expect(styles()).toHaveLength(0);
    if (!("recipe" in checked)) throw new Error("revalidation failed");
    service.setRecipes([checked.recipe]);
    await service.scan();
    expect(styles()).toHaveLength(1);
    service.setPluginVersions(new Map([[PACKAGE, "3.0.0"]]));
    expect(styles()).toHaveLength(0);
    expect(service.revalidateRecipe(checked.recipe)).toMatchObject({
      error: expect.stringContaining("differs"),
    });
    root.setAttribute("data-dsh-ui-repair-version", "3.0.0");
    target.removeAttribute("data-dsh-ui-repair-scroll-x");
    expect(service.revalidateRecipe(checked.recipe)).toMatchObject({
      error: expect.stringContaining("contract"),
    });
    await service.scan();
    expect(styles()).toHaveLength(0);
  });

  it("releases an active repair when the anchor becomes ambiguous", async () => {
    const { root, target } = mount();
    const service = runtime();
    const recipe = await capture(service);
    service.setRecipes([recipe]);
    await service.scan();
    expect(service.recipeStatus(recipe).active).toBe(true);
    const duplicate = document.createElement("div");
    duplicate.dataset.dshUiRepairAnchor = "content";
    root.append(duplicate);
    await service.scan();
    expect(service.recipeStatus(recipe).message).toContain("more than once");
    expect(styles()).toHaveLength(0);
    expect(target.getAttribute("data-dsh-ui-repair-target")).toBe(
      "foreign-target r005-1",
    );
    expect(duplicate.hasAttribute("data-dsh-ui-repair-target")).toBe(false);
  });
});
