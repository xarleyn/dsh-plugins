// Staged settings form over the `doc-impact` settings namespace — a port of
// the first-party CardForm semantics: staged drafts never write; Save commits
// field-granular set/unset calls in staging order (SPEC §37).
export const MODE_OPTIONS = ["remind", "require-review", "require-resolution", "require-update"];
export const ON_LIMIT_OPTIONS = ["allow", "warn", "error"];

/** Field specs: kind text/number render as inputs, choice/bool as selects. */
export const FIELDS = [
  { field: "enabled", kind: "bool", fallback: true },
  { field: "configFile", kind: "text", fallback: ".dsh/doc-impact.yml" },
  { field: "mode", kind: "choice", options: MODE_OPTIONS, fallback: "remind" },
  { field: "maxReminderRounds", kind: "number", fallback: 2 },
  { field: "onLimit", kind: "choice", options: ON_LIMIT_OPTIONS, fallback: "allow" },
  { field: "maxSnapshotFiles", kind: "number", fallback: 10000 },
  { field: "debug", kind: "bool", fallback: false }
];

function formatText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function formatNumber(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function parseText(text: string): { kind: "clear" } | { kind: "set"; value: string } {
  const trimmed = text.trim();
  return trimmed === "" ? { kind: "clear" } : { kind: "set", value: trimmed };
}

function parseNumber(text: string): { kind: "clear" } | { kind: "set"; value: number } | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return { kind: "clear" };
  if (!/^\d+$/u.test(trimmed)) return undefined;
  return { kind: "set", value: parseInt(trimmed, 10) };
}

export function specOf(field: string): any {
  for (let i = 0; i < FIELDS.length; i++) {
    if (FIELDS[i]!.field === field) return FIELDS[i]!;
  }
  throw new Error("doc-impact card has no field " + field);
}

/**
 * Staged form over the `doc-impact` settings namespace — a port of the
 * first-party CardForm semantics: staged drafts never write; Save commits
 * field-granular set/unset calls in staging order; a save that did not
 * land keeps its drafts.
 */
export const SettingsForm: any = function SettingsForm(this: any, scope: any) {
  this.scope = scope;
  this.staged = new Map();
  this.listeners = new Set();
  this.saving = false;
  this.failed = false;
  this.snapshotCache = undefined;
  scope.subscribe(() => {
    this.publish();
  });
};

SettingsForm.prototype.getSnapshot = function () {
  if (this.snapshotCache === undefined) this.snapshotCache = this.projection();
  return this.snapshotCache;
};

SettingsForm.prototype.subscribe = function (listener: () => void) {
  this.listeners.add(listener);
  return () => {
    this.listeners.delete(listener);
  };
};

SettingsForm.prototype.publish = function () {
  this.snapshotCache = undefined;
  this.listeners.forEach(function (listener: () => void) {
    listener();
  });
};

SettingsForm.prototype.snapshotOf = function () {
  return this.scope.getSnapshot();
};

SettingsForm.prototype.sectionValue = function (field: string) {
  const value = this.snapshotOf().value;
  return value !== undefined && value !== null && Object.hasOwn(value, field) ? value[field] : undefined;
};

SettingsForm.prototype.baseValue = function (field: string) {
  const base = this.snapshotOf().base;
  return base !== undefined && base !== null && Object.hasOwn(base, field) ? base[field] : undefined;
};

SettingsForm.prototype.userLayer = function () {
  return this.snapshotOf().user;
};

SettingsForm.prototype.stored = function (field: string) {
  const user = this.userLayer();
  return user !== undefined && user !== null && Object.hasOwn(user, field);
};

/** The value a staged clear would reveal: composition base over schema default. */
SettingsForm.prototype.clearedValue = function (field: string) {
  const spec = specOf(field);
  const base = this.baseValue(field);
  return base === undefined ? spec.fallback : base;
};

SettingsForm.prototype.plan = function () {
  const plan: any[] = [];
  this.staged.forEach((staged: any, field: string) => {
    const spec = specOf(field);
    if (staged.op === "clear") {
      if (this.stored(field)) {
        plan.push({
          field: field,
          run: () => this.runClear(field)
        });
      }
      return;
    }
    if (spec.kind === "text" || spec.kind === "number") {
      if (staged.text === (spec.kind === "number" ? formatNumber(this.sectionValue(field)) : formatText(this.sectionValue(field)))) return;
      const write = spec.kind === "number" ? parseNumber(staged.text) : parseText(staged.text);
      if (write === undefined) {
        plan.push({ field: field, run: undefined });
      } else if (write.kind === "clear") {
        plan.push({
          field: field,
          run: () => this.runClear(field)
        });
      } else {
        const value = write.value;
        plan.push({
          field: field,
          run: () => this.runSet(field, value)
        });
      }
      return;
    }
    // choice / bool: value staging
    if (staged.value === this.sectionValue(field)) return;
    plan.push({
      field: field,
      run: () => this.runSet(field, staged.value)
    });
  });
  return plan;
};

SettingsForm.prototype.runClear = async function (field: string) {
  await this.scope.unset(field);
  return !this.stored(field);
};

SettingsForm.prototype.runSet = async function (field: string, value: unknown) {
  await this.scope.set(field, value);
  const user = this.userLayer();
  return user !== undefined && user !== null && user[field] === value;
};

SettingsForm.prototype.shell = function () {
  const snapshot = this.snapshotOf();
  const plan = this.plan();
  return {
    available: snapshot.status === "ready",
    writable: snapshot.writable,
    dirty: plan.length > 0,
    invalid: plan.some(function (item: any) {
      return item.run === undefined;
    }),
    saving: this.saving,
    failed: this.failed
  };
};

SettingsForm.prototype.field = function (field: string) {
  const spec = specOf(field);
  const staged = this.staged.get(field);
  if (staged !== undefined && staged.op === "clear") {
    const cleared = this.clearedValue(field);
    return {
      text: spec.kind === "number" ? formatNumber(cleared) : formatText(cleared),
      value: cleared,
      overridden: false,
      invalid: false
    };
  }
  if (staged !== undefined && staged.op === "set" && (spec.kind === "choice" || spec.kind === "bool")) {
    return { text: "", value: staged.value, overridden: true, invalid: false };
  }
  if (staged !== undefined && staged.op === "set") {
    const write = spec.kind === "number" ? parseNumber(staged.text) : parseText(staged.text);
    return {
      text: staged.text,
      value: undefined,
      overridden: write !== undefined && write.kind === "set",
      invalid: write === undefined
    };
  }
  const current = this.sectionValue(field);
  return {
    text: spec.kind === "number" ? formatNumber(current) : formatText(current),
    value: current === undefined ? spec.fallback : current,
    overridden: this.stored(field),
    invalid: false
  };
};

SettingsForm.prototype.stage = function (field: string, staged: any) {
  this.staged.set(field, staged);
  this.failed = false;
  this.publish();
};

SettingsForm.prototype.actions = function () {
  return {
    edit: (field: string, text: string) => {
      this.stage(field, { op: "set", text: text });
    },
    choose: (field: string, value: unknown) => {
      this.stage(field, { op: "set", value: value });
    },
    resetField: (field: string) => {
      const spec = specOf(field);
      if (spec.kind === "text" || spec.kind === "number") {
        const cleared = this.clearedValue(field);
        this.stage(field, {
          op: "set",
          text: spec.kind === "number" ? formatNumber(cleared) : formatText(cleared),
          clear: true
        });
      } else {
        this.stage(field, { op: "clear" });
      }
    },
    save: () => {
      return this.save();
    },
    discard: () => {
      if (this.staged.size === 0 && !this.failed) return;
      this.staged.clear();
      this.failed = false;
      this.publish();
    }
  };
};

SettingsForm.prototype.save = async function () {
  const plan = this.plan();
  const writes = plan.filter(function (item: any) {
    return item.run !== undefined;
  });
  if (plan.length === 0 || this.saving || writes.length !== plan.length) return;
  this.saving = true;
  this.failed = false;
  this.publish();
  let landed = true;
  for (let i = 0; i < writes.length; i++) {
    try {
      const ok = await writes[i].run();
      landed = ok === true && landed;
    } catch (_error) {
      landed = false;
    }
  }
  if (landed) this.staged.clear();
  this.saving = false;
  this.failed = !landed;
  this.publish();
};

SettingsForm.prototype.projection = function () {
  const shell = this.shell();
  const fields: Record<string, any> = {};
  for (let i = 0; i < FIELDS.length; i++) {
    fields[FIELDS[i]!.field] = this.field(FIELDS[i]!.field);
  }
  return Object.assign({}, shell, { fields: fields });
};

SettingsForm.prototype.inject = function () {
  return {
    hooks: {
      docImpactCard: {
        getSnapshot: () => this.getSnapshot(),
        subscribe: (listener: () => void) => this.subscribe(listener)
      }
    },
    edit: this.actions().edit,
    choose: this.actions().choose,
    resetField: this.actions().resetField,
    save: this.actions().save,
    discard: this.actions().discard
  };
};
