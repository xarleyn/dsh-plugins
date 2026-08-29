import {
  createSnapshotStore,
  type SettingsScope,
  type SnapshotStore,
} from "@deepseek-ai/dsh-client-runtime/client";

export type SleevLogLevel = "off" | "info" | "debug";

/** Browser-visible shape of the Host `sleev` settings namespace. */
export interface SleevSettings {
  readonly routes?: string[];
  readonly routePrefixes?: string[];
  readonly maxRecentCalls?: number;
  readonly logLevel?: SleevLogLevel;
}

export type SleevSettingsField = keyof SleevSettings;

interface Draft {
  readonly text: string;
  readonly reset: boolean;
}

export interface SleevSettingsFieldState {
  readonly text: string;
  readonly overridden: boolean;
  readonly invalid: boolean;
}

export interface SleevSettingsCardState {
  readonly available: boolean;
  readonly writable: boolean;
  readonly dirty: boolean;
  readonly invalid: boolean;
  readonly saving: boolean;
  readonly failed: boolean;
  readonly routes: SleevSettingsFieldState;
  readonly routePrefixes: SleevSettingsFieldState;
  readonly maxRecentCalls: SleevSettingsFieldState;
  readonly logLevel: SleevSettingsFieldState;
}

export interface SleevSettingsCardFace {
  readonly hooks: {
    readonly sleevSettings: SnapshotStore<SleevSettingsCardState>;
  };
  readonly edit: (field: SleevSettingsField, value: string) => void;
  readonly save: () => void;
  readonly discard: () => void;
  readonly resetField: (field: SleevSettingsField) => void;
}

interface PlanEntry {
  readonly field: SleevSettingsField;
  readonly draft: Draft;
  readonly action: "set" | "unset";
  readonly value?: unknown;
  readonly invalid: boolean;
}

const DEFAULTS: Required<SleevSettings> = {
  routes: [],
  routePrefixes: ["sleev-"],
  maxRecentCalls: 100,
  logLevel: "info",
};

function lines(values: readonly string[]): string {
  return values.join("\n");
}

function parseLines(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/\r?\n/u)
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ];
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Staged form controller matching DSH's built-in plugin settings cards. */
export class SleevSettingsController {
  private readonly drafts = new Map<SleevSettingsField, Draft>();
  private readonly store: SnapshotStore<SleevSettingsCardState>;
  private readonly unsubscribe: () => void;
  private saving = false;
  private failed = false;

  constructor(private readonly scope: SettingsScope<SleevSettings>) {
    this.store = createSnapshotStore(this.project());
    this.unsubscribe = scope.subscribe(() => this.publish());
  }

  inject(): SleevSettingsCardFace {
    return {
      hooks: { sleevSettings: this.store },
      edit: (field, value) => {
        const parsed = this.parse(field, value);
        if (parsed !== undefined && equal(parsed, this.effective()[field])) {
          this.drafts.delete(field);
        } else {
          this.drafts.set(field, { text: value, reset: false });
        }
        this.failed = false;
        this.publish();
      },
      save: () => void this.save(),
      discard: () => {
        this.drafts.clear();
        this.failed = false;
        this.publish();
      },
      resetField: (field) => {
        if (this.stored(field)) {
          this.drafts.set(field, {
            text: this.format(field, this.base()[field]),
            reset: true,
          });
        } else {
          this.drafts.delete(field);
        }
        this.failed = false;
        this.publish();
      },
    };
  }

  dispose(): void {
    this.unsubscribe();
  }

  private base(): Required<SleevSettings> {
    return { ...DEFAULTS, ...(this.scope.getSnapshot().base as SleevSettings) };
  }

  private effective(): Required<SleevSettings> {
    return { ...DEFAULTS, ...this.scope.getSnapshot().value };
  }

  private stored(field: SleevSettingsField): boolean {
    const user = this.scope.getSnapshot().user as
      Record<string, unknown> | undefined;
    return user !== undefined && Object.hasOwn(user, field);
  }

  private format(field: SleevSettingsField, value: unknown): string {
    return field === "routes" || field === "routePrefixes"
      ? lines(value as string[])
      : String(value);
  }

  private parse(field: SleevSettingsField, text: string): unknown | undefined {
    if (field === "routes" || field === "routePrefixes") {
      return parseLines(text);
    }
    if (field === "maxRecentCalls") {
      const value = Number(text.trim());
      return Number.isSafeInteger(value) && value > 0 ? value : undefined;
    }
    return ["off", "info", "debug"].includes(text)
      ? (text as SleevLogLevel)
      : undefined;
  }

  private fieldState(field: SleevSettingsField): SleevSettingsFieldState {
    const draft = this.drafts.get(field);
    if (draft === undefined) {
      return {
        text: this.format(field, this.effective()[field]),
        overridden: this.stored(field),
        invalid: false,
      };
    }
    return {
      text: draft.text,
      overridden: !draft.reset,
      invalid: !draft.reset && this.parse(field, draft.text) === undefined,
    };
  }

  private plan(): PlanEntry[] {
    const effective = this.effective();
    const result: PlanEntry[] = [];
    for (const [field, draft] of this.drafts) {
      if (draft.reset) {
        if (this.stored(field)) {
          result.push({ field, draft, action: "unset", invalid: false });
        }
        continue;
      }
      const value = this.parse(field, draft.text);
      if (value !== undefined && equal(value, effective[field])) continue;
      result.push({
        field,
        draft,
        action: "set",
        value,
        invalid: value === undefined,
      });
    }
    return result;
  }

  private project(): SleevSettingsCardState {
    const snapshot = this.scope.getSnapshot();
    const plan = this.plan();
    return {
      available: snapshot.status === "ready",
      writable: snapshot.writable,
      dirty: plan.length > 0,
      invalid: plan.some((entry) => entry.invalid),
      saving: this.saving,
      failed: this.failed,
      routes: this.fieldState("routes"),
      routePrefixes: this.fieldState("routePrefixes"),
      maxRecentCalls: this.fieldState("maxRecentCalls"),
      logLevel: this.fieldState("logLevel"),
    };
  }

  private async save(): Promise<void> {
    const state = this.project();
    if (!state.dirty || state.invalid || state.saving || !state.writable)
      return;
    const writes = this.plan();
    this.saving = true;
    this.failed = false;
    this.publish();
    try {
      for (const write of writes) {
        if (write.action === "unset") {
          await this.scope.unset(write.field);
        } else {
          await this.scope.set(write.field, write.value);
        }
      }
      const user = this.scope.getSnapshot().user as
        Record<string, unknown> | undefined;
      const landed = writes.every((write) =>
        write.action === "unset"
          ? user === undefined || !Object.hasOwn(user, write.field)
          : equal(user?.[write.field], write.value),
      );
      if (landed) {
        for (const write of writes) {
          if (this.drafts.get(write.field) === write.draft) {
            this.drafts.delete(write.field);
          }
        }
      } else {
        this.failed = true;
      }
    } catch {
      this.failed = true;
    } finally {
      this.saving = false;
      this.publish();
    }
  }

  private publish(): void {
    this.store.set(this.project());
  }
}
