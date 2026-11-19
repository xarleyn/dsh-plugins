import type { ConfigForm } from "@deepseek-ai/dsh-client-ui-settings/client";
import { useState } from "react";
import type { UIRepairPluginConfig } from "../shared/config.js";
import {
  MAX_REPAIR_RECIPES,
  recipeKey,
  type RepairRecipe,
} from "../shared/recipes.js";
import type { UIRepairRuntime } from "./runtime.js";

export function RecipeControls({
  settings,
  runtime,
  recipes,
  writable,
}: {
  readonly settings: ConfigForm<UIRepairPluginConfig>;
  readonly runtime: UIRepairRuntime;
  readonly recipes: readonly RepairRecipe[];
  readonly writable: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const savable = runtime.savableRepairs();

  async function change(
    update: (current: readonly RepairRecipe[]) => readonly RepairRecipe[],
  ): Promise<void> {
    const snapshot = settings.getSnapshot();
    if (
      busy ||
      snapshot.status !== "ready" ||
      !snapshot.writable ||
      snapshot.revision === undefined
    )
      return;
    setError("");
    setBusy(true);
    try {
      const next = update(snapshot.value?.recipes ?? []);
      if (
        !(await settings.mutate(
          [
            {
              op: "set",
              path: ["recipes"],
              value: next.map((recipe) => ({ ...recipe })),
            },
          ],
          snapshot.revision,
        ))
      ) {
        setError(
          "The settings changed or the Host refused the write. Try again.",
        );
      }
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : "The settings write failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  function save(id: string): void {
    void change((current) => {
      const found = runtime.savableRepairs().find((entry) => entry.id === id);
      if (found === undefined)
        throw new Error("The verified repair is no longer available.");
      if (
        current.length >= MAX_REPAIR_RECIPES ||
        current.some((recipe) => recipeKey(recipe) === recipeKey(found.recipe))
      ) {
        throw new Error(
          "This target already has a recipe or the recipe limit was reached.",
        );
      }
      return [...current, found.recipe];
    });
  }

  function edit(recipe: RepairRecipe, index: number, remove: boolean): void {
    void change((current) => {
      if (JSON.stringify(current[index]) !== JSON.stringify(recipe)) {
        throw new Error(
          "The recipe changed. Try again with the current entry.",
        );
      }
      if (remove) return current.filter((_, position) => position !== index);
      const checked = runtime.revalidateRecipe(recipe);
      if ("error" in checked) throw new Error(checked.error);
      return current.map((entry, position) =>
        position === index ? checked.recipe : entry,
      );
    });
  }

  return (
    <section className="uir-section" data-testid="repair-recipes">
      <h3 className="uir-section-title">Saved repairs</h3>
      {recipes.length === 0 && savable.length === 0 ? (
        <p className="uir-muted">
          Apply a repair on an opted-in plugin target to save it here.
        </p>
      ) : null}
      <ul className="uir-issues">
        {savable.map(({ id, recipe }) => (
          <li key={id} className="uir-issue">
            <span>
              {recipe.packageName} · {recipe.targetKey} · {recipe.ruleId}
            </span>
            <div className="uir-issue-actions">
              <button
                type="button"
                className="uir-button"
                disabled={
                  !writable || busy || recipes.length >= MAX_REPAIR_RECIPES
                }
                data-testid="repair-recipe-save"
                onClick={() => save(id)}
              >
                Save verified repair
              </button>
            </div>
          </li>
        ))}
        {recipes.map((recipe, index) => {
          const status = runtime.recipeStatus(recipe);
          return (
            <li
              key={`${recipeKey(recipe)}-${index}`}
              className="uir-issue"
              data-testid="repair-recipe-row"
            >
              <span>
                {recipe.packageName} · {recipe.targetKey} · {recipe.ruleId}
              </span>
              <span className="uir-muted">{status.message}</span>
              <div className="uir-issue-actions">
                {status.active ? null : (
                  <button
                    type="button"
                    className="uir-button"
                    disabled={!writable || busy}
                    data-testid="repair-recipe-revalidate"
                    onClick={() => edit(recipe, index, false)}
                  >
                    Revalidate
                  </button>
                )}
                <button
                  type="button"
                  className="uir-button"
                  disabled={!writable || busy}
                  data-testid="repair-recipe-remove"
                  onClick={() => edit(recipe, index, true)}
                >
                  Remove saved repair
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {error === "" ? null : (
        <p
          className="uir-error"
          role="status"
          data-testid="repair-recipe-error"
        >
          {error}
        </p>
      )}
    </section>
  );
}
