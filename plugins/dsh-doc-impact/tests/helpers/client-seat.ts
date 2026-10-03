// The stand the client bundle tests drive the card through: a ModuleLoader that
// really evaluates `lib/client.js` in a sandbox, a `slots` service that records what
// the entry claims, and a Host `ConfigForm` over a nested namespace document.
//
// It is a module rather than a copy because the two files that use it split the same
// bundle by concern — where the card is seated, and what it writes — and the split is
// what keeps either of them inside the repository's test-file budget. Duplicating the
// stand to get there would have left two fakes of one Host contract to drift apart.
import { createModuleLoaderStub } from "@yadsh/dsh-test-kit";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { join } from "node:path";

// This module sits one level below the tests that use it, so the package root is
// two steps up — not the one step these paths took while they lived beside them.
const PACKAGE_ROOT = join(import.meta.dirname, "..", "..");
const CLIENT_BUNDLE_PATH = join(PACKAGE_ROOT, "lib", "client.js");
export const PATCH_PATH = join(PACKAGE_ROOT, "cordis.patch.yml");

/**
 * The row's one-liner as the Host reads it: the `description` field of the
 * installed manifest, which fills the page's `<p>` before the seat is ever asked
 * for its `summary` view. Read from the manifest rather than repeated as a literal,
 * so the answer a bundle that declares no description gets is checked against the
 * same sentence the other rows are checked against — and an edit to the manifest
 * cannot be missed by a string copied into a test.
 */
export const MANIFEST_DESCRIPTION: string = (
  JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {
    description: string;
  }
).description;

/** One `locale.register` call, as the entry made it. */
export interface LocaleRegistration {
  namespace: string;
  dictionaries: Record<string, Record<string, string>>;
}

export interface SlotEntry {
  options: {
    name: string;
    key?: string;
    locale?: string;
    inject?: () => unknown;
  };
  component: unknown;
}

export interface LoadedBundle {
  id: string;
  factory: (requireFn: (name: string) => unknown) => {
    name: string;
    inject: string[];
    apply: (ctx: Record<string, unknown>) => () => void;
  };
}

export function fakeReact() {
  return {
    createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({
      type,
      props,
      children,
    }),
    useState: (initial: unknown) => [initial, () => undefined],
    useSyncExternalStore: () => undefined,
  };
}

export interface FormState {
  status: "loading" | "ready" | "unavailable";
  value?: Record<string, unknown>;
  base?: Record<string, unknown>;
  user?: Record<string, unknown>;
  writable: boolean;
}

export interface WrittenOp {
  op: "set" | "unset";
  path: string[];
  value?: unknown;
  revision: number;
}

function at(node: unknown, path: readonly string[]): unknown {
  let current = node;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** Write one path into a copy of the document, creating the objects it passes. */
function through(
  source: Record<string, unknown> | undefined,
  path: readonly string[],
  value: unknown,
): Record<string, unknown> {
  const root: Record<string, unknown> = { ...(source ?? {}) };
  let node = root;
  for (let i = 0; i < path.length - 1; i++) {
    const next = node[path[i]!];
    const copy: Record<string, unknown> = {
      ...(typeof next === "object" && next !== null ? next : undefined),
    };
    node[path[i]!] = copy;
    node = copy;
  }
  const last = path[path.length - 1]!;
  if (value === undefined) delete node[last];
  else node[last] = value;
  return root;
}

/**
 * The host `ConfigForm` a card reaches through `ctx.configForms`: a synced
 * snapshot of one namespace document plus ordered, revision-fenced path
 * operations. The document keeps the nested profile shape (`defaults.mode`,
 * `safety.*`), so this stand is nested too — a flat one would keep passing while
 * every real write landed nowhere.
 */
export function fakeForm(initial: FormState) {
  let state = initial;
  let revision = 0;
  const listeners = new Set<() => void>();
  const writes: WrittenOp[] = [];
  const emit = () => listeners.forEach((listener) => listener());
  return {
    writes,
    /** How many listeners the card still holds on this controller. */
    get listenerCount(): number {
      return listeners.size;
    },
    getSnapshot: () => ({ ...state, revision, mode: "host" as const }),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async mutate(
      ops: readonly { op: "set" | "unset"; path: string[]; value?: unknown }[],
      expectedRevision?: number,
    ) {
      // The Host refuses a write whose fence it has already moved past.
      if (expectedRevision !== undefined && expectedRevision !== revision)
        return false;
      revision += 1;
      for (const op of ops) {
        writes.push({ ...op, revision });
        const value = op.op === "unset" ? undefined : op.value;
        state = {
          ...state,
          user: through(state.user, op.path, value),
          value: through(state.value, op.path, value),
        };
      }
      emit();
      return true;
    },
    /**
     * The Host's form answers these as well. The card only ever writes
     * field-granular *paths* through `mutate`, because the namespace document
     * keeps its nested shape (`defaults.mode`), so a call reaching here means the
     * card stopped addressing that shape — which is a bug, not a mode of writing.
     */
    set: async () => {
      throw new Error("the card writes paths through mutate");
    },
    unset: async () => {
      throw new Error("the card writes paths through mutate");
    },
    /** Move the composition layer under the document, the way an entry config edit does. */
    setBase(path: readonly string[], value: unknown) {
      const base = through(state.base, path, value);
      const overridden = at(state.user, path) !== undefined;
      state = {
        ...state,
        base,
        value: overridden ? state.value : through(state.value, path, value),
      };
      emit();
    },
  };
}

export function makeCtx(form: unknown, options: { served?: boolean } = {}) {
  const registered: SlotEntry[] = [];
  const slotInjections: string[] = [];
  const servedRequests: string[][] = [];
  const namespacesRead: string[] = [];
  const localeRegistrations: LocaleRegistration[] = [];
  /*
   * Everything the entry claims from the Host services, in the order it claimed it.
   * The dictionaries a card translates with have to be filed with the locale service
   * before the seat that declares them is handed over — the renderer builds `t` off
   * the namespace at assembly time — so a registration that lost its `locale.register`
   * call, or moved behind the seat, would show the operator raw keys while every
   * needle in the bundle still matched. Order is the only shape that failure has.
   */
  const calls: string[] = [];
  const served = options.served !== false;
  const ctx = {
    registered,
    slotInjections,
    servedRequests,
    namespacesRead,
    localeRegistrations,
    calls,
    // The client runtime exposes declared inject services as context
    // properties, so the stub mirrors that contract (the former ctx.get
    // indirection was a 0.1.1 leftover that left the card unregistered).
    locale: {
      register(
        namespace: string,
        dictionaries: Record<string, Record<string, string>>,
      ) {
        calls.push(`locale:${namespace}`);
        localeRegistrations.push({ namespace, dictionaries });
      },
    },
    // The shape of the real Host service: `get` always answers a controller, even
    // for a name the profile does not carry, and `whileServed` follows the
    // `settings.describe` mirror — which a non-loopback page leaves terminally
    // unavailable. The stub keeps both so a card that went back to claiming its
    // seat from the watch shows up here as a seat that was never claimed.
    configForms:
      form === undefined
        ? undefined
        : {
            get: (namespace: string) => {
              namespacesRead.push(namespace);
              return form;
            },
            whileServed(
              namespaces: readonly string[],
              register: (servedNamespaces: ReadonlySet<string>) => () => void,
            ) {
              servedRequests.push([...namespaces]);
              if (!served) return () => undefined;
              const remove = register(new Set(namespaces));
              let ended = false;
              // What the Host's own declaration promises: this disposer ends the
              // watch *and* drops the registration that is live.
              return () => {
                if (ended) return;
                ended = true;
                remove();
              };
            },
          },
    slots: {
      // The card bootstrap registers through a plain factory that returns the
      // register disposer (the shared host contract), not a generator.
      inject(slot: string, factory: () => () => unknown) {
        slotInjections.push(slot);
        calls.push(`inject:${slot}`);
        const remove = factory();
        return () => {
          remove();
        };
      },
      register(options: SlotEntry["options"], component: unknown) {
        calls.push(`register:${options.name}`);
        const entry = { options, component };
        registered.push(entry);
        return () => {
          const at = registered.indexOf(entry);
          if (at >= 0) registered.splice(at, 1);
        };
      },
    },
  };
  return ctx;
}

export async function loadBundle(): Promise<LoadedBundle> {
  const source = await readFile(CLIENT_BUNDLE_PATH, "utf8");
  const loader = createModuleLoaderStub();
  const sandbox = { window: loader.window };
  vm.createContext(sandbox);
  new vm.Script(source, { filename: "client.js" }).runInContext(sandbox);
  if (loader.registrations.length === 0)
    throw new Error("bundle never called ModuleLoader.load");
  return loader.registrations[0]! as LoadedBundle;
}

/** Where each card field stands inside the namespace document. */
export const PATHS = {
  configFile: ["configFile"],
  debug: ["debug"],
  limitTemplate: ["limitTemplate"],
  maxSnapshotFiles: ["changeDetection", "maxSnapshotFiles"],
  mode: ["defaults", "mode"],
  reminderTemplate: ["reminderTemplate"],
} as const;

export interface CardFace {
  hooks: { docImpactCard: { getSnapshot: () => Record<string, any> } };
  edit: (field: string, text: string) => void;
  choose: (field: string, value: unknown) => void;
  resetField: (field: string) => void;
  save: () => Promise<void>;
  discard: () => void;
}

export function faceOf(ctx: ReturnType<typeof makeCtx>): CardFace {
  return ctx.registered[0]!.options.inject!() as CardFace;
}

/**
 * The seat's entry picks the component for the view the page asked for, so a test
 * renders one level down: the entry hands back the element, and rendering that
 * element's own component is what produces the view's output.
 */
export function renderEntry(
  entry: (props: Record<string, unknown>) => any,
  props: Record<string, unknown>,
): any {
  const element = entry(props);
  return typeof element?.type === "function"
    ? element.type(element.props)
    : element;
}
