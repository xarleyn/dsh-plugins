/**
 * The answer a person reads names a file; it does not say where the deployment
 * keeps the account that owns it.
 *
 * A model quoting a path it was handed prints it verbatim, and a QA deployment
 * gives every account its own directory under one parent, so a path printed
 * with an account identifier is a sentence about the server's layout — and
 * stand dialogs below the signature line can be read by other accounts of the
 * same server. The document tools report workspace-relative names, which is
 * the fix at the source; this is the repair for what still arrives, because a
 * model can rebuild a path from the working directory it is told, and because
 * an answer written before this change is durable history that replays.
 */

/** Characters a literal path may carry into a regular expression. */
function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

/** One or two separators, either convention, as a regular-expression source. */
const SEPARATOR = String.raw`[\\\/]+`;
const TRAILING_SEPARATOR = String.raw`[\\\/]?`;

/**
 * The workspace root spelled so either separator convention matches it: a
 * container records forward slashes, a browser on Windows may print backslashes
 * at the same position, and a mask that only reads one of them leaks on the
 * other. A leading separator is kept, so what replaces the root reads as a name
 * inside the workspace rather than as a path leading out of nowhere.
 */
function rootPattern(workspaceRoot: string): RegExp {
  const segments = workspaceRoot
    .split(/[/\\]/u)
    .filter((segment) => segment !== "")
    .map((segment) => escapeForRegex(segment));
  const leading = /^[/\\]/u.test(workspaceRoot) ? SEPARATOR : "";
  return new RegExp(
    `${leading}${segments.join(SEPARATOR)}${TRAILING_SEPARATOR}`,
    "gu",
  );
}

/**
 * Rewrite an answer so a file is named, not located.
 *
 * The chat's own workspace directory is removed, leaving the spelling the
 * producing tool reports and the workspace reads take. The per-account
 * partition is removed the same way even when the root is unknown or the answer
 * quotes a different chat's file, because the identifier inside it is the part
 * that must not be printed. A path that is neither of those is left alone: a
 * reader told about `/etc/hosts` is not being shown this deployment's layout.
 */
export function toWorkspaceRelativeText(
  text: string,
  workspaceRoot: string | undefined,
): string {
  if (!text.includes("/") && !text.includes("\\")) return text;
  const root = workspaceRoot?.trim();
  const masked =
    root === undefined || root === ""
      ? text
      : text.replace(rootPattern(root), "");
  return masked.replace(
    /[/\\](?:[^/\\\s]+[/\\])*?\.qa-users[/\\][^/\\\s]+[/\\]/gu,
    "",
  );
}
