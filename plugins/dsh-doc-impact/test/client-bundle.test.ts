import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { join } from 'node:path';

const BUNDLE_PATH = join(import.meta.dirname, '..', 'lib', 'client.js');

interface SlotEntry {
  options: { name: string; key?: string; locale?: string; inject?: () => unknown };
  component: unknown;
}

interface LoadedBundle {
  id: string;
  factory: (requireFn: (name: string) => unknown) => {
    name: string;
    inject: string[];
    apply: (ctx: Record<string, unknown>) => void;
  };
}

function fakeReact() {
  return {
    createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }),
    useState: (initial: unknown) => [initial, () => undefined],
    useSyncExternalStore: () => undefined,
  };
}

interface ScopeState {
  status: 'loading' | 'ready' | 'unavailable';
  value?: Record<string, unknown>;
  base?: Record<string, unknown>;
  user?: Record<string, unknown>;
  writable: boolean;
}

function fakeScope(initial: ScopeState) {
  let state = initial;
  const listeners = new Set<() => void>();
  const sets: [string, unknown][] = [];
  const unsets: string[] = [];
  const emit = () => listeners.forEach((listener) => listener());
  return {
    sets,
    unsets,
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async set(field: string, value: unknown) {
      sets.push([field, value]);
      state = {
        ...state,
        user: { ...(state.user ?? {}), [field]: value },
        value: { ...(state.value ?? {}), [field]: value },
      };
      emit();
    },
    async unset(field: string) {
      unsets.push(field);
      const user = { ...(state.user ?? {}) };
      const value = { ...(state.value ?? {}) };
      delete user[field];
      delete value[field];
      state = { ...state, user, value };
      emit();
    },
  };
}

function makeCtx(scope: unknown) {
  const registered: SlotEntry[] = [];
  const slotInjections: string[] = [];
  const ctx = {
    registered,
    slotInjections,
    get(service: string) {
      if (service === 'settingsScope' && scope !== undefined) {
        return { bind: (options: { namespace: string }) => (void options, scope) };
      }
      return undefined;
    },
    slots: {
      inject(slot: string, factory: () => Generator<unknown>) {
        slotInjections.push(slot);
        for (const entry of factory()) registered.push(entry as SlotEntry);
      },
      register(options: SlotEntry['options'], component: unknown) {
        return { options, component };
      },
    },
  };
  return ctx;
}

async function loadBundle(): Promise<LoadedBundle> {
  const source = await readFile(BUNDLE_PATH, 'utf8');
  let captured: LoadedBundle | undefined;
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(meta: LoadedBundle) {
          captured = meta;
        },
      },
    },
  };
  vm.createContext(sandbox);
  new vm.Script(source, { filename: 'client.js' }).runInContext(sandbox);
  if (captured === undefined) throw new Error('bundle never called ModuleLoader.load');
  return captured!;
}

describe('client bundle', () => {
  it('loads as a ModuleLoader module and registers the card into the plugin config slot', async () => {
    const bundle = await loadBundle();
    expect(bundle.id).toBe('dsh-doc-impact');

    const scope = fakeScope({ status: 'ready', value: {}, base: {}, user: {}, writable: true });
    const ctx = makeCtx(scope);
    bundle.factory(fakeReact).apply(ctx);

    expect(ctx.slotInjections).toEqual(['settings.plugin.item']);
    expect(ctx.registered).toHaveLength(1);
    expect(ctx.registered[0]!.options.name).toBe('settings.plugin.item');
    expect(ctx.registered[0]!.options.key).toBe('doc-impact');
    expect(ctx.registered[0]!.component).toBeTypeOf('function');
  });

  it('skips registration when the settingsScope service is absent', async () => {
    const bundle = await loadBundle();
    const ctx = makeCtx(undefined);
    bundle.factory(fakeReact).apply(ctx);
    expect(ctx.registered).toHaveLength(0);
  });

  it('stages edits without writing; save is dirty-gated and commits field-granular writes', async () => {
    const bundle = await loadBundle();
    const scope = fakeScope({
      status: 'ready',
      value: { configFile: '.dsh/doc-impact.yml', mode: 'remind', maxReminderRounds: 2 },
      base: {},
      user: {},
      writable: true,
    });
    const ctx = makeCtx(scope);
    bundle.factory(fakeReact).apply(ctx);

    const face = ctx.registered[0]!.options!.inject!() as {
      hooks: { docImpactCard: { getSnapshot: () => Record<string, any> } };
      edit: (field: string, text: string) => void;
      choose: (field: string, value: unknown) => void;
      resetField: (field: string) => void;
      save: () => Promise<void>;
      discard: () => void;
    };
    const snapshot = () => face.hooks.docImpactCard.getSnapshot();

    // Clean state: save must stay disabled.
    expect(snapshot().available).toBe(true);
    expect(snapshot().dirty).toBe(false);

    // Editing stages locally: dirty, overridden preview, nothing on the wire.
    face.edit('configFile', '.dsh/other.yml');
    expect(snapshot().dirty).toBe(true);
    expect(snapshot().fields.configFile.overridden).toBe(true);
    expect(scope.sets).toHaveLength(0);

    // Discard drops the draft.
    face.discard();
    expect(snapshot().dirty).toBe(false);

    // Value staging through the select.
    face.choose('mode', 'require-review');
    expect(snapshot().dirty).toBe(true);
    expect(snapshot().fields.mode.value).toBe('require-review');

    await face.save();
    expect(scope.sets).toEqual([['mode', 'require-review']]);
    expect(snapshot().dirty).toBe(false);
  });

  it('reset only plans a write when the field is actually overridden', async () => {
    const bundle = await loadBundle();
    const scope = fakeScope({
      status: 'ready',
      value: { mode: 'require-resolution' },
      base: { mode: 'remind' },
      user: { mode: 'require-resolution' },
      writable: true,
    });
    const ctx = makeCtx(scope);
    bundle.factory(fakeReact).apply(ctx);
    const face = ctx.registered[0]!.options!.inject!() as Parameters<typeof expect>[0] & {
      hooks: { docImpactCard: { getSnapshot: () => Record<string, any> } };
      resetField: (field: string) => void;
      save: () => Promise<void>;
    };

    expect(face.hooks.docImpactCard.getSnapshot().fields.mode.overridden).toBe(true);
    face.resetField('mode');
    const snapshot = face.hooks.docImpactCard.getSnapshot();
    expect(snapshot.dirty).toBe(true);
    expect(snapshot.fields.mode.overridden).toBe(false);
    expect(snapshot.fields.mode.value).toBe('remind'); // composition base preview

    await face.save();
    expect(scope.unsets).toEqual(['mode']);
    expect(face.hooks.docImpactCard.getSnapshot().dirty).toBe(false);
  });

  it('blocks saving an invalid number and reports the invalid draft', async () => {
    const bundle = await loadBundle();
    const scope = fakeScope({ status: 'ready', value: {}, base: {}, user: {}, writable: true });
    const ctx = makeCtx(scope);
    bundle.factory(fakeReact).apply(ctx);
    const face = ctx.registered[0]!.options!.inject!() as {
      hooks: { docImpactCard: { getSnapshot: () => Record<string, any> } };
      edit: (field: string, text: string) => void;
      save: () => Promise<void>;
    };

    face.edit('maxReminderRounds', 'not-a-number');
    const snapshot = face.hooks.docImpactCard.getSnapshot();
    expect(snapshot.invalid).toBe(true);
    expect(snapshot.fields.maxReminderRounds.invalid).toBe(true);

    await face.save();
    expect(scope.sets).toHaveLength(0);
    expect(snapshot.dirty).toBe(true); // drafts kept for correction
  });

  it('renders nothing while the namespace is unavailable', async () => {
    const bundle = await loadBundle();
    const scope = fakeScope({ status: 'loading', writable: false });
    const ctx = makeCtx(scope);
    bundle.factory(fakeReact).apply(ctx);
    const face = ctx.registered[0]!.options!.inject!() as {
      hooks: { docImpactCard: { getSnapshot: () => Record<string, any> } };
    };
    expect(face.hooks.docImpactCard.getSnapshot().available).toBe(false);
  });
});
