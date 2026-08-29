# dsh-l10n-overrides MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and package the v0.1 browser-only DSH plugin described by the repository specification.

**Architecture:** A client composition root registers strict English translation packs, installs a reversible adapter over DSH `LocaleRuntime.translate`, and starts an indexed `MutationObserver` translator. Focused registry, locale, DOM, interpolation, and diagnostics modules are independently testable and fail open at every DSH/browser boundary.

**Tech Stack:** TypeScript 7, pnpm 11, Vitest 4, jsdom 26, tsdown 0.22, DeepSeek Harness 0.1.1-rc.2.

---

## File map

- `package.json` — npm/DSH metadata and verification scripts.
- `tsconfig.json`, `tsconfig.build.json`, `tsdown.config.ts`, `vitest.config.ts` — strict compilation, DSH browser bundle, and DOM test configuration.
- `src/index.ts` — no-op Host entry required by the ordinary DSH package shape.
- `src/types.ts` — public translation-pack, DOM-rule, and diagnostic contracts.
- `src/registry/diagnostics.ts` — prefixed, collected diagnostics and logger boundary.
- `src/runtime/interpolate.ts` — safe `{name}` replacement.
- `src/registry/translation-registry.ts` — normalized locale and DOM indexes with deterministic collisions.
- `src/adapters/dsh-locale-runtime.ts` — isolated unsafe runtime feature detection and patching.
- `src/runtime/locale-hook.ts` — override lookup, interpolation, debug hits, and disposal.
- `src/runtime/dom-translator.ts` — scoped exact DOM translation, mutation processing, restoration, and disposal.
- `src/packs/example.ts`, `src/packs/index.ts` — example data pack and central pack list.
- `src/client/index.ts` — DSH client composition root.
- `tests/*.test.ts` — unit, DOM, integration, and entrypoint behavior.
- `scripts/verify-package.mjs`, `scripts/verify-client-bundle.mjs` — packed artifact and emitted DSH bundle assertions.
- `README.md`, `LICENSE`, `.gitignore`, `pnpm-workspace.yaml` — authoring and repository basics.

### Task 1: Reproducible client-plugin scaffold

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.json`
- Create: `tsconfig.build.json`
- Create: `tsdown.config.ts`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `src/index.ts`
- Create: `src/client/index.ts`
- Test: `tests/client-index.test.ts`

- [ ] **Step 1: Write the failing entrypoint test**

```ts
import { describe, expect, it } from "vitest";
import { apply, inject } from "../src/client/index.js";

describe("client entrypoint", () => {
  it("declares only the locale runtime dependency", () => {
    expect(inject).toEqual(["locale"]);
    expect(typeof apply).toBe("function");
  });
});
```

- [ ] **Step 2: Run the test to verify the missing scaffold fails**

Run: `pnpm exec vitest run tests/client-index.test.ts`

Expected: FAIL because `package.json` and `src/client/index.ts` do not exist.

- [ ] **Step 3: Add package/config files and minimal entrypoints**

Use package metadata with `main: lib/index.js`, `exports` for `.`, `./client`, `./types`, a `dsh.client` block injecting `@deepseek-ai/dsh-client-locale`, peer range `>=0.1.1-rc.2 <0.2.0`, and scripts `format`, `typecheck`, `test`, `build`, `test:package`, and `check`. Configure tsdown with an ESM no-op Host build plus a CommonJS browser build wrapped in `window.__ModuleLoader__.load({ id: "dsh-l10n-overrides", factory: (require) => { ... } })`.

```ts
// src/index.ts
export function apply(): void {}

// src/client/index.ts
import type { Context } from "@deepseek-ai/cordis";

export const inject = ["locale"];

export function apply(_ctx: Context): () => void {
  return () => undefined;
}
```

- [ ] **Step 4: Install exact dependencies and verify the scaffold**

Run: `pnpm install && pnpm exec vitest run tests/client-index.test.ts && pnpm run typecheck`

Expected: one passing test and a clean typecheck.

- [ ] **Step 5: Commit the scaffold**

```text
git add package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.build.json tsdown.config.ts vitest.config.ts .gitignore src/index.ts src/client/index.ts tests/client-index.test.ts
git commit -m "build: scaffold DSH client plugin"
```

### Task 2: Pack contracts, diagnostics, and interpolation

**Files:**
- Create: `src/types.ts`
- Create: `src/registry/diagnostics.ts`
- Create: `src/runtime/interpolate.ts`
- Test: `tests/diagnostics.test.ts`
- Test: `tests/interpolation.test.ts`

- [ ] **Step 1: Write failing unit tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { Diagnostics } from "../src/registry/diagnostics.js";
import { interpolate } from "../src/runtime/interpolate.js";

describe("interpolate", () => {
  it("replaces known values and keeps missing or nullish placeholders", () => {
    expect(interpolate("Hi {name}; {missing}; {nil}", { name: "Ada", nil: null })).toBe(
      "Hi Ada; {missing}; {nil}",
    );
  });
});

describe("Diagnostics", () => {
  it("collects immutable entries and prefixes logger output", () => {
    const error = vi.fn();
    const diagnostics = new Diagnostics({ error, warn: vi.fn(), info: vi.fn(), debug: vi.fn() });
    diagnostics.error("duplicate_override", "duplicate");
    expect(error).toHaveBeenCalledWith("[dsh-l10n-overrides] duplicate");
    expect(diagnostics.snapshot()).toEqual([{ level: "error", code: "duplicate_override", message: "duplicate" }]);
  });
});
```

- [ ] **Step 2: Confirm the tests fail**

Run: `pnpm exec vitest run tests/interpolation.test.ts tests/diagnostics.test.ts`

Expected: FAIL with unresolved source modules.

- [ ] **Step 3: Implement the contracts and utilities**

```ts
export type DomTranslationAttribute = "placeholder" | "title" | "aria-label" | "alt";
export interface DomTranslationRule {
  readonly source: string;
  readonly target: string;
  readonly scope: string;
  readonly mode?: "exact";
  readonly attributes?: readonly DomTranslationAttribute[];
}
export interface TranslationPack {
  readonly id: string;
  readonly target: { readonly package: string; readonly versions?: string };
  readonly en: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly dom?: readonly DomTranslationRule[];
  readonly metadata?: { readonly sourceLanguage?: string; readonly description?: string; readonly upstream?: string };
}
export interface DiagnosticEntry {
  readonly level: "info" | "warning" | "error" | "debug";
  readonly code: string;
  readonly message: string;
}

export function interpolate(template: string, params?: Record<string, unknown>): string {
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === null || value === undefined ? match : String(value);
  });
}
```

Implement `Diagnostics` with an injected `Pick<Console, "info" | "warn" | "error" | "debug">`, copied snapshots, debug gating, and the fixed prefix.

- [ ] **Step 4: Verify and commit**

Run: `pnpm exec vitest run tests/interpolation.test.ts tests/diagnostics.test.ts && pnpm run typecheck`

Expected: all tests pass.

```text
git add src/types.ts src/registry/diagnostics.ts src/runtime/interpolate.ts tests/diagnostics.test.ts tests/interpolation.test.ts
git commit -m "feat: add pack contracts and diagnostics"
```

### Task 3: Deterministic translation registry

**Files:**
- Create: `src/registry/translation-registry.ts`
- Test: `tests/registry.test.ts`

- [ ] **Step 1: Write failing registry tests**

```ts
import { describe, expect, it } from "vitest";
import { Diagnostics } from "../src/registry/diagnostics.js";
import { TranslationPackRegistry } from "../src/registry/translation-registry.js";

const pack = (id: string, title: string) => ({
  id,
  target: { package: `target-${id}` },
  en: { "example.settings": { title } },
  dom: [{ scope: id === "global" ? "global" : ".example", source: "设置", target: title }],
} as const);

describe("TranslationPackRegistry", () => {
  it("resolves exact English values and exposes DOM rules", () => {
    const registry = new TranslationPackRegistry(new Diagnostics());
    registry.register(pack("base", "Settings"));
    expect(registry.resolve("en", "example.settings", "title")).toBe("Settings");
    expect(registry.resolve("zh", "example.settings", "title")).toBeUndefined();
    expect(registry.getDomRules("en")).toHaveLength(1);
  });

  it("keeps the first duplicate and records the collision", () => {
    const diagnostics = new Diagnostics();
    const registry = new TranslationPackRegistry(diagnostics);
    registry.register(pack("first", "First"));
    registry.register(pack("second", "Second"));
    expect(registry.resolve("en", "example.settings", "title")).toBe("First");
    expect(diagnostics.snapshot().some((entry) => entry.code === "duplicate_override")).toBe(true);
  });
});
```

- [ ] **Step 2: Confirm the tests fail**

Run: `pnpm exec vitest run tests/registry.test.ts`

Expected: FAIL because the registry is missing.

- [ ] **Step 3: Implement normalized indexes**

```ts
type OverrideEntry = { readonly value: string; readonly packId: string };

export class TranslationPackRegistry {
  readonly #overrides = new Map<string, OverrideEntry>();
  readonly #domRules = new Map<string, DomTranslationRule[]>();

  constructor(private readonly diagnostics: Diagnostics) {}

  register(pack: TranslationPack): void {
    for (const [namespace, entries] of Object.entries(pack.en)) {
      for (const [key, value] of Object.entries(entries)) {
        const index = JSON.stringify(["en", namespace, key]);
        const previous = this.#overrides.get(index);
        if (previous !== undefined) {
          this.diagnostics.error("duplicate_override", `duplicate translation override: locale=en namespace=${namespace} key=${key} packs=${previous.packId}, ${pack.id}`);
          continue;
        }
        this.#overrides.set(index, { value, packId: pack.id });
      }
    }
    const rules = this.#domRules.get("en") ?? [];
    rules.push(...(pack.dom ?? []));
    this.#domRules.set("en", rules);
  }
}
```

Add `resolve`, `resolveEntry` for debug ownership, `getDomRules` returning a copied readonly array, and aggregate counts. Warn once per pack containing `scope: "global"`.

- [ ] **Step 4: Verify and commit**

Run: `pnpm exec vitest run tests/registry.test.ts && pnpm run typecheck`

Expected: all registry tests pass.

```text
git add src/registry/translation-registry.ts tests/registry.test.ts
git commit -m "feat: add deterministic translation registry"
```

### Task 4: Reversible DSH locale hook

**Files:**
- Create: `src/adapters/dsh-locale-runtime.ts`
- Create: `src/runtime/locale-hook.ts`
- Test: `tests/locale-hook.test.ts`

- [ ] **Step 1: Write failing adapter/hook tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { Diagnostics } from "../src/registry/diagnostics.js";
import { TranslationPackRegistry } from "../src/registry/translation-registry.js";
import { installLocaleHook } from "../src/runtime/locale-hook.js";

function runtime(active = "en") {
  return {
    active,
    translate(namespace: string, key: string) { return `${this.active}:${namespace}:${key}`; },
    getSnapshot() { return { active: this.active, revision: 0 }; },
    subscribe() { return () => undefined; },
    bind(namespace: string) { return (key: string, params?: Record<string, unknown>) => this.translate(namespace, key, params); },
  };
}

describe("installLocaleHook", () => {
  it("overrides pre-bound translators, interpolates, delegates misses, and restores", () => {
    const locale = runtime();
    const bound = locale.bind("example.settings");
    const original = locale.translate;
    const registry = new TranslationPackRegistry(new Diagnostics());
    registry.register({ id: "example", target: { package: "example" }, en: { "example.settings": { title: "Hello {name}" } } });
    const dispose = installLocaleHook(locale, registry, new Diagnostics());
    expect(bound("title", { name: "Ada" })).toBe("Hello Ada");
    expect(bound("missing")).toBe("en:example.settings:missing");
    dispose();
    expect(locale.translate).toBe(original);
  });

  it("fails open for incompatible runtimes", () => {
    expect(() => installLocaleHook({}, new TranslationPackRegistry(new Diagnostics()), new Diagnostics())).not.toThrow();
  });
});
```

- [ ] **Step 2: Confirm the tests fail**

Run: `pnpm exec vitest run tests/locale-hook.test.ts`

Expected: FAIL because hook modules are missing.

- [ ] **Step 3: Implement feature detection and patching**

```ts
export interface PatchableLocaleRuntime {
  translate(namespace: string, key: string, params?: Record<string, unknown>): string;
  getSnapshot(): { readonly active: string; readonly revision: number };
  subscribe(listener: () => void): () => void;
}

export function asPatchableLocaleRuntime(value: unknown): PatchableLocaleRuntime | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Partial<PatchableLocaleRuntime>;
  return typeof candidate.translate === "function" && typeof candidate.getSnapshot === "function" && typeof candidate.subscribe === "function"
    ? candidate as PatchableLocaleRuntime
    : undefined;
}
```

`installLocaleHook` must keep the original function, install a normal function (not an arrow) that reads the adapter snapshot, resolve only exact active-locale entries, interpolate hits, call `original.call(runtime, ...)` on misses, record debug hits, reject a second owned installation through a module-level `WeakSet`, and return an idempotent disposer that conditionally restores the original.

- [ ] **Step 4: Verify and commit**

Run: `pnpm exec vitest run tests/locale-hook.test.ts && pnpm run typecheck`

Expected: pre-bound, fallback, locale, `this`, duplicate install, foreign-wrapper, and disposal tests pass.

```text
git add src/adapters/dsh-locale-runtime.ts src/runtime/locale-hook.ts tests/locale-hook.test.ts
git commit -m "feat: install reversible locale override hook"
```

### Task 5: Scoped reversible DOM translator

**Files:**
- Create: `src/runtime/dom-translator.ts`
- Test: `tests/dom-translator.test.ts`

- [ ] **Step 1: Write failing DOM safety and lifecycle tests**

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { DomTranslator } from "../src/runtime/dom-translator.js";

const rule = { scope: ".plugin", source: "设置", target: "Settings" } as const;

describe("DomTranslator", () => {
  afterEach(() => document.body.replaceChildren());

  it("translates existing and dynamic scoped text, then restores it", async () => {
    document.body.innerHTML = '<section class="plugin"><button> 设置 </button></section><button>设置</button>';
    const translator = new DomTranslator(document, [rule]);
    translator.setLocale("en");
    expect(document.querySelector(".plugin button")?.textContent).toBe(" Settings ");
    document.querySelector(".plugin")?.insertAdjacentHTML("beforeend", "<button>设置</button>");
    await new Promise(queueMicrotask);
    expect(document.querySelectorAll(".plugin button")[1]?.textContent).toBe("Settings");
    translator.setLocale("zh");
    expect(document.querySelector(".plugin button")?.textContent).toBe(" 设置 ");
    translator.dispose();
  });

  it("never changes excluded content and translates whitelisted attributes", () => {
    document.body.innerHTML = '<section class="plugin"><code>设置</code><div contenteditable="true">设置</div><input placeholder="请输入名称"></section>';
    const translator = new DomTranslator(document, [rule, { scope: ".plugin", source: "请输入名称", target: "Enter a name", attributes: ["placeholder"] }]);
    translator.setLocale("en");
    expect(document.querySelector("code")?.textContent).toBe("设置");
    expect(document.querySelector("[contenteditable]")?.textContent).toBe("设置");
    expect(document.querySelector("input")?.getAttribute("placeholder")).toBe("Enter a name");
    translator.dispose();
  });
});
```

- [ ] **Step 2: Confirm the DOM tests fail**

Run: `pnpm exec vitest run tests/dom-translator.test.ts`

Expected: FAIL because `DomTranslator` is missing.

- [ ] **Step 3: Implement indexed scoped mutation processing**

```ts
const EXCLUDED = "input,textarea,pre,code,kbd,samp,script,style,[contenteditable],[data-no-translate],[data-message-id],[data-testid*='conversation'],[class*='markdown'],[class*='terminal'],[class*='editor']";
type OriginalText = { readonly original: string; readonly translated: string };
type OriginalAttribute = { readonly original: string; readonly translated: string };

export class DomTranslator {
  readonly #textOriginals = new WeakMap<Text, OriginalText>();
  readonly #attributeOriginals = new WeakMap<Element, Map<string, OriginalAttribute>>();
  readonly #translatedTexts = new Set<Text>();
  readonly #translatedElements = new Set<Element>();
  #active = false;
  #disposed = false;

  setLocale(locale: string): void {
    if (this.#disposed) return;
    if (locale === "en") { this.#active = true; this.scanDeclaredScopes(); }
    else { this.#active = false; this.restore(); }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#observer.disconnect();
    this.restore();
  }
}
```

Complete the constructor index as `Map<scope, { text: Map<source, rule>, attributes: Map<attribute, Map<source, rule>> }>`; observe `childList`, `subtree`, `characterData`, and only the whitelisted attributes used by registered rules. Resolve `global` to `document.body`, catch invalid selectors, scan each declared scope once, walk only mutation targets/added subtrees, preserve text whitespace, enforce excluded ancestors, and restore only values still equal to the translated value.

- [ ] **Step 4: Expand tests for performance boundaries and verify**

Add assertions for wrong scopes, text fragments that are not exact matches, `textarea`, user-message/Markdown/editor/terminal selectors, character-data changes, attribute mutations, invalid selectors, global rules, no full-body mutation rescans, idempotent locale transitions, external value changes, and disposal.

Run: `pnpm exec vitest run tests/dom-translator.test.ts && pnpm run typecheck`

Expected: all DOM tests pass without uncaught jsdom observer errors.

- [ ] **Step 5: Commit the DOM runtime**

```text
git add src/runtime/dom-translator.ts tests/dom-translator.test.ts
git commit -m "feat: add reversible scoped DOM translations"
```

### Task 6: Compose built-in packs and DSH lifecycle

**Files:**
- Create: `src/packs/example.ts`
- Create: `src/packs/index.ts`
- Modify: `src/client/index.ts`
- Test: `tests/integration.test.ts`
- Modify: `tests/client-index.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { apply } from "../src/client/index.js";

describe("client integration", () => {
  it("activates locale and DOM overrides and disposes both", () => {
    document.body.innerHTML = '<section data-plugin="example-plugin"><button>设置</button></section>';
    const locale = {
      translate(namespace: string, key: string) { return `${namespace}:${key}`; },
      getSnapshot: () => ({ active: "en", revision: 0 }),
      subscribe: () => () => undefined,
    };
    const original = locale.translate;
    const dispose = apply({ locale } as never);
    expect(locale.translate("example.settings", "title")).toBe("Settings");
    expect(document.querySelector("button")?.textContent).toBe("Settings");
    dispose();
    expect(locale.translate).toBe(original);
    expect(document.querySelector("button")?.textContent).toBe("设置");
  });
});
```

- [ ] **Step 2: Confirm the integration test fails**

Run: `pnpm exec vitest run tests/integration.test.ts tests/client-index.test.ts`

Expected: FAIL because the composition root is still a no-op.

- [ ] **Step 3: Add the example pack and composition root**

```ts
export default {
  id: "example-plugin-en",
  target: { package: "dsh-example-plugin", versions: ">=0.4.0 <1.0.0" },
  en: { "example.settings": { title: "Settings", enabled: "Enabled", server: "Server address", save: "Save" } },
  dom: [{ scope: '[data-plugin="example-plugin"]', source: "设置", target: "Settings" }],
  metadata: { sourceLanguage: "zh", description: "Example English translation pack" },
} satisfies TranslationPack;
```

The client `apply` constructs diagnostics and registry, registers `translationPacks`, adapts and hooks `ctx.locale`, creates `DomTranslator` only when `document` and `MutationObserver` exist, subscribes to runtime snapshots, applies the initial locale, logs one summary, and returns one idempotent disposer. Each capability is wrapped in a narrow failure-open boundary.

- [ ] **Step 4: Verify and commit**

Run: `pnpm exec vitest run tests/client-index.test.ts tests/integration.test.ts && pnpm run test && pnpm run typecheck`

Expected: the full test suite passes.

```text
git add src/client/index.ts src/packs/example.ts src/packs/index.ts tests/client-index.test.ts tests/integration.test.ts
git commit -m "feat: compose translation override client"
```

### Task 7: Published artifact, documentation, and final verification

**Files:**
- Create: `scripts/verify-package.mjs`
- Create: `scripts/verify-client-bundle.mjs`
- Create: `README.md`
- Create: `LICENSE`
- Modify: `package.json`

- [ ] **Step 1: Write artifact checks before building**

```js
// scripts/verify-client-bundle.mjs
import { readFile } from "node:fs/promises";
const client = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");
for (const required of ['id: "dsh-l10n-overrides"', "example.settings", "MutationObserver"]) {
  if (!client.includes(required)) throw new Error(`client bundle is missing ${required}`);
}
for (const forbidden of ["patch-package", "setInterval(", "innerHTML =", "target-plugin/src/"]) {
  if (client.includes(forbidden)) throw new Error(`client bundle contains forbidden token ${forbidden}`);
}
```

`verify-package.mjs` must run `pnpm pack --json --pack-destination` in a temporary directory, parse the produced tarball using `tar -tf`, assert the allowlisted `package/` paths, assert required exports and DSH injection metadata from packed `package.json`, and always delete the temporary directory.

- [ ] **Step 2: Run checks to establish the pre-documentation state**

Run: `pnpm run build && pnpm run test:package`

Expected: bundle verification passes; package verification reports missing required README/license content until those files are added.

- [ ] **Step 3: Add authoring and compatibility documentation**

README must include installation, DSH configuration, the outside-translation architecture, locale and DOM mechanisms, a complete pack example, the three-step add-pack workflow, scope/global safety, denylisted surfaces, version metadata semantics, diagnostics/debug behavior, compatibility range, limitations, test commands, and the non-affiliation statement required by the specification. Add the MIT license and ensure package `files` contains only built JS/declarations, README, SPEC, and LICENSE.

- [ ] **Step 4: Run complete verification**

Run: `pnpm run check`

Expected: Prettier, strict typecheck, every Vitest test, both builds, packed artifact verification, and client bundle verification all pass.

- [ ] **Step 5: Inspect repository and packed output**

Run: `git status --short && git diff --check && pnpm pack --dry-run`

Expected: only intended documentation/script changes are uncommitted, no whitespace errors, and the dry-run file list contains no source tests, caches, or untracked build directories.

- [ ] **Step 6: Commit documentation and packaging**

```text
git add package.json scripts/verify-package.mjs scripts/verify-client-bundle.mjs README.md LICENSE
git commit -m "docs: document translation pack authoring"
```

- [ ] **Step 7: Final clean verification**

Run: `pnpm run check && git status --short && git log --oneline --decorate -8`

Expected: all checks pass, the working tree is clean, and focused implementation commits are visible.
