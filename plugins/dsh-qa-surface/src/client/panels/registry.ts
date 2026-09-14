import type {
  QaSurfacePanelDefinition,
  QaSurfacePanelOpenOptions,
  QaSurfacePanels,
} from "./contract.js";

interface PanelRecord {
  readonly definition: QaSurfacePanelDefinition;
  readonly abort: AbortController;
}

export interface QaSurfacePanelsSnapshot {
  readonly definitions: readonly QaSurfacePanelDefinition[];
  readonly activeKind: string | null;
  readonly params: unknown;
  readonly focusRequest: number;
  readonly focus: boolean;
}

const EMPTY_SNAPSHOT: QaSurfacePanelsSnapshot = Object.freeze({
  definitions: Object.freeze([]),
  activeKind: null,
  params: undefined,
  focusRequest: 0,
  focus: false,
});

function requiredIdentity(value: string, field: "id" | "kind"): string {
  if (value.trim() === "") {
    throw new Error(`qaSurfacePanels.register: ${field} must not be empty`);
  }
  return value;
}

function titleForSort(definition: QaSurfacePanelDefinition): string {
  try {
    return definition.title();
  } catch {
    return definition.id;
  }
}

function compareDefinitions(
  left: QaSurfacePanelDefinition,
  right: QaSurfacePanelDefinition,
): number {
  const order = (left.order ?? 0) - (right.order ?? 0);
  if (order !== 0) return order;
  const title = titleForSort(left).localeCompare(titleForSort(right));
  return title === 0 ? left.id.localeCompare(right.id) : title;
}

/** Client-only metadata/navigation registry. It never stores React components. */
export class QaSurfacePanelRegistry implements QaSurfacePanels {
  private readonly byId = new Map<string, PanelRecord>();
  private readonly byKind = new Map<string, PanelRecord>();
  private readonly listeners = new Set<() => void>();
  private readonly paramsByKind = new Map<string, unknown>();
  private activeKind: string | null = null;
  private focusRequest = 0;
  private focus = false;
  private snapshot: QaSurfacePanelsSnapshot = EMPTY_SNAPSHOT;
  private disposed = false;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): QaSurfacePanelsSnapshot => this.snapshot;

  register(definition: QaSurfacePanelDefinition): () => void {
    if (this.disposed) {
      throw new Error("qaSurfacePanels.register: registry has been disposed");
    }
    const id = requiredIdentity(definition.id, "id");
    const kind = requiredIdentity(definition.kind, "kind");
    if (this.byId.has(id)) {
      throw new Error(`qaSurfacePanels.register: duplicate id "${id}"`);
    }
    if (this.byKind.has(kind)) {
      throw new Error(`qaSurfacePanels.register: duplicate kind "${kind}"`);
    }
    const normalized: QaSurfacePanelDefinition = Object.freeze({
      ...definition,
      id,
      kind,
      userVisible: definition.userVisible ?? true,
      keepMounted: definition.keepMounted ?? false,
    });
    const record: PanelRecord = {
      definition: normalized,
      abort: new AbortController(),
    };
    this.byId.set(id, record);
    this.byKind.set(kind, record);
    this.publish();

    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      if (this.byId.get(id) !== record) return;
      this.byId.delete(id);
      this.byKind.delete(kind);
      this.paramsByKind.delete(kind);
      record.abort.abort();
      if (this.activeKind === kind) this.activeKind = null;
      this.publish();
    };
  }

  open(kind: string, options: QaSurfacePanelOpenOptions = {}): boolean {
    if (!this.byKind.has(kind)) return false;
    this.activeKind = kind;
    this.paramsByKind.set(kind, options.params);
    this.focus = options.focus ?? true;
    this.focusRequest += 1;
    this.publish();
    return true;
  }

  close(_options: { readonly reason?: "user" | "extension" } = {}): void {
    if (this.activeKind === null) return;
    this.activeKind = null;
    this.focus = false;
    this.publish();
  }

  toggle(kind: string): boolean {
    if (!this.byKind.has(kind)) return false;
    if (this.activeKind === kind) {
      this.close({ reason: "user" });
      return true;
    }
    return this.open(kind, { reason: "user", focus: true });
  }

  isRegistered(kind: string): boolean {
    return this.byKind.has(kind);
  }

  getActiveKind(): string | null {
    return this.activeKind;
  }

  list(): readonly QaSurfacePanelDefinition[] {
    return this.snapshot.definitions;
  }

  signal(kind: string): AbortSignal | undefined {
    return this.byKind.get(kind)?.abort.signal;
  }

  params(kind: string): unknown {
    return this.paramsByKind.get(kind);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const record of this.byId.values()) record.abort.abort();
    this.byId.clear();
    this.byKind.clear();
    this.paramsByKind.clear();
    this.activeKind = null;
    this.publish();
    this.listeners.clear();
  }

  private publish(): void {
    const definitions = Object.freeze(
      [...this.byId.values()]
        .map((record) => record.definition)
        .sort(compareDefinitions),
    );
    this.snapshot = Object.freeze({
      definitions,
      activeKind: this.activeKind,
      params:
        this.activeKind === null
          ? undefined
          : this.paramsByKind.get(this.activeKind),
      focusRequest: this.focusRequest,
      focus: this.focus,
    });
    for (const listener of this.listeners) listener();
  }
}
