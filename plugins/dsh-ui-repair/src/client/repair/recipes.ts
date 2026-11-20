import {
  isRecipeRule,
  MAX_REPAIR_RECIPES,
  RECIPE_OWNER,
  RECIPE_ROOT,
  RECIPE_RULE_MARKERS,
  RECIPE_TARGET,
  RECIPE_VERSION,
  recipeKey,
  validRecipe,
  type RepairRecipe,
} from "../../shared/recipes.js";
import type { RepairCandidate } from "../types.js";
import { applyVerified, RepairEngine } from "./engine.js";

type Located = { readonly root: HTMLElement; readonly target: HTMLElement };
type Resolution =
  | { readonly ok: true; readonly location: Located; readonly version: string }
  | { readonly ok: false; readonly message: string };

export interface RecipeStatus {
  readonly message: string;
  readonly active: boolean;
}

function scopeOf(candidate: RepairCandidate) {
  return {
    packageName: candidate.root.getAttribute(RECIPE_OWNER) ?? "",
    rootKey: candidate.root.getAttribute(RECIPE_ROOT) ?? "",
    targetKey: candidate.target.getAttribute(RECIPE_TARGET) ?? "",
  };
}

function sameScope(recipe: RepairRecipe, candidate: RepairCandidate): boolean {
  const root = candidate.target.closest(`[${RECIPE_OWNER}][${RECIPE_ROOT}]`);
  return (
    root?.getAttribute(RECIPE_OWNER) === recipe.packageName &&
    root.getAttribute(RECIPE_ROOT) === recipe.rootKey &&
    candidate.target.getAttribute(RECIPE_TARGET) === recipe.targetKey
  );
}

/** Profile-owned recipes and browser-owned reversible applications. */
export class SavedRepairs {
  readonly #engine: RepairEngine;
  readonly #active = new Map<string, RepairCandidate>();
  readonly #failed = new Map<string, HTMLElement>();
  #statuses = new Map<string, RecipeStatus>();
  #recipes: readonly RepairRecipe[] = [];
  #versions: ReadonlyMap<string, string> = new Map();
  #enabled = false;
  #paused = false;
  #generation = 0;
  #queue = Promise.resolve();

  constructor(
    private readonly document: Document,
    private readonly detect: (root: HTMLElement) => readonly RepairCandidate[],
    private readonly releaseTemporary: (
      target: HTMLElement,
      ruleId: string,
    ) => boolean,
    private readonly notify: () => void,
  ) {
    this.#engine = new RepairEngine(document);
  }

  configure(
    recipes: readonly RepairRecipe[],
    enabled: boolean,
    policyChanged = false,
  ): void {
    if (
      !policyChanged &&
      enabled === this.#enabled &&
      JSON.stringify(recipes) === JSON.stringify(this.#recipes)
    )
      return;
    this.#recipes = recipes.slice(0, MAX_REPAIR_RECIPES);
    this.#enabled = enabled;
    this.#invalidate();
  }

  setVersions(versions: ReadonlyMap<string, string>): void {
    if (
      versions.size === this.#versions.size &&
      [...versions].every(
        ([name, version]) => this.#versions.get(name) === version,
      )
    )
      return;
    this.#versions = versions;
    this.#invalidate();
  }

  pause(): void {
    this.#paused = true;
    this.#invalidate();
  }

  #invalidate(): void {
    this.#generation++;
    this.#engine.rollbackAll();
    this.#active.clear();
    this.#failed.clear();
    this.#statuses.clear();
    this.notify();
  }

  status(recipe: RepairRecipe): RecipeStatus {
    return (
      this.#statuses.get(recipeKey(recipe)) ?? {
        message: "Waiting for a scoped scan.",
        active: false,
      }
    );
  }

  blocks(candidate: RepairCandidate): boolean {
    return this.#recipes.some(
      (recipe) => validRecipe(recipe) && sameScope(recipe, candidate),
    );
  }

  capture(candidate: RepairCandidate): RepairRecipe | undefined {
    const scope = scopeOf(candidate);
    const version = this.#versions.get(scope.packageName);
    if (version === undefined || this.blocks(candidate)) return undefined;
    const recipe: RepairRecipe = {
      schemaVersion: 1,
      origin: "verified-scan",
      ...scope,
      targetTag: candidate.target.localName,
      ruleId: candidate.issue.ruleId,
      originalVersion: version,
      checkedVersion: version,
      checkedAt: new Date().toISOString(),
    };
    const resolved = this.#locate(recipe);
    return resolved.ok &&
      resolved.location.root === candidate.root &&
      resolved.location.target === candidate.target
      ? recipe
      : undefined;
  }

  revalidate(
    recipe: RepairRecipe,
  ): { readonly recipe: RepairRecipe } | { readonly error: string } {
    if (!this.#enabled || this.#paused)
      return { error: "Enable repairs before revalidating." };
    const resolved = this.#locate(recipe);
    if (!resolved.ok) return { error: resolved.message };
    if (this.#candidate(recipe, resolved.location) === undefined) {
      return {
        error: "The current scanner found no applicable repair at this target.",
      };
    }
    return {
      recipe: {
        ...recipe,
        checkedVersion: resolved.version,
        checkedAt: new Date().toISOString(),
      },
    };
  }

  restore(): Promise<void> {
    if (this.#recipes.length === 0) return Promise.resolve();
    const generation = this.#generation;
    const task = this.#queue.then(() => this.#restore(generation));
    this.#queue = task.catch(() => undefined);
    return task;
  }

  async #restore(generation: number): Promise<void> {
    if (generation !== this.#generation) return;
    const statuses = new Map<string, RecipeStatus>();
    const keys = this.#recipes.map(recipeKey);
    for (const recipe of this.#recipes) {
      if (generation !== this.#generation) return;
      const key = recipeKey(recipe);
      const status =
        keys.indexOf(key) !== keys.lastIndexOf(key)
          ? {
              message: "Multiple saved recipes name this target.",
              active: false,
            }
          : await this.#restoreOne(recipe, generation);
      statuses.set(key, status);
    }
    if (
      generation === this.#generation &&
      [...statuses].some(
        ([key, status]) => this.#statuses.get(key)?.message !== status.message,
      )
    ) {
      this.#statuses = statuses;
      this.notify();
    }
  }

  async #restoreOne(
    recipe: RepairRecipe,
    generation: number,
  ): Promise<RecipeStatus> {
    const key = recipeKey(recipe);
    const active = this.#active.get(key);
    const location = this.#locate(recipe);
    const stop = (message: string): RecipeStatus => {
      if (active !== undefined) this.#engine.rollback(active.issue.id);
      this.#active.delete(key);
      return { message, active: false };
    };
    if (!this.#enabled || this.#paused) return stop("Saved repair is paused.");
    if (!location.ok) return stop(location.message);
    if (location.version !== recipe.checkedVersion) {
      return stop(
        `Package updated to ${location.version}. Revalidate before applying.`,
      );
    }
    const { root, target } = location.location;
    if (active?.root === root && active.target === target) {
      return { message: "Applied and verified.", active: true };
    }
    if (active !== undefined) stop("");
    if (this.#failed.get(key) === target)
      return stop("Verification failed. Revalidate before retrying.");
    if (!this.releaseTemporary(target, recipe.ruleId))
      return stop("Another repair owns this target.");
    const candidate = this.#candidate(recipe, location.location);
    if (candidate === undefined)
      return stop(
        "The current scanner found no applicable repair at this target.",
      );
    const outcome = await applyVerified(this.#engine, candidate, () => {
      if (generation !== this.#generation) return false;
      const current = this.#locate(recipe);
      return (
        current.ok &&
        current.version === recipe.checkedVersion &&
        current.location.root === root &&
        current.location.target === target
      );
    });
    if (generation !== this.#generation)
      return { message: "Waiting for a scoped scan.", active: false };
    if (outcome === "verified") {
      this.#active.set(key, candidate);
      return { message: "Applied and verified.", active: true };
    }
    if (outcome === "rolled-back") {
      this.#failed.set(key, target);
      return stop("Verification failed. Revalidate before retrying.");
    }
    return stop("The target changed during verification.");
  }

  #candidate(
    recipe: RepairRecipe,
    { root, target }: Located,
  ): RepairCandidate | undefined {
    return this.detect(root).find(
      (candidate) =>
        candidate.root === root &&
        candidate.target === target &&
        candidate.issue.ruleId === recipe.ruleId &&
        candidate.issue.suggestedCss !== undefined,
    );
  }

  #locate(recipe: RepairRecipe): Resolution {
    const unavailable = (message: string): Resolution => ({
      ok: false,
      message,
    });
    if (!validRecipe(recipe) || !isRecipeRule(recipe.ruleId)) {
      return unavailable("Unsupported saved repair format.");
    }
    const version = this.#versions.get(recipe.packageName);
    if (version === undefined)
      return unavailable("The Host has no confirmed version for this package.");
    const roots = this.document.querySelectorAll(
      `[${RECIPE_OWNER}="${recipe.packageName}"][${RECIPE_ROOT}="${recipe.rootKey}"]`,
    );
    if (roots.length === 0)
      return unavailable("The opted-in plugin area is not mounted.");
    if (roots.length !== 1)
      return unavailable("The plugin area matches more than once.");
    const root = roots[0] as HTMLElement;
    if (root.getAttribute(RECIPE_VERSION) !== version) {
      return unavailable(
        "The rendered package version differs from the Host inventory. Reload the page.",
      );
    }
    const selector = `[${RECIPE_TARGET}="${recipe.targetKey}"]`;
    const targets = [...root.querySelectorAll(selector)];
    if (root.matches(selector)) targets.unshift(root);
    if (targets.length !== 1) {
      return unavailable(
        targets.length === 0
          ? "The saved target is missing."
          : "The saved target matches more than once.",
      );
    }
    const target = targets[0] as HTMLElement;
    if (
      target.namespaceURI !== "http://www.w3.org/1999/xhtml" ||
      target.closest("[data-dsh-ui-repair-ui]") !== null ||
      target.closest(`[${RECIPE_OWNER}]`) !== root ||
      target.closest(`[${RECIPE_ROOT}]`) !== root ||
      target.localName !== recipe.targetTag ||
      !target.hasAttribute(RECIPE_RULE_MARKERS[recipe.ruleId])
    ) {
      return unavailable(
        "The saved target no longer matches its ownership or layout contract.",
      );
    }
    return { ok: true, location: { root, target }, version };
  }
}
