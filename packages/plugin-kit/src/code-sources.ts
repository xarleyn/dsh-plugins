/** Named source trees. Pure data: selecting one never grants filesystem access. */
export interface CodeSource {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly docsVersion?: string;
}

export interface CodeSourcesConfig {
  readonly defaultSource?: string;
  readonly entries?: readonly CodeSource[];
}

export interface CodeSourcesCatalog {
  readonly defaultSource: string;
  readonly entries: readonly CodeSource[];
}

export const EMPTY_CODE_SOURCES: CodeSourcesCatalog = Object.freeze({
  defaultSource: "",
  entries: Object.freeze([]),
});

/** Validate independently of directory names, branch names, and host OS. */
export function resolveCodeSources(
  raw?: CodeSourcesConfig,
): CodeSourcesCatalog {
  if (raw === undefined) return EMPTY_CODE_SOURCES;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError("codeSources must be an object");
  }
  if (raw.entries !== undefined && !Array.isArray(raw.entries)) {
    throw new TypeError("codeSources.entries must be an array");
  }
  if ((raw.entries?.length ?? 0) > 128) {
    throw new TypeError("codeSources supports at most 128 entries");
  }
  const ids = new Set<string>();
  const entries = (raw.entries ?? []).map((entry) => {
    const id = text(entry?.id, "id", 128);
    const label = text(entry?.label, "label", 256);
    const path = text(entry?.path, "path", 4096);
    if (!(
      path.startsWith("/") ||
      /^[a-z]:[/\\]/iu.test(path) ||
      /^\\\\[^\\]+\\[^\\]+/u.test(path)
    )) {
      throw new TypeError("codeSources path must be absolute");
    }
    if (ids.has(id)) throw new TypeError("codeSources ids must be unique");
    ids.add(id);
    const docsVersion =
      entry.docsVersion === undefined
        ? undefined
        : text(entry.docsVersion, "docsVersion", 128);
    return Object.freeze({
      id,
      label,
      path,
      ...(docsVersion === undefined ? {} : { docsVersion }),
    });
  });
  const defaultSource =
    raw.defaultSource === undefined || raw.defaultSource === ""
      ? ""
      : text(raw.defaultSource, "defaultSource", 128);
  if (defaultSource !== "" && !ids.has(defaultSource)) {
    throw new TypeError(
      "codeSources.defaultSource must name a configured entry",
    );
  }
  return Object.freeze({ defaultSource, entries: Object.freeze(entries) });
}

function text(value: unknown, name: string, max: number): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > max ||
    [...value].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  ) {
    throw new TypeError(
      `codeSources ${name} must be non-empty text without control characters (max ${max})`,
    );
  }
  return value.trim();
}

/** An explicit id always wins. Several entries without a default are ambiguous. */
export function selectCodeSource(
  catalog: CodeSourcesCatalog,
  requested?: unknown,
): CodeSource | undefined {
  const explicit = requested !== undefined && requested !== null;
  const id = explicit ? text(requested, "source", 128) : catalog.defaultSource;
  if (id !== "") {
    const selected = catalog.entries.find((entry) => entry.id === id);
    if (selected === undefined)
      throw new Error(
        "Unknown source; call code_sources or dsh_git_sources to list configured ids.",
      );
    return selected;
  }
  if (catalog.entries.length > 1) {
    throw new Error(
      "Several code sources are configured; pass source explicitly or configure defaultSource. Call code_sources for the ids.",
    );
  }
  return catalog.entries[0];
}

/** Shared model-facing selector; ids are opaque and never inferred from paths. */
export const CODE_SOURCE_PARAMETER = {
  type: "string" as const,
  description:
    "Configured source id, as returned by code_sources. Omit to use defaultSource (or the sole entry). Names and paths are operator-defined; do not infer them. Pass the same source to code and Git tools when comparing versions.",
};
