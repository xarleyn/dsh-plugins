import { ConfigError } from "./errors.js";

/** Workspace rules accept ordinary globs. Reject extglob syntax before compilation or traversal. */
export function assertSupportedGlob(pattern: string, ruleId?: string): void {
  if (!pattern.includes("(")) return;
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern.charAt(i);
    if (char === "\\") i++;
    else if (char === "[") inClass = true;
    else if (char === "]") inClass = false;
    else if (!inClass && "?*+@!".includes(char) && pattern[i + 1] === "(") {
      throw new ConfigError(
        "extglob selectors are unsupported; use separate include or exclude entries",
        ruleId,
      );
    }
  }
}
