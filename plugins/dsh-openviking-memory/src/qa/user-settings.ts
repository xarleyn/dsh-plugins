/**
 * Per-account memory controls for a QA deployment.
 *
 * The plugin's own settings namespace is one configuration for the whole
 * installation, which is exactly wrong for the one switch a chat's user owns:
 * whether their conversations feed the memory, and whether the memory is
 * injected back into them. This store keeps that answer per QA account, next to
 * the plugin rather than inside anybody's workspace, so a user's choice never
 * travels into a repository or into a shared profile layer.
 *
 * Storage is a small JSON document written atomically and only ever read by
 * this process. The answer for an account that never changed anything is
 * `inherit`: the deployment's plan decides, which is what keeps a fresh
 * installation behaving like one without this file.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { InjectionPlan } from "../config.js";

/**
 * One account's overrides. `null` means "inherit the deployment": the knob is
 * absent from a user's document until somebody changes it, so a later change to
 * the deployment's own configuration still reaches every user who did not
 * disagree with it.
 */
export interface QaUserMemorySettings {
  /** Master switch for this account's automatic context presentation. */
  readonly autoInject: boolean | null;
  /** Profile injection (startup and per-step) for this account. */
  readonly profile: boolean | null;
  /** Automatic recall for this account. */
  readonly recall: boolean | null;
}

/** The all-inherit answer: no account override is in effect. */
export const QA_USER_MEMORY_INHERIT: QaUserMemorySettings = Object.freeze({
  autoInject: null,
  profile: null,
  recall: null,
});

/** What one account's document looks like on disk; absent keys are inherited. */
interface StoredUser {
  autoInject?: boolean;
  profile?: boolean;
  recall?: boolean;
}

interface StoredDocument {
  version: number;
  users: Record<string, StoredUser>;
}

const DOCUMENT_VERSION = 1;

/** The document a deployment gets when it configures nothing. */
export function resolveQaUserSettingsPath(
  configured?: string,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string {
  const explicit = String(configured ?? "").trim();
  if (explicit) return explicit;
  const home = String(env.DSH_HOME ?? "").trim();
  const base = home === "" ? cwd : home;
  return join(base, "openviking-memory-qa-users.json");
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/** Narrow one raw document entry, dropping anything this version cannot read. */
function decodeUser(raw: unknown): StoredUser {
  if (raw === null || typeof raw !== "object") return {};
  const record = raw as Record<string, unknown>;
  const user: StoredUser = {};
  if (isBoolean(record.autoInject)) user.autoInject = record.autoInject;
  if (isBoolean(record.profile)) user.profile = record.profile;
  if (isBoolean(record.recall)) user.recall = record.recall;
  return user;
}

function toSettings(stored: StoredUser | undefined): QaUserMemorySettings {
  if (stored === undefined) return QA_USER_MEMORY_INHERIT;
  return Object.freeze({
    autoInject: stored.autoInject ?? null,
    profile: stored.profile ?? null,
    recall: stored.recall ?? null,
  });
}

function isEmpty(stored: StoredUser): boolean {
  return (
    stored.autoInject === undefined &&
    stored.profile === undefined &&
    stored.recall === undefined
  );
}

/**
 * The effective plan for one account: the deployment's plan, narrowed by what
 * that account asked for. An account override can only ever switch automatic
 * context off — a user cannot turn on what the deployment disabled, and
 * `autoInject: false` remains the single switch that silences both the profile
 * and the recall paths.
 */
export function effectiveInjectionPlan(
  base: InjectionPlan,
  settings: QaUserMemorySettings | undefined,
): InjectionPlan {
  if (settings === undefined) return base;
  const master = settings.autoInject !== false;
  const profile = master && settings.profile !== false;
  const recall = master && settings.recall !== false;
  return {
    startupProfile: base.startupProfile && profile,
    stepProfile: base.stepProfile && profile,
    recall: base.recall && recall,
  };
}

/** Whether an account changed anything at all. */
export function hasQaUserOverrides(settings: QaUserMemorySettings): boolean {
  return (
    settings.autoInject !== null ||
    settings.profile !== null ||
    settings.recall !== null
  );
}

/** Why a write was not persisted, for the log and the caller's answer. */
export interface QaUserSettingsWriteFailure {
  readonly message: string;
}

/**
 * The account-keyed override document.
 *
 * Reads happen on the plugin's hot path (every step asks for one account's
 * plan), so the document is loaded once and answered from memory afterwards.
 * Writes are the browser's settings dialog and go through {@link patch}, which
 * persists the whole document through a temporary file: a reader either sees
 * the document before a write or after it, never a half-written one.
 */
export class QaUserMemorySettingsStore {
  private userSettings = new Map<string, StoredUser>();
  private loaded = false;

  constructor(
    private readonly filePath: string = resolveQaUserSettingsPath(),
    private readonly log: (
      stage: string,
      data: Record<string, unknown>,
    ) => void = () => undefined,
  ) {}

  /** Where this store persists; the settings dialog shows it to the operator. */
  path(): string {
    return this.filePath;
  }

  /** One account's overrides, or the all-inherit answer. */
  read(userId: string): QaUserMemorySettings {
    this.load();
    return toSettings(this.userSettings.get(userId));
  }

  /**
   * Merge one account's overrides and persist them. A `null` in the patch
   * clears that knob back to inherit, and an account left with no overrides is
   * dropped from the document entirely.
   */
  patch(
    userId: string,
    patch: Partial<QaUserMemorySettings>,
  ): QaUserMemorySettings {
    this.load();
    const current = this.userSettings.get(userId) ?? {};
    const next: StoredUser = { ...current };
    for (const key of ["autoInject", "profile", "recall"] as const) {
      const value = patch[key];
      if (value === undefined) continue;
      if (value === null) delete next[key];
      else next[key] = value;
    }
    if (isEmpty(next)) this.userSettings.delete(userId);
    else this.userSettings.set(userId, next);
    this.persist();
    return toSettings(this.userSettings.get(userId));
  }

  /** Drop every override for one account. */
  reset(userId: string): QaUserMemorySettings {
    this.load();
    if (this.userSettings.delete(userId)) this.persist();
    return QA_USER_MEMORY_INHERIT;
  }

  /**
   * Read the document once. A missing file is the normal first-run state; an
   * unreadable or malformed one is reported and treated as empty, because a
   * broken settings file must not take the memory integration down with it.
   */
  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf-8");
    } catch (error: unknown) {
      const code = (error as { code?: unknown }).code;
      if (code !== "ENOENT") {
        this.log("qa_user_settings_unreadable", {
          path: this.filePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error: unknown) {
      this.log("qa_user_settings_malformed", {
        path: this.filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    const users =
      parsed !== null && typeof parsed === "object"
        ? (parsed as { users?: unknown }).users
        : undefined;
    if (users === null || typeof users !== "object") return;
    for (const [userId, value] of Object.entries(
      users as Record<string, unknown>,
    )) {
      const stored = decodeUser(value);
      if (!isEmpty(stored)) this.userSettings.set(userId, stored);
    }
  }

  /** Write the document through a temporary file, then swap it into place. */
  private persist(): void {
    const users: Record<string, StoredUser> = {};
    for (const [userId, stored] of this.userSettings) {
      if (!isEmpty(stored)) users[userId] = stored;
    }
    const document: StoredDocument = { version: DOCUMENT_VERSION, users };
    const temporary = `${this.filePath}.tmp`;
    try {
      mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
      writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, {
        encoding: "utf-8",
        mode: 0o600,
      });
      renameSync(temporary, this.filePath);
    } catch (error: unknown) {
      this.log("qa_user_settings_write_failed", {
        path: this.filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
