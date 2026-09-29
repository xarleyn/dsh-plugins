// Staged settings form over the `dsh-doc-impact` settings namespace — a port of
// the first-party CardForm semantics: staged drafts never write; Save commits
// field-granular path operations in staging order (SPEC §37).
import type {
  ConfigForm,
  ConfigFormSnapshot,
} from "@deepseek-ai/dsh-client-ui-settings/client";
import {
  DEFAULT_LIMIT_TEMPLATE,
  DEFAULT_REMINDER_TEMPLATE,
} from "../engine/reminder.js";

/** The `defaults.mode` vocabulary the card offers. */
export const MODE_OPTIONS = [
  "remind",
  "require-review",
  "require-resolution",
  "require-update",
] as const;
/** The `safety.onLimit` vocabulary the card offers. */
export const ON_LIMIT_OPTIONS = ["allow", "warn", "error"] as const;

export type ModeOption = (typeof MODE_OPTIONS)[number];
export type OnLimitOption = (typeof ON_LIMIT_OPTIONS)[number];

/** The scalars the namespace document holds and the card stages. */
export type DocImpactValue = string | number | boolean;

/**
 * The card's view of the `dsh-doc-impact` namespace document: one entry per
 * editable field, keyed by the field name the card uses and valued by the type
 * that field carries, however deep the nested profile shape keeps it (SPEC §37).
 */
export interface DocImpactSettingsSection {
  enabled: boolean;
  steer: boolean;
  configFile: string;
  mode: ModeOption;
  maxReminderRounds: number;
  onLimit: OnLimitOption;
  reminderTemplate: string;
  limitTemplate: string;
  maxSnapshotFiles: number;
  debug: boolean;
}

/** A field the card edits. */
export type SettingsField = keyof DocImpactSettingsSection;

/** The value type one field carries. */
export type SettingsValue<F extends SettingsField> =
  DocImpactSettingsSection[F];

/** The fields whose value is a string / a number / a boolean. */
type StringFields = {
  [F in SettingsField]: SettingsValue<F> extends string ? F : never;
}[SettingsField];
type NumberFields = {
  [F in SettingsField]: SettingsValue<F> extends number ? F : never;
}[SettingsField];
type BooleanFields = {
  [F in SettingsField]: SettingsValue<F> extends boolean ? F : never;
}[SettingsField];

/** The string-valued fields the card offers as a fixed vocabulary, not as free text. */
type ChoiceFields = "mode" | "onLimit";
/** The string fields the card types into: kind `text`. */
type TextFields = Exclude<StringFields, ChoiceFields>;

/** The fields the card edits by typing a draft: kinds `text` and `number`. */
export type DraftField = TextFields | NumberFields;
/** The fields the card edits by picking a value: kinds `choice` and `bool`. */
export type ValueField = ChoiceFields | BooleanFields;

interface SpecBase<F extends SettingsField> {
  /** The card field name this spec describes. */
  readonly field: F;
  /** Where the field stands inside the namespace document. */
  readonly path: readonly string[];
  /** The schema default, shown while no layer holds the field. */
  readonly fallback: SettingsValue<F>;
}

/** kind `text`: a string the card types — `multiline` renders a textarea, and
 *  `requires` pins the placeholder that keeps the steering message usable. */
interface TextSpec<F extends TextFields> extends SpecBase<F> {
  readonly kind: "text";
  readonly multiline?: boolean;
  readonly requires?: string;
}

/** kind `number`: an integer the card types. The bounds the schema sets
 *  (`min`, `step`) are not carried here: a draft is checked for being an integer
 *  and the Host is the one that refuses a value below its own minimum, so the
 *  card reports a save that did not land rather than highlighting the field. */
interface NumberSpec<F extends NumberFields> extends SpecBase<F> {
  readonly kind: "number";
}

/** kind `choice`: one of `options`. */
interface ChoiceSpec<F extends ChoiceFields> extends SpecBase<F> {
  readonly kind: "choice";
  readonly options: readonly SettingsValue<F>[];
}

/** kind `bool`: on or off. */
interface BoolSpec<F extends BooleanFields> extends SpecBase<F> {
  readonly kind: "bool";
}

/** A field spec, discriminated by `kind`. */
export type FieldSpec =
  | TextSpec<TextFields>
  | NumberSpec<NumberFields>
  | ChoiceSpec<ChoiceFields>
  | BoolSpec<BooleanFields>;

/**
 * The spec of every field of the section: the kind decides the draft shape, the
 * section decides the value type, so a field can never be rendered as a kind
 * that cannot carry its value.
 */
type SpecsByField = {
  enabled: BoolSpec<"enabled">;
  steer: BoolSpec<"steer">;
  configFile: TextSpec<"configFile">;
  mode: ChoiceSpec<"mode">;
  maxReminderRounds: NumberSpec<"maxReminderRounds">;
  onLimit: ChoiceSpec<"onLimit">;
  reminderTemplate: TextSpec<"reminderTemplate">;
  limitTemplate: TextSpec<"limitTemplate">;
  maxSnapshotFiles: NumberSpec<"maxSnapshotFiles">;
  debug: BoolSpec<"debug">;
};

/** The specs in card order. */
const SPECS: SpecsByField = {
  enabled: {
    field: "enabled",
    kind: "bool",
    path: ["enabled"],
    fallback: true,
  },
  steer: { field: "steer", kind: "bool", path: ["steer"], fallback: true },
  configFile: {
    field: "configFile",
    kind: "text",
    path: ["configFile"],
    fallback: ".dsh/doc-impact.yml",
  },
  mode: {
    field: "mode",
    kind: "choice",
    path: ["defaults", "mode"],
    options: MODE_OPTIONS,
    fallback: "remind",
  },
  maxReminderRounds: {
    field: "maxReminderRounds",
    kind: "number",
    path: ["safety", "maxReminderRounds"],
    fallback: 2,
  },
  onLimit: {
    field: "onLimit",
    kind: "choice",
    path: ["safety", "onLimit"],
    options: ON_LIMIT_OPTIONS,
    fallback: "allow",
  },
  reminderTemplate: {
    field: "reminderTemplate",
    kind: "text",
    path: ["reminderTemplate"],
    multiline: true,
    requires: "{body}",
    fallback: DEFAULT_REMINDER_TEMPLATE,
  },
  limitTemplate: {
    field: "limitTemplate",
    kind: "text",
    path: ["limitTemplate"],
    multiline: true,
    requires: "{impacts}",
    fallback: DEFAULT_LIMIT_TEMPLATE,
  },
  maxSnapshotFiles: {
    field: "maxSnapshotFiles",
    kind: "number",
    path: ["changeDetection", "maxSnapshotFiles"],
    fallback: 10_000,
  },
  debug: { field: "debug", kind: "bool", path: ["debug"], fallback: false },
};

/**
 * The specs, in the order the card lists them. `path` addresses the field inside
 * the namespace document, which keeps the nested profile shape (SPEC §37) while
 * the card stays a flat list of fields.
 */
export const FIELDS: readonly FieldSpec[] = Object.values(SPECS);

/**
 * The spec of one field, with its kind and value type: the name is checked
 * against the section. The check is a `throw`, not only the generic argument —
 * a field name that arrives from the Host or from a string is a card bug, and in
 * the built bundle the type is gone, so the alternative is a `TypeError` on
 * `undefined.path` from inside the snapshot read.
 *
 * The check is an own-property one: `SPECS` is a plain literal, so a name that
 * only its prototype carries (`"toString"`, `"constructor"`, `"__proto__"`)
 * answers with a member that is not a spec of anything, and the `undefined.path`
 * the guard exists to prevent comes back through that door.
 */
export function specOf<F extends SettingsField>(field: F): SpecsByField[F] {
  const spec = Object.hasOwn(SPECS, field) ? SPECS[field] : undefined;
  if (spec === undefined) {
    throw new Error(`doc-impact card has no field ${String(field)}`);
  }
  return spec;
}

/** A staged reset: drop the user layer so the field follows the composition base. */
interface ClearDraft {
  readonly op: "clear";
}

/** A staged edit of a text or number field: the raw draft text, never a value. */
interface TextDraft {
  readonly op: "set";
  readonly text: string;
}

/** A staged pick on a choice or bool field: the value itself, never a draft text. */
interface ValueDraft<F extends ValueField> {
  readonly op: "set";
  readonly value: SettingsValue<F>;
}

/** What one field may stage: its kind decides the draft, `clear` fits every field. */
export type Staged<F extends SettingsField = SettingsField> =
  F extends DraftField
    ? ClearDraft | TextDraft
    : F extends ValueField
      ? ClearDraft | ValueDraft<F>
      : never;

/**
 * What the staged map holds: one draft with its value widened to the document
 * scalars. Storage needs the wide shape because a generic `F` cannot be reduced
 * by the compiler; the contract a caller is held to is `Staged<F>`.
 */
type Draft =
  | ClearDraft
  | TextDraft
  | { readonly op: "set"; readonly value: DocImpactValue };

/**
 * A layer of the namespace document. The Host answers `base` and `user` as JSON
 * of no declared shape and `value` as the resolved section, so a layer is
 * whatever the document happens to hold: every read goes through `pick`, which
 * guards each step of the path the spec carries.
 */
type SettingsLayer = unknown;

/**
 * The `dsh-doc-impact` namespace section as the Host hands it: raw profile JSON
 * whose shape only the field specs describe. This is the type argument the form
 * asks the Host for — not `DocImpactSettingsSection`, which is the card's flat
 * view of ten fields, not the nested document the namespace actually holds.
 */
export type SettingsDocument = Record<string, unknown>;

/**
 * The host `ConfigForm` of the namespace. Taken from the settings package rather
 * than written out again: a hand-kept mirror of the Host is checked by nobody,
 * since `apply` declares its own context, and this one had already drifted — the
 * Host also offers `set`/`unset` and makes `mode` a mandatory part of the reply.
 */
export type NamespaceForm = ConfigForm<SettingsDocument>;

/** The Host's view of one settings namespace. */
export type NamespaceSnapshot = ConfigFormSnapshot<SettingsDocument>;

/** One field-granular path operation the card emits: `set` carries the value,
 *  `unset` drops the override. The Host calls this shape `SettingsPathOpView` and
 *  takes it in `mutate`, but the settings package brings that name in from
 *  `@deepseek-ai/dsh-api-remotes` without declaring the dependency, so in this
 *  workspace the member resolves to nothing and the compiler cannot compare this
 *  description against the Host's own — `mutate` accepts whatever is handed to it.
 *  The shape is therefore pinned by the tests that read the operations reaching
 *  `mutate` (`client-draft.test.ts`, `client-bundle.test.ts`), not by a type. */
export type NamespaceOp =
  | {
      readonly op: "set";
      readonly path: readonly string[];
      readonly value: DocImpactValue;
    }
  | { readonly op: "unset"; readonly path: readonly string[] };

/** One field as the card renders it: the draft text its kind shows, the value it
 *  stands on, whether the user layer holds an override, and whether the draft can
 *  be committed. */
export interface FieldState {
  readonly text: string;
  readonly value: DocImpactValue | undefined;
  readonly overridden: boolean;
  readonly invalid: boolean;
}

/** The shell state the card's badge and buttons read. */
interface ShellState {
  readonly available: boolean;
  readonly writable: boolean;
  readonly dirty: boolean;
  readonly invalid: boolean;
  readonly saving: boolean;
  readonly failed: boolean;
}

type FieldsState = Record<SettingsField, FieldState>;

/** Everything the card renders: the shell state plus one state per field. */
export interface CardSnapshot extends ShellState {
  readonly fields: FieldsState;
}

/** The external store the Host wraps into the card's `useDocImpactCard` hook. */
export interface SnapshotStore {
  getSnapshot(): CardSnapshot;
  subscribe(listener: () => void): () => void;
}

/** The staged operations the card renders with. */
export interface CardActions {
  readonly edit: (field: DraftField, text: string) => void;
  readonly choose: <F extends ValueField>(
    field: F,
    value: SettingsValue<F>,
  ) => void;
  readonly resetField: (field: SettingsField) => void;
  readonly save: () => Promise<void>;
  readonly discard: () => void;
}

/** The face the Host injects into the card: the snapshot store plus the operations. */
export interface CardFace extends CardActions {
  readonly hooks: { readonly docImpactCard: SnapshotStore };
}

/**
 * One value inside the namespace document. The document is the Host's JSON and
 * its shape is only *described* by the field specs, so a node that is not a
 * scalar the card can show reads as absent rather than being asserted into the
 * field's value type.
 */
function pick(
  source: SettingsLayer,
  path: readonly string[],
): DocImpactValue | undefined {
  let node: unknown = source;
  for (const key of path) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return typeof node === "string" ||
    typeof node === "number" ||
    typeof node === "boolean"
    ? node
    : undefined;
}

/** Whether one read value stands in the vocabulary a choice field offers. */
function isChoiceMember(
  options: readonly DocImpactValue[],
  value: DocImpactValue,
): boolean {
  return options.some(function (option: DocImpactValue) {
    return option === value;
  });
}

/**
 * The value one spec allows at a document path. `pick` already refuses a node
 * that is not a scalar; a choice additionally refuses a value outside its
 * `options`, because the select it feeds has no `option` to mark selected and
 * the operator would see an empty field instead of the value the Host holds.
 * Reading it as absent puts the field back on its fallback, which the reset
 * preview and the badge already use.
 */
function readOf(
  spec: FieldSpec,
  source: SettingsLayer,
): DocImpactValue | undefined {
  const value = pick(source, spec.path);
  if (value === undefined) return undefined;
  const options: readonly DocImpactValue[] | undefined =
    spec.kind === "choice" ? spec.options : undefined;
  return options !== undefined && !isChoiceMember(options, value)
    ? undefined
    : value;
}

/** Whether one path stands in a layer — presence, not value, marks an override. */
function holds(source: SettingsLayer, path: readonly string[]): boolean {
  let node: unknown = source;
  for (const key of path) {
    if (node === null || typeof node !== "object") return false;
    if (!Object.hasOwn(node, key)) return false;
    node = (node as Record<string, unknown>)[key];
  }
  return true;
}

function formatText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function formatNumber(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : "";
}

function parseText(
  text: string,
): { kind: "clear" } | { kind: "set"; value: string } {
  const trimmed = text.trim();
  return trimmed === "" ? { kind: "clear" } : { kind: "set", value: trimmed };
}

function parseNumber(
  text: string,
): { kind: "clear" } | { kind: "set"; value: number } | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return { kind: "clear" };
  if (!/^\d+$/u.test(trimmed)) return undefined;
  return { kind: "set", value: parseInt(trimmed, 10) };
}

/** The draft text one field shows for the value its kind carries. */
function draftText(spec: FieldSpec, value: unknown): string {
  return spec.kind === "number" ? formatNumber(value) : formatText(value);
}

/** What a draft text asks for: a set, a clear, or nothing usable. */
function parseDraft(spec: FieldSpec, text: string) {
  return spec.kind === "number" ? parseNumber(text) : parseText(text);
}

/** The placeholder a text draft must keep, when its field declares one. */
function requiresOf(spec: FieldSpec): string | undefined {
  return spec.kind === "text" ? spec.requires : undefined;
}

/** Whether a field renders its text as a textarea. */
function isMultiline(spec: FieldSpec): boolean {
  return spec.kind === "text" && spec.multiline === true;
}

/** One field the Save pass would write, or an entry without a run while its
 *  draft cannot be committed. */
interface PlanEntry {
  readonly field: SettingsField;
  readonly run: (() => Promise<boolean>) | undefined;
}

/**
 * Staged form over the `dsh-doc-impact` settings namespace — a port of the
 * first-party CardForm semantics: staged drafts never write; Save commits
 * field-granular path operations in staging order; a save that did not land
 * keeps its drafts.
 */
export class SettingsForm {
  private readonly form: NamespaceForm;
  private readonly unsubscribe: () => void;
  private readonly staged = new Map<SettingsField, Draft>();
  private readonly listeners = new Set<() => void>();
  private snapshotCache: CardSnapshot | undefined;
  private saving = false;
  private failed = false;

  constructor(form: NamespaceForm) {
    this.form = form;
    this.snapshotCache = undefined;
    // The Host answers a disposer for the listener it takes, and this one has to
    // be kept: the controller `configForms.get` hands out is shared and cached by
    // the provider, so a client entry that drops it keeps calling a card that is
    // no longer on the page — one more listener per reload.
    this.unsubscribe = form.subscribe(() => {
      this.publish();
    });
  }

  /** End the watch on the Host controller. Safe to call twice. */
  dispose(): void {
    this.unsubscribe();
  }

  getSnapshot(): CardSnapshot {
    if (this.snapshotCache === undefined)
      this.snapshotCache = this.projection();
    return this.snapshotCache;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(): void {
    this.snapshotCache = undefined;
    this.listeners.forEach(function (listener: () => void) {
      listener();
    });
  }

  private snapshotOf(): NamespaceSnapshot {
    return this.form.getSnapshot();
  }

  private sectionValue(field: SettingsField): DocImpactValue | undefined {
    return readOf(specOf(field), this.snapshotOf().value);
  }

  private baseValue(field: SettingsField): DocImpactValue | undefined {
    return readOf(specOf(field), this.snapshotOf().base);
  }

  private userLayer(): SettingsLayer {
    return this.snapshotOf().user;
  }

  stored(field: SettingsField): boolean {
    return holds(this.userLayer(), specOf(field).path);
  }

  /** The value a staged clear would reveal: composition base over schema default. */
  clearedValue(field: SettingsField): DocImpactValue | undefined {
    const base = this.baseValue(field);
    return base === undefined ? specOf(field).fallback : base;
  }

  plan(): PlanEntry[] {
    const plan: PlanEntry[] = [];
    this.staged.forEach((draft: Draft, field: SettingsField) => {
      const spec = specOf(field);
      if (draft.op === "clear") {
        if (this.stored(field)) {
          plan.push({
            field: field,
            run: () => this.runClear(field),
          });
        }
        return;
      }
      if ("text" in draft) {
        if (draft.text === draftText(spec, this.sectionValue(field))) return;
        const write = parseDraft(spec, draft.text);
        if (write === undefined) {
          plan.push({ field: field, run: undefined });
          return;
        }
        if (write.kind === "clear") {
          plan.push({
            field: field,
            run: () => this.runClear(field),
          });
          return;
        }
        const requires = requiresOf(spec);
        if (requires !== undefined && !String(write.value).includes(requires)) {
          // A steering template without its payload placeholder would emit a
          // reminder without the impact list; keep the draft staged-but-invalid.
          plan.push({ field: field, run: undefined });
          return;
        }
        const value = write.value;
        plan.push({
          field: field,
          run: () => this.runSet(field, value),
        });
        return;
      }
      // choice / bool: value staging
      if (draft.value === this.sectionValue(field)) return;
      plan.push({
        field: field,
        run: () => this.runSet(field, draft.value),
      });
    });
    return plan;
  }

  /**
   * One field-granular write. The revision fence is read at the moment of the
   * write, not when the draft was staged, so a stale view cannot overwrite a
   * newer one; the Host answers whether the write landed. The path is copied out
   * of the spec: the Host takes a mutable `string[]`, and the spec array is
   * shared by every read of that field.
   */
  private runClear(field: SettingsField): Promise<boolean> {
    const ops: readonly NamespaceOp[] = [
      { op: "unset", path: [...specOf(field).path] },
    ];
    return this.form.mutate(ops, this.snapshotOf().revision);
  }

  private runSet(
    field: SettingsField,
    value: DocImpactValue,
  ): Promise<boolean> {
    const ops: readonly NamespaceOp[] = [
      { op: "set", path: [...specOf(field).path], value: value },
    ];
    return this.form.mutate(ops, this.snapshotOf().revision);
  }

  shell(): ShellState {
    const snapshot = this.snapshotOf();
    const plan = this.plan();
    return {
      available: snapshot.status === "ready",
      writable: snapshot.writable,
      dirty: plan.length > 0,
      invalid: plan.some(function (item: PlanEntry) {
        return item.run === undefined;
      }),
      saving: this.saving,
      failed: this.failed,
    };
  }

  field(field: SettingsField): FieldState {
    const spec = specOf(field);
    const draft = this.staged.get(field);
    if (draft !== undefined && draft.op === "clear") {
      const cleared = this.clearedValue(field);
      return {
        text: draftText(spec, cleared),
        value: cleared,
        overridden: false,
        invalid: false,
      };
    }
    if (draft !== undefined && "value" in draft) {
      return { text: "", value: draft.value, overridden: true, invalid: false };
    }
    if (draft !== undefined && "text" in draft) {
      const write = parseDraft(spec, draft.text);
      const requires = requiresOf(spec);
      const broken =
        write !== undefined &&
        write.kind === "set" &&
        requires !== undefined &&
        !String(write.value).includes(requires);
      return {
        text: draft.text,
        value: undefined,
        overridden: write !== undefined && write.kind === "set",
        invalid: write === undefined || broken,
      };
    }
    const current = this.sectionValue(field);
    const text = draftText(spec, current);
    return {
      // A multiline template shows its effective text even when unset, so the
      // draft starts from the default instead of an empty box.
      text: isMultiline(spec) && text === "" ? formatText(spec.fallback) : text,
      value: current === undefined ? spec.fallback : current,
      overridden: this.stored(field),
      invalid: false,
    };
  }

  /**
   * Stages one draft on one field: the field's kind decides the draft it can
   * carry, so a typed text on a picked field and a picked value on a typed field
   * do not compile. `clear` fits every field and is the reset — the write drops
   * the user layer, it is not a copy of the base.
   */
  stage<F extends SettingsField>(field: F, draft: Staged<F>): void {
    this.store(field, draft);
  }

  /** The one place a staged draft lands, holding the wide shape of the map. */
  private store(field: SettingsField, draft: Draft): void {
    this.staged.set(field, draft);
    this.failed = false;
    this.publish();
  }

  actions(): CardActions {
    return {
      edit: (field: DraftField, text: string) => {
        this.stage(field, { op: "set", text: text });
      },
      choose: <F extends ValueField>(field: F, value: SettingsValue<F>) => {
        // The same draft `stage` would take; written through `store` because a
        // generic `F` leaves `Staged<F>` unreducible for the compiler.
        this.store(field, { op: "set", value: value });
      },
      resetField: (field: SettingsField) => {
        // Every kind resets the same way: drop the user override so the field
        // follows the composition base. Writing a copy of the base into the user
        // layer would pin the value and make the reset a new override.
        this.stage(field, { op: "clear" });
      },
      save: () => {
        return this.save();
      },
      discard: () => {
        if (this.staged.size === 0 && !this.failed) return;
        this.staged.clear();
        this.failed = false;
        this.publish();
      },
    };
  }

  async save(): Promise<void> {
    const plan = this.plan();
    const writes = plan.filter(function (
      item: PlanEntry,
    ): item is PlanEntry & { run: () => Promise<boolean> } {
      return item.run !== undefined;
    });
    if (plan.length === 0 || this.saving || writes.length !== plan.length)
      return;
    this.saving = true;
    this.failed = false;
    this.publish();
    let landed = true;
    for (const write of writes) {
      try {
        const ok = await write.run();
        landed = ok === true && landed;
      } catch (_error) {
        landed = false;
      }
    }
    if (landed) this.staged.clear();
    this.saving = false;
    this.failed = !landed;
    this.publish();
  }

  projection(): CardSnapshot {
    const shell = this.shell();
    const fields: FieldsState = {
      enabled: this.field("enabled"),
      steer: this.field("steer"),
      configFile: this.field("configFile"),
      mode: this.field("mode"),
      maxReminderRounds: this.field("maxReminderRounds"),
      onLimit: this.field("onLimit"),
      reminderTemplate: this.field("reminderTemplate"),
      limitTemplate: this.field("limitTemplate"),
      maxSnapshotFiles: this.field("maxSnapshotFiles"),
      debug: this.field("debug"),
    };
    return Object.assign({}, shell, { fields: fields });
  }

  inject(): CardFace {
    return {
      hooks: {
        docImpactCard: {
          getSnapshot: () => this.getSnapshot(),
          subscribe: (listener: () => void) => this.subscribe(listener),
        },
      },
      edit: this.actions().edit,
      choose: this.actions().choose,
      resetField: this.actions().resetField,
      save: this.actions().save,
      discard: this.actions().discard,
    };
  }
}
