import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import {
  existingQaUserWorkspace,
  prepareQaUserWorkspace,
  QA_USER_WORKSPACES_DIRECTORY,
} from "../user-workspace.js";
import type {
  QaSkillAdminEdit,
  QaSkillDiagnostic,
  QaSkillDocument,
  QaSkillDraftInput,
  QaSkillJsonValue,
  QaSkillRemoval,
  QaSkillSummary,
  QaSkillToolDescriptor,
  QaSkillValidation,
  ResolvedQaSurfaceConfig,
} from "../types.js";
import { QaPersonalSkillError } from "./errors.js";
import {
  directoryExists,
  ensureSkillRoots,
  listSkillDirectories,
  resolveSkillRoots,
  skillDirectory,
  skillFilePath,
  type QaSkillRoots,
} from "./paths.js";
import {
  normalizeAllowedTools,
  parseSkillFile,
  serializeSkillFile,
  skillFileBody,
  skillFileBytes,
  skillNameProblem,
  validateSkillDraft,
  QA_SKILL_DESCRIPTION_MAX,
  QA_SKILL_FILE_MAX_BYTES,
  QA_SKILL_MAX_TOOLS,
  QA_SKILL_WHEN_TO_USE_MAX,
  type QaSkillFileContents,
  type QaSkillFileDraft,
} from "./skill-file.js";

/**
 * Resource entries a skill may carry. v1 never writes them; anything else
 * found beside `SKILL.md` earns a warning so the user knows the editor is not
 * managing it.
 */
const RECOGNIZED_RESOURCES = new Set(["references", "assets", "scripts"]);

/**
 * Name of the sidecar that records which skills an administrator wrote. It
 * sits beside the skill directories, and everything that enumerates skills
 * ignores dot entries — so the record never becomes a skill and never reaches
 * the model.
 */
export const QA_SKILL_ADMIN_EDITS_FILE = ".admin-edits.json";

/** Cap on the sidecar: its entry count, and the bytes read back from it. */
const ADMIN_EDITS_MAX = 512;
const ADMIN_EDITS_MAX_BYTES = 64 * 1024;

/** Per-account identity of the skill storage boundary. */
export interface QaPersonalSkillContext {
  /** The authenticated account id whose personal root holds these skills. */
  readonly userId: string;
}

/**
 * The deployment-wide store: skills every account may read, which only an
 * administrator writes. It is resolved against the registered workspace (the
 * same relative root, a different owner), so the two scopes have identical
 * geometry and identical path checks.
 */
export interface QaSharedSkillContext {
  readonly shared: true;
}

/** Which store a call reads or writes. */
export type QaSkillScope = QaPersonalSkillContext | QaSharedSkillContext;

/**
 * What a save must record about itself beyond the draft.
 *
 * `actorId` is the administrator behind an administrator's write. An owner's
 * own save passes nothing, which clears whatever mark the skill carried: the
 * stored revision is theirs again, and the badge is a statement about the
 * bytes on disk rather than a history nobody can act on. Removal takes no
 * origin because a removed skill has no bytes left to mark — the audit row the
 * console writes is where that actor is named.
 */
export interface QaSkillWriteOrigin {
  readonly actorId?: string;
}

/** One stored administrator mark, valid only for the revision it names. */
interface QaAdminEditRecord extends QaSkillAdminEdit {
  readonly revision: string;
}

/** One stored skill: its parsed contents plus the facts a DTO needs. */
export interface QaStoredSkill {
  /** Whether the skill directory itself exists. */
  readonly exists: boolean;
  /** Whether the skill came from the deployment-wide store. */
  readonly shared: boolean;
  /** Directory name; the skill's identity for every write. */
  readonly directoryName: string;
  readonly directory: string;
  readonly filePath: string;
  readonly raw: string;
  readonly revision: string;
  readonly updatedAt: string | null;
  /** Absent when the file is missing or its frontmatter does not parse. */
  readonly contents: QaSkillFileContents | undefined;
  readonly diagnostics: readonly QaSkillDiagnostic[];
  readonly resourceCount: number;
}

export interface QaPersonalSkillsOptions {
  readonly getConfig: () => ResolvedQaSurfaceConfig;
  readonly logger: PluginLogger;
  /** The registered workspace path this deployment pins QA accounts under. */
  readonly workspacePath: () => string | undefined;
  /** Tells the DSH skill registry that a personal catalog may have changed. */
  readonly invalidate: () => void;
  /** Called once per storage root the discovery provider meets. */
  readonly onRootDiscovered?: (root: string) => void;
}

/**
 * Skills over one directory: an account's own, or the deployment's shared one.
 *
 * The service is the only writer: it derives every path from the scope,
 * validates a draft before touching the disk, writes `SKILL.md` through a
 * temporary file and a rename, and keeps a removed skill recoverable in the
 * trash beside its skills root. Reading is deliberately permissive — a skill
 * whose file the parser rejects still returns a document carrying the
 * diagnostic that says why, so the editor can repair it.
 */
export class QaPersonalSkills {
  private readonly ctx: Context;
  private readonly options: QaPersonalSkillsOptions;

  constructor(ctx: Context, options: QaPersonalSkillsOptions) {
    this.ctx = ctx;
    this.options = options;
  }

  /** Whether the feature is available on this deployment at all. */
  get enabled(): boolean {
    return this.options.getConfig().accounts.skills.enabled;
  }

  /** Resolve one scope's storage roots, or refuse the operation. */
  private rootsFor(scope: QaSkillScope): QaSkillRoots {
    if (isSharedScope(scope)) return this.sharedRoots();
    const config = this.options.getConfig();
    this.requireEnabled();
    const workspacePath = this.requireWorkspacePath();
    let personalRoot: string;
    try {
      // `prepare` tolerates a missing account directory: reading one's own
      // skills must not require an unrelated session to exist first.
      personalRoot = prepareQaUserWorkspace(workspacePath, scope.userId);
    } catch (error) {
      throw new QaPersonalSkillError(
        "workspace-unavailable",
        error instanceof Error ? error.message : String(error),
      );
    }
    const roots = resolveSkillRoots(
      personalRoot,
      config.accounts.skills.relativeRoot,
    );
    ensureSkillRoots(roots);
    return roots;
  }

  /** The deployment's own skills root, below the registered workspace. */
  private sharedRoots(): QaSkillRoots {
    const config = this.options.getConfig();
    this.requireEnabled();
    const workspacePath = this.requireWorkspacePath();
    const roots = resolveSkillRoots(
      workspacePath,
      config.accounts.skills.relativeRoot,
      "the deployment workspace's",
    );
    ensureSkillRoots(roots);
    return { ...roots, shared: true };
  }

  private requireEnabled(): void {
    if (!this.options.getConfig().accounts.skills.enabled) {
      throw new QaPersonalSkillError(
        "skills-disabled",
        "personal skills are not enabled on this deployment",
      );
    }
  }

  /** The registered workspace every scope is resolved against, or a refusal. */
  private requireWorkspacePath(): string {
    const workspacePath = this.options.workspacePath();
    if (workspacePath === undefined) {
      throw new QaPersonalSkillError(
        "workspace-unavailable",
        "the configured QA workspace is not registered",
      );
    }
    return workspacePath;
  }

  /**
   * The absolute directory a scope reads and writes. The console names it so
   * an operator can open the same path in a file manager; nothing in the wire
   * contract can name a path the service did not derive itself.
   */
  rootPath(scope: QaSkillScope): string {
    return this.rootsFor(scope).skills;
  }

  /**
   * Resolve the storage roots a session cwd names. This is the discovery
   * provider's entry point and takes no account token: the cwd itself is the
   * boundary, validated as a provisioned `<workspace>/.qa-users/<uuid>`
   * directory, so no arbitrary directory can name another account's storage.
   */
  private rootsForCwd(
    cwd: string,
    relativeRoot: string,
  ): QaSkillRoots | undefined {
    const personalRoot = qaUserWorkspaceFromCwd(cwd);
    if (personalRoot === undefined) return undefined;
    try {
      const roots = resolveSkillRoots(personalRoot, relativeRoot);
      // The account directory is provisioned when its first session starts,
      // but the skill tree inside it used to wait for the first save — which
      // left every boot of every account watching a directory that was not
      // there, and reported it as a failed watch instead of an empty catalog.
      ensureSkillRoots(roots);
      return roots;
    } catch {
      return undefined;
    }
  }

  /** Every skill of one scope, sorted by directory name. */
  list(context: QaSkillScope): readonly QaSkillSummary[] {
    const roots = this.rootsFor(context);
    const available = this.availableTools();
    const edits = this.adminEdits(roots);
    return listSkillDirectories(roots).map((directoryName) =>
      this.summarize(this.load(roots, directoryName), available, edits),
    );
  }

  /** One skill with everything the editor needs. */
  get(context: QaSkillScope, name: string): QaSkillDocument {
    const roots = this.rootsFor(context);
    const stored = this.load(roots, name);
    if (!stored.exists) {
      throw new QaPersonalSkillError(
        "skill-not-found",
        `no skill directory named ${name}`,
      );
    }
    return this.document(stored, this.availableTools(), this.adminEdits(roots));
  }

  /**
   * Check one unsaved draft without touching storage: the serializer is the
   * one a Save uses and the preserved frontmatter is the stored file's, so the
   * preview the editor shows is byte-for-byte the file that save would write,
   * and the diagnostics carry the operator's own limit (which the browser
   * cannot know). `name` is the stored skill being edited, or null to create.
   */
  validate(
    context: QaSkillScope,
    name: string | null,
    input: QaSkillDraftInput,
  ): QaSkillValidation {
    const config = this.options.getConfig();
    const prepared = this.prepareWrite(input, config, false);
    const extraFrontmatter =
      name === null ? {} : this.storedFrontmatter(this.rootsFor(context), name);
    const text = serializeSkillFile({ ...prepared.draft, extraFrontmatter });
    return {
      preview: text,
      diagnostics: validateSkillDraft({
        ...prepared.draft,
        sizeBytes: skillFileBytes(text),
        maxBytes: config.accounts.skills.maxSkillBytes,
        availableTools: [...this.availableTools()],
        rejectedTools: prepared.rejectedTools,
        extraFieldNames: Object.keys(extraFrontmatter),
      }),
    };
  }

  /** Whether one scope stores a skill under this name. */
  has(context: QaSkillScope, name: string): boolean {
    try {
      const roots = this.rootsFor(context);
      return directoryExists(skillDirectory(roots, name));
    } catch {
      return false;
    }
  }

  /** Create one skill directory and its `SKILL.md`. */
  create(
    context: QaSkillScope,
    input: QaSkillDraftInput,
    origin: QaSkillWriteOrigin = {},
  ): QaSkillDocument {
    const roots = this.rootsFor(context);
    const prepared = this.prepareWrite(input, this.options.getConfig(), true);
    const directory = skillDirectory(roots, prepared.name);
    if (directoryExists(directory)) {
      throw new QaPersonalSkillError(
        "skill-exists",
        `a skill named ${prepared.name} already exists`,
      );
    }
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      this.writeAtomic(skillFilePath(roots, prepared.name), prepared.text);
    } catch (error) {
      rmSync(directory, { recursive: true, force: true });
      throw this.storageError(error);
    }
    this.refreshCatalog("skill.create", context, prepared.name);
    this.rememberWrite(roots, prepared.name, prepared.text, undefined, origin);
    return this.get(context, prepared.name);
  }

  /**
   * Replace one skill's file, preserving the frontmatter fields this editor
   * does not own and moving the whole directory when the name changed.
   */
  update(
    context: QaSkillScope,
    name: string,
    input: QaSkillDraftInput,
    origin: QaSkillWriteOrigin = {},
  ): QaSkillDocument {
    const roots = this.rootsFor(context);
    const prepared = this.prepareWrite(input, this.options.getConfig(), true);
    const current = this.load(roots, name);
    if (!current.exists) {
      throw new QaPersonalSkillError(
        "skill-not-found",
        `no skill directory named ${name}`,
      );
    }
    this.assertRevision(name, input.expectedRevision, current.revision);
    const text = serializeSkillFile({
      ...prepared.draft,
      // Foreign frontmatter is read from the file, not from the browser: the
      // stored copy is the authority on what a Save must not lose.
      extraFrontmatter: current.contents?.extraFrontmatter ?? {},
    });
    const target = skillDirectory(roots, prepared.name);
    if (current.directory === target) {
      this.writeAtomic(current.filePath, text);
    } else {
      this.renameSkillDirectory(current.directory, target, text, prepared.name);
    }
    this.refreshCatalog("skill.update", context, prepared.name);
    this.rememberWrite(roots, prepared.name, text, name, origin);
    return this.get(context, prepared.name);
  }

  /** Move one skill directory into the trash beside its skills root. */
  remove(
    context: QaSkillScope,
    name: string,
    expectedRevision: string | null,
  ): QaSkillRemoval {
    const roots = this.rootsFor(context);
    const current = this.load(roots, name);
    if (!current.exists) {
      throw new QaPersonalSkillError(
        "skill-not-found",
        `no skill directory named ${name}`,
      );
    }
    this.assertRevision(name, expectedRevision, current.revision);
    try {
      mkdirSync(roots.trash, { recursive: true, mode: 0o700 });
      renameSync(current.directory, this.trashTarget(roots.trash, name));
    } catch (error) {
      throw this.storageError(error);
    }
    this.refreshCatalog("skill.delete", context, name);
    this.forgetWrite(roots, name);
    return { name, trashed: true };
  }

  /**
   * The tool catalog the picker offers. Availability is the QA session's own
   * scope — the deployment's reviewed allow-list — never a suggestion of what
   * a skill may grant: a declared tool the scope excludes stays listed and
   * stays unavailable.
   */
  tools(context: QaSkillScope): readonly QaSkillToolDescriptor[] {
    const available = this.availableTools();
    const described = new Map<string, string>();
    for (const schema of this.ctx.tools.schemas()) {
      described.set(schema.name, schema.description);
    }
    const names = new Set<string>(described.keys());
    for (const name of available) names.add(name);
    // Declared names come last: an imported tool the registry never had has to
    // stay removable from the skill that declares it.
    for (const name of this.declaredTools(context)) names.add(name);
    const descriptors = [...names].map((name) => ({
      name,
      description: described.get(name) ?? "",
      available: available.has(name),
    }));
    descriptors.sort((left, right) => {
      if (left.available !== right.available) return left.available ? -1 : 1;
      return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
    });
    return descriptors;
  }

  /**
   * The skills one session cwd exposes to DSH. A file the parser rejects, or
   * one whose name disagrees with its directory, is reported in the editor and
   * never handed to the model as a half-valid skill.
   *
   * This is the model-facing discovery path, so it degrades to empty instead
   * of throwing: a provider that throws marks the whole catalog snapshot
   * incomplete, and the harness then withholds the available-skills section
   * from every session — not just this account's skills.
   */
  discover(cwd: string): readonly QaStoredSkill[] {
    const config = this.options.getConfig();
    if (!config.accounts.skills.enabled) return [];
    const roots = this.rootsForCwd(cwd, config.accounts.skills.relativeRoot);
    if (roots === undefined) return [];
    this.observe(roots.skills);
    const shared = this.sharedRootsForDiscovery(roots);
    // The account's own skills come first: on a duplicate name the registry
    // ranks a personal skill above the shared one, and this order is the same
    // decision told to every caller that reads the list directly.
    return [
      ...this.discoverIn(roots),
      ...(shared === undefined ? [] : this.discoverIn(shared)),
    ];
  }

  /** One roots pair's discoverable skills; never throws. */
  private discoverIn(roots: QaSkillRoots): readonly QaStoredSkill[] {
    try {
      return listSkillDirectories(roots)
        .map((directoryName) => this.load(roots, directoryName))
        .filter((skill) => this.isDiscoverable(skill));
    } catch (error) {
      this.options.logger.warn("skill.discover-failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * The deployment's shared root for one cwd-scoped read, or undefined. It
   * answers undefined when shared skills cannot be resolved at all, and when
   * the shared root is the root the personal read already covered — a session
   * pinned to the workspace root would otherwise list everything twice.
   */
  private sharedRootsForDiscovery(
    personal: QaSkillRoots,
  ): QaSkillRoots | undefined {
    let shared: QaSkillRoots;
    try {
      shared = this.sharedRoots();
    } catch (error) {
      this.options.logger.warn("skill.shared-discover-failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
    if (sameDirectory(shared.skills, personal.skills)) return undefined;
    this.observe(shared.skills);
    return shared;
  }

  /** Re-read one skill of a session cwd, re-checking the same boundary. */
  read(cwd: string, directoryName: string): QaStoredSkill | undefined {
    const config = this.options.getConfig();
    if (!config.accounts.skills.enabled) return undefined;
    const roots = this.rootsForCwd(cwd, config.accounts.skills.relativeRoot);
    if (roots === undefined) return undefined;
    const personal = this.readFrom(roots, directoryName);
    if (personal !== undefined) return personal;
    const shared = this.sharedRootsForDiscovery(roots);
    return shared === undefined
      ? undefined
      : this.readFrom(shared, directoryName);
  }

  private readFrom(
    roots: QaSkillRoots,
    directoryName: string,
  ): QaStoredSkill | undefined {
    let directory: string;
    try {
      directory = skillDirectory(roots, directoryName);
    } catch {
      return undefined;
    }
    if (!directoryExists(directory)) return undefined;
    const stored = this.load(roots, directoryName);
    return this.isDiscoverable(stored) ? stored : undefined;
  }

  private observe(root: string): void {
    this.options.onRootDiscovered?.(root);
  }

  private isDiscoverable(skill: QaStoredSkill): boolean {
    const contents = skill.contents;
    if (!skill.exists || contents === undefined) return false;
    return contents.name === skill.directoryName;
  }

  private availableTools(): ReadonlySet<string> {
    return new Set(this.options.getConfig().lockdown.toolPolicy.allow);
  }

  private declaredTools(context: QaSkillScope): readonly string[] {
    const names = new Set<string>();
    let roots: QaSkillRoots;
    try {
      roots = this.rootsFor(context);
    } catch {
      return [];
    }
    for (const directoryName of listSkillDirectories(roots)) {
      const stored = this.load(roots, directoryName);
      for (const tool of stored.contents?.allowedTools ?? []) names.add(tool);
    }
    return [...names];
  }

  /** The foreign frontmatter a save must keep, read from the stored file. */
  private storedFrontmatter(
    roots: QaSkillRoots,
    name: string,
  ): Readonly<Record<string, QaSkillJsonValue>> {
    return this.load(roots, name).contents?.extraFrontmatter ?? {};
  }

  /** Read one skill directory, tolerating every failure the editor must see. */
  private load(roots: QaSkillRoots, directoryName: string): QaStoredSkill {
    const absent: QaStoredSkill = {
      exists: false,
      shared: roots.shared,
      directoryName,
      directory: path.join(roots.skills, directoryName),
      filePath: path.join(roots.skills, directoryName, "SKILL.md"),
      raw: "",
      revision: "",
      updatedAt: null,
      contents: undefined,
      diagnostics: [],
      resourceCount: 0,
    };
    let directory: string;
    try {
      directory = skillDirectory(roots, directoryName);
    } catch {
      return absent;
    }
    if (!directoryExists(directory)) return absent;
    const filePath = path.join(directory, "SKILL.md");
    const maxBytes = this.options.getConfig().accounts.skills.maxSkillBytes;
    const read = readSkillText(
      filePath,
      Math.max(maxBytes, QA_SKILL_FILE_MAX_BYTES),
    );
    const resources = this.resources(directory);
    const base = {
      exists: true,
      shared: roots.shared,
      directoryName,
      directory,
      filePath,
      resourceCount: resources.count,
    };
    if (read === undefined) {
      return {
        ...base,
        raw: "",
        revision: "",
        updatedAt: null,
        contents: undefined,
        diagnostics: [
          ...resources.diagnostics,
          {
            code: "skill-file-missing",
            severity: "error",
            field: null,
            detail: "SKILL.md",
          },
        ],
      };
    }
    const parsed = parseSkillFile(read.text);
    const diagnostics: QaSkillDiagnostic[] = [
      ...resources.diagnostics,
      ...(parsed.ok ? parsed.value.warnings : []),
    ];
    if (!parsed.ok) {
      diagnostics.push({
        code: parsed.code,
        severity: "error",
        field: null,
        detail: parsed.detail,
      });
    } else {
      diagnostics.push(
        ...validateSkillDraft({
          name: parsed.value.name,
          description: parsed.value.description,
          whenToUse: parsed.value.whenToUse,
          modelInvocable: parsed.value.modelInvocable,
          userInvocable: parsed.value.userInvocable,
          allowedTools: parsed.value.allowedTools,
          sizeBytes: skillFileBytes(read.text),
          maxBytes,
          availableTools: [...this.availableTools()],
        }),
      );
      if (parsed.value.name !== directoryName) {
        diagnostics.push({
          code: "name-mismatch",
          severity: "warning",
          field: "name",
          detail: parsed.value.name,
        });
      }
    }
    return {
      ...base,
      raw: read.text,
      revision: hashText(read.text),
      updatedAt: read.updatedAt,
      contents: parsed.ok ? parsed.value : undefined,
      diagnostics,
    };
  }

  private resources(directory: string): {
    readonly count: number;
    readonly diagnostics: readonly QaSkillDiagnostic[];
  } {
    let entries: readonly string[];
    try {
      entries = readdirSync(directory).filter((entry) => entry !== "SKILL.md");
    } catch {
      return { count: 0, diagnostics: [] };
    }
    const diagnostics: QaSkillDiagnostic[] = [];
    for (const entry of entries) {
      if (RECOGNIZED_RESOURCES.has(entry)) continue;
      diagnostics.push({
        code: "resource-unsupported",
        severity: "warning",
        field: null,
        detail: entry,
      });
    }
    return { count: entries.length, diagnostics };
  }

  /**
   * Normalize one editor draft into the file to write. `strict` is the
   * difference between a save and a check: a save refuses a draft the Host
   * will not store, while a check hands the same problems back as diagnostics,
   * because that is what the editor asked for.
   */
  private prepareWrite(
    input: QaSkillDraftInput,
    config: ResolvedQaSurfaceConfig,
    strict: boolean,
  ): {
    readonly name: string;
    readonly text: string;
    readonly draft: QaSkillFileDraft;
    readonly rejectedTools: readonly string[];
  } {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const description =
      typeof input.description === "string" ? input.description.trim() : "";
    const normalized = normalizeAllowedTools(input.allowedTools) ?? {
      tools: [],
      rejected: [],
    };
    const whenToUse =
      typeof input.whenToUse === "string" && input.whenToUse.trim() !== ""
        ? input.whenToUse.trim()
        : null;
    const draft: QaSkillFileDraft = {
      name,
      description,
      whenToUse,
      modelInvocable: input.modelInvocable !== false,
      userInvocable: input.userInvocable !== false,
      allowedTools: normalized.tools,
      extraFrontmatter: {},
      body: typeof input.body === "string" ? input.body : "",
    };
    const text = serializeSkillFile(draft);
    if (!strict) {
      return { name, text, draft, rejectedTools: normalized.rejected };
    }

    if (skillNameProblem(name) !== null) {
      throw new QaPersonalSkillError(
        "skill-name-invalid",
        "the skill name must be lowercase kebab-case",
      );
    }
    if (description === "") {
      throw new QaPersonalSkillError(
        "skill-invalid",
        "the skill description must not be empty",
      );
    }
    if (normalized.rejected.length > 0) {
      throw new QaPersonalSkillError(
        "skill-invalid",
        `unusable tool name(s): ${normalized.rejected.join(", ")}`,
      );
    }
    if (normalized.tools.length > QA_SKILL_MAX_TOOLS) {
      throw new QaPersonalSkillError(
        "skill-invalid",
        `at most ${QA_SKILL_MAX_TOOLS} tools may be declared`,
      );
    }
    const blocking = validateSkillDraft({
      ...draft,
      sizeBytes: skillFileBytes(text),
      maxBytes: config.accounts.skills.maxSkillBytes,
    }).find((entry) => entry.severity === "error");
    if (blocking !== undefined) {
      this.options.logger.warn("skill.validation-failed", {
        code: blocking.code,
        detail: blocking.detail,
        name,
      });
      throw new QaPersonalSkillError(
        "skill-invalid",
        `the skill is not savable: ${blocking.code}`,
      );
    }
    if (description.length > QA_SKILL_DESCRIPTION_MAX) {
      this.options.logger.warn("skill.validation-warning", {
        code: "description-too-long",
        name,
      });
    }
    if (whenToUse !== null && whenToUse.length > QA_SKILL_WHEN_TO_USE_MAX) {
      this.options.logger.warn("skill.validation-warning", {
        code: "when-to-use-too-long",
        name,
      });
    }
    return { name, text, draft, rejectedTools: [] };
  }

  /** Move a renamed skill's whole directory, resources included. */
  private renameSkillDirectory(
    from: string,
    to: string,
    text: string,
    name: string,
  ): void {
    if (directoryExists(to)) {
      throw new QaPersonalSkillError(
        "skill-exists",
        `a skill named ${name} already exists`,
      );
    }
    const moved: string[] = [];
    try {
      mkdirSync(to, { recursive: true, mode: 0o700 });
      for (const entry of readdirSync(from)) {
        renameSync(path.join(from, entry), path.join(to, entry));
        moved.push(entry);
      }
      this.writeAtomic(path.join(to, "SKILL.md"), text);
    } catch (error) {
      // Put every entry back before reporting: a half-moved skill directory is
      // worse than a refused save.
      for (const entry of moved) {
        try {
          renameSync(path.join(to, entry), path.join(from, entry));
        } catch {
          // The original move already failed; the skill stays where it is and
          // the operator gets the error below.
        }
      }
      try {
        rmSync(to, { recursive: true, force: true });
      } catch {
        // A leftover empty directory is harmless.
      }
      throw this.storageError(error);
    }
    try {
      rmSync(from, { recursive: true, force: true });
    } catch {
      // The contents already moved; an empty directory left behind is not
      // worth failing a save over.
    }
  }

  /** Write one file through a temporary sibling and a rename. */
  private writeAtomic(filePath: string, text: string): void {
    const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, text, "utf8");
      renameSync(temporary, filePath);
    } catch (error) {
      try {
        rmSync(temporary, { force: true });
      } catch {
        // A leftover temporary file never shadows the real one.
      }
      throw error;
    }
  }

  private trashTarget(trash: string, name: string): string {
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/gu, "")
      .replace(/\.\d+Zu?$/u, "Z");
    let candidate = path.join(trash, `${name}-${stamp}`);
    for (let attempt = 2; attempt < 100; attempt += 1) {
      if (!pathExists(candidate)) break;
      candidate = path.join(trash, `${name}-${stamp}-${attempt}`);
    }
    return candidate;
  }

  private assertRevision(
    name: string,
    expected: string | null,
    current: string,
  ): void {
    if (expected !== null && expected !== current) {
      throw new QaPersonalSkillError(
        "skill-conflict",
        `skill ${name} changed after it was read`,
      );
    }
  }

  private summarize(
    stored: QaStoredSkill,
    available: ReadonlySet<string>,
    edits: ReadonlyMap<string, QaAdminEditRecord>,
  ): QaSkillSummary {
    const contents = stored.contents;
    return {
      name: stored.directoryName,
      description: contents?.description ?? "",
      whenToUse: contents?.whenToUse ?? null,
      modelInvocable: contents?.modelInvocable ?? true,
      userInvocable: contents?.userInvocable ?? true,
      allowedTools: contents?.allowedTools ?? [],
      unavailableTools: (contents?.allowedTools ?? []).filter(
        (tool) => !available.has(tool),
      ),
      resourceCount: stored.resourceCount,
      valid: !stored.diagnostics.some((entry) => entry.severity === "error"),
      diagnostics: stored.diagnostics,
      updatedAt: stored.updatedAt,
      revision: stored.revision,
      adminEdit: this.adminEditOf(stored, edits),
    };
  }

  private document(
    stored: QaStoredSkill,
    available: ReadonlySet<string>,
    edits: ReadonlyMap<string, QaAdminEditRecord>,
  ): QaSkillDocument {
    const contents = stored.contents;
    return {
      ...this.summarize(stored, available, edits),
      body: contents?.body ?? skillFileBody(stored.raw),
      extraFrontmatter: contents?.extraFrontmatter ?? {},
      sourcePath: stored.filePath,
      preview:
        contents === undefined ? stored.raw : serializeSkillFile(contents),
    };
  }

  private storageError(error: unknown): QaPersonalSkillError {
    if (error instanceof QaPersonalSkillError) return error;
    return new QaPersonalSkillError(
      "storage-unavailable",
      error instanceof Error ? error.message : String(error),
    );
  }

  /**
   * Publish one write: audit it, then refresh the DSH catalog. The two are
   * separate stages on purpose — a stored skill whose catalog refresh failed
   * is still stored, and the deployment needs to see which half broke.
   */
  private refreshCatalog(
    action: string,
    context: QaSkillScope,
    name: string,
  ): void {
    // The account id is hashed: an audit line names no personal data. The
    // deployment-wide store has no account to name at all.
    this.options.logger.info(action, {
      ...(isSharedScope(context)
        ? { scope: "shared" as const }
        : {
            user: createHash("sha256")
              .update(context.userId)
              .digest("hex")
              .slice(0, 12),
          }),
      skill: name,
    });
    try {
      this.options.invalidate();
    } catch (error) {
      this.options.logger.error("skill.provider.invalidate-failed", {
        skill: name,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // -------------------------------------------------------------------------
  // Administrator provenance
  // -------------------------------------------------------------------------

  /**
   * The administrator marks stored beside one skills root.
   *
   * The sidecar is advisory: a mark that cannot be read or written never fails
   * a save, because losing a badge is a smaller failure than losing an edit.
   * Each mark names the revision it describes, so a mark whose content has
   * since changed reports as absent rather than as a claim about the present.
   */
  private adminEdits(
    roots: QaSkillRoots,
  ): ReadonlyMap<string, QaAdminEditRecord> {
    const read = readSkillText(
      path.join(roots.skills, QA_SKILL_ADMIN_EDITS_FILE),
      ADMIN_EDITS_MAX_BYTES,
    );
    if (read === undefined) return new Map();
    let parsed: unknown;
    try {
      parsed = JSON.parse(read.text);
    } catch {
      return new Map();
    }
    if (typeof parsed !== "object" || parsed === null) return new Map();
    const entries = (parsed as { readonly entries?: unknown }).entries;
    if (typeof entries !== "object" || entries === null) return new Map();
    const marks = new Map<string, QaAdminEditRecord>();
    for (const [name, value] of Object.entries(entries)) {
      const record = adminEditRecord(value);
      if (record !== undefined) marks.set(name, record);
    }
    return marks;
  }

  /** The mark to report for one stored skill: absent unless it still matches. */
  private adminEditOf(
    stored: QaStoredSkill,
    edits: ReadonlyMap<string, QaAdminEditRecord>,
  ): QaSkillAdminEdit | null {
    const record = edits.get(stored.directoryName);
    if (record === undefined || stored.revision === "") return null;
    if (record.revision !== stored.revision) return null;
    return { actorId: record.actorId, at: record.at };
  }

  /**
   * Record one administrator write, or clear the mark when the owner wrote.
   * `previousName` is the directory the skill had before the write, so a
   * rename by an administrator moves the mark with the skill instead of
   * leaving one behind for a name nothing answers to any more.
   */
  private rememberWrite(
    roots: QaSkillRoots,
    name: string,
    text: string,
    previousName: string | undefined,
    origin: QaSkillWriteOrigin,
  ): void {
    const actorId = origin.actorId;
    const edits = new Map(this.adminEdits(roots));
    let changed = false;
    if (previousName !== undefined && previousName !== name) {
      changed = edits.delete(previousName) || changed;
    }
    if (actorId === undefined) {
      changed = edits.delete(name) || changed;
    } else {
      edits.set(name, {
        actorId,
        at: new Date().toISOString(),
        revision: hashText(text),
      });
      changed = true;
    }
    if (!changed) return;
    this.writeAdminEdits(roots, edits);
  }

  /** Drop the mark of a skill that no longer exists. */
  private forgetWrite(roots: QaSkillRoots, name: string): void {
    const edits = new Map(this.adminEdits(roots));
    if (!edits.delete(name)) return;
    this.writeAdminEdits(roots, edits);
  }

  private writeAdminEdits(
    roots: QaSkillRoots,
    edits: ReadonlyMap<string, QaAdminEditRecord>,
  ): void {
    try {
      mkdirSync(roots.skills, { recursive: true, mode: 0o700 });
      const entries = [...edits.entries()]
        .sort((left, right) => (left[1].at < right[1].at ? 1 : -1))
        .slice(0, ADMIN_EDITS_MAX);
      this.writeAtomic(
        path.join(roots.skills, QA_SKILL_ADMIN_EDITS_FILE),
        `${JSON.stringify({ version: 1, entries: Object.fromEntries(entries) }, null, 2)}\n`,
      );
    } catch (error) {
      this.options.logger.warn("skill.admin-edit-record-failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * The one place the feature defines what an account-scoped cwd looks like:
 * `<registered workspace>/.qa-users/<uuid>`. Anything else names no personal
 * root, which is what keeps the discovery provider from reading arbitrary
 * directories a session happens to be pinned to.
 */
/** Whether a scope names the deployment-wide store. */
function isSharedScope(scope: QaSkillScope): scope is QaSharedSkillContext {
  return (scope as QaSharedSkillContext).shared === true;
}

/** Whether two derived directories are the same one. */
function sameDirectory(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

/** One mark read back from the sidecar, or undefined when it is malformed. */
function adminEditRecord(value: unknown): QaAdminEditRecord | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as { readonly [key: string]: unknown };
  const { actorId, at, revision } = record;
  if (
    typeof actorId !== "string" ||
    actorId === "" ||
    typeof at !== "string" ||
    at === "" ||
    typeof revision !== "string" ||
    revision === ""
  ) {
    return undefined;
  }
  return { actorId, at, revision };
}

function qaUserWorkspaceFromCwd(cwd: string): string | undefined {
  const segments = path.resolve(cwd).split(/[/\\]+/u);
  const userId = segments.at(-1);
  const usersDirectory = segments.at(-2);
  if (userId === undefined || usersDirectory === undefined) return undefined;
  const matches =
    process.platform === "win32"
      ? usersDirectory.toLowerCase() === QA_USER_WORKSPACES_DIRECTORY
      : usersDirectory === QA_USER_WORKSPACES_DIRECTORY;
  if (!matches) return undefined;
  try {
    return existingQaUserWorkspace(path.resolve(cwd, "..", ".."), userId);
  } catch {
    return undefined;
  }
}

function hashText(text: string): string {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

function pathExists(input: string): boolean {
  try {
    statSync(input);
    return true;
  } catch {
    return false;
  }
}

interface SkillRead {
  readonly text: string;
  readonly updatedAt: string | null;
}

/**
 * Read one skill file, refusing to hold an unbounded file in memory: an
 * oversized `SKILL.md` is read only up to the ceiling and reported by the
 * validator, which keeps the editor usable instead of the Host unresponsive.
 * The file is lstat-ed, so a symlinked `SKILL.md` is treated as absent rather
 * than followed out of the account's directory.
 */
function readSkillText(
  filePath: string,
  maxBytes: number,
): SkillRead | undefined {
  let size: number;
  let updatedAt: string | null;
  try {
    const stat = lstatSync(filePath);
    if (!stat.isFile()) return undefined;
    size = stat.size;
    updatedAt = stat.mtime.toISOString();
  } catch {
    return undefined;
  }
  if (size <= maxBytes) {
    try {
      return { text: readFileSync(filePath, "utf8"), updatedAt };
    } catch {
      return undefined;
    }
  }
  try {
    const handle = openSync(filePath, "r");
    try {
      const buffer = Buffer.alloc(maxBytes);
      const read = readSync(handle, buffer, 0, maxBytes, 0);
      return { text: buffer.subarray(0, read).toString("utf8"), updatedAt };
    } finally {
      closeSync(handle);
    }
  } catch {
    return undefined;
  }
}
