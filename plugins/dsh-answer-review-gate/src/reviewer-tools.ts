/** Default read and search tools for the reviewer's configured allow-list. */
export const REVIEWER_READ_ONLY_TOOLS: readonly string[] = Object.freeze([
  "read",
  "read_image",
  "glob",
  "grep",
  "docs_read",
  "docs_search",
  "document_inspect",
  "document_to_markdown",
]);

/**
 * Known mutating tool names excluded when normalizing that list.
 */
export const REVIEWER_FORBIDDEN_TOOLS: readonly string[] = Object.freeze([
  "file_delete",
  "write",
  "edit",
  "apply_patch",
  "str_replace_editor",
  "bash",
  "pwsh",
  "powershell",
  "cmd",
  "shell",
  "run_code",
  "lsp",
  "dsh_lightrag_delete",
]);

/**
 * Prefixes excluded the same way, for the tool families whose individual names
 * a deployment — or a later version of this package — cannot enumerate. The same
 * two families the surface's own workspace fence refuses a model-controlled call
 * to: a terminal session or a job is a way of running something, which is a write
 * wherever it is named.
 */
export const REVIEWER_FORBIDDEN_TOOL_PREFIXES: readonly string[] =
  Object.freeze(["terminal_", "job_"]);

/** Whether one tool name is excluded from the reviewer's set by name. */
export function isReviewerToolForbidden(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (REVIEWER_FORBIDDEN_TOOLS.includes(normalized)) return true;
  return REVIEWER_FORBIDDEN_TOOL_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix),
  );
}

/**
 * Normalize configured names in their original order. An empty input stays empty.
 */
export function restrictReviewerTools(
  names: readonly string[] | undefined,
): readonly string[] {
  if (!Array.isArray(names)) return [];
  const kept: string[] = [];
  for (const name of names) {
    if (typeof name !== "string") continue;
    const normalized = name.trim();
    if (normalized === "" || isReviewerToolForbidden(normalized)) continue;
    if (!kept.includes(normalized)) kept.push(normalized);
  }
  return kept;
}
