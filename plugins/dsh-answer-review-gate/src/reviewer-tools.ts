/**
 * The reviewer's tool boundary (`SPEC.md`, "Reviewer isolation": read-only
 * tools, no modification tools).
 *
 * A reviewer is called to judge a draft, so it needs to read and search and
 * nothing else. Stating that as "no tools unless the deployment lists them" is
 * what let a stand hand a reviewer a workspace deletion: the child raised
 * `file_delete`, the call parked above the parent's composer, and the turn
 * waited over an hour for an approval a delegated child can never receive. The
 * boundary is therefore written in both directions here — the list a reviewer is
 * given when the deployment names none, and the names no reviewer is ever given,
 * whatever the deployment lists.
 */

/**
 * The allow-list the reviewer child is composed with by default: document and
 * workspace reads, and search over them. Every name is read-only; nothing here
 * can change state.
 */
export const REVIEWER_READ_ONLY_TOOLS: readonly string[] = Object.freeze([
  "read",
  "read_image",
  "glob",
  "grep",
  "docs_read",
  "docs_search",
]);

/**
 * Names excluded from the reviewer's tool set by name. Deleting, writing and
 * patching files, running a shell or an editor command, and the monorepo's own
 * destructive catalog tools: a call that can change the workspace or an external
 * system has no part in a review, and on a QA stand it would park the parent turn
 * for an answer the child cannot get.
 */
export const REVIEWER_FORBIDDEN_TOOLS: readonly string[] = Object.freeze([
  "file_delete",
  "write",
  "edit",
  "apply_patch",
  "str_replace_editor",
  "bash",
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
 * The allow-list a reviewer child actually gets: the requested names with the
 * excluded ones removed, in the requested order, without duplicates. An empty
 * input is an empty output — a deployment that deliberately lists nothing keeps
 * a tool-less reviewer — but a deployment that lists a destructive name does not
 * get a reviewer that can use it.
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
