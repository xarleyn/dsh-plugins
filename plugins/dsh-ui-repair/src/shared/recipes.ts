export const MAX_REPAIR_RECIPES = 32;

export const RECIPE_RULE_MARKERS = {
  R005: "data-dsh-ui-repair-scroll-x",
  R006: "data-dsh-ui-repair-scroll",
  R007: "data-dsh-ui-repair-scroll",
  R008: "data-dsh-ui-repair-no-shrink",
  R009: "data-dsh-ui-repair-min-width-zero",
  R012: "data-dsh-ui-repair-text-wrap",
} as const;

export type RecipeRule = keyof typeof RECIPE_RULE_MARKERS;

/** Profile-owned layout intent. The live scanner supplies every declaration. */
export interface RepairRecipe {
  readonly schemaVersion: number;
  readonly origin: string;
  readonly packageName: string;
  readonly rootKey: string;
  readonly targetKey: string;
  readonly targetTag: string;
  readonly ruleId: string;
  readonly originalVersion: string;
  readonly checkedVersion: string;
  readonly checkedAt: string;
}

export const RECIPE_ROOT = "data-dsh-ui-repair-root";
export const RECIPE_TARGET = "data-dsh-ui-repair-anchor";
export const RECIPE_VERSION = "data-dsh-ui-repair-version";
export const RECIPE_OWNER = "data-plugin-package";

const KEY = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/u;
const PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/u;

export function versionedPackage(name: string, version: string): boolean {
  return (
    name.length <= 214 &&
    PACKAGE.test(name) &&
    version.length <= 96 &&
    VERSION.test(version)
  );
}

export function isRecipeRule(value: string): value is RecipeRule {
  return Object.hasOwn(RECIPE_RULE_MARKERS, value);
}

export function validRecipe(recipe: RepairRecipe): boolean {
  return (
    recipe.schemaVersion === 1 &&
    recipe.origin === "verified-scan" &&
    versionedPackage(recipe.packageName, recipe.originalVersion) &&
    versionedPackage(recipe.packageName, recipe.checkedVersion) &&
    KEY.test(recipe.rootKey) &&
    KEY.test(recipe.targetKey) &&
    /^[a-z][a-z0-9-]{0,63}$/u.test(recipe.targetTag) &&
    isRecipeRule(recipe.ruleId) &&
    Number.isFinite(Date.parse(recipe.checkedAt))
  );
}

export function recipeKey(recipe: RepairRecipe): string {
  return JSON.stringify([recipe.packageName, recipe.rootKey, recipe.targetKey]);
}
