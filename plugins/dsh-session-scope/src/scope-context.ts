import type { EffectiveSessionScope } from "./session-scope.js";

export function renderSessionScopeContext(scope: EffectiveSessionScope): string {
  if (scope.mode === "full") {
    return [
      "### Session workspace scope",
      "",
      "The entire session workspace is accessible. Filesystem effects are still controlled by the active permission policy.",
    ].join("\n");
  }
  const roots = scope.roots.length === 0
    ? ["- none (filesystem access is fail-closed until the scope is changed)"]
    : scope.roots.map((root) => `- ${root}`);
  const shell = scope.mode === "isolated"
    ? "Supported shell processes are also confined to this view."
    : "DSH filesystem tools are restricted; shell isolation is not guaranteed in focused mode.";
  return [
    "### Session workspace scope",
    "",
    `The current session uses ${scope.mode} workspace scope.`,
    "",
    "Accessible roots:",
    ...roots,
    "",
    "Treat all other paths under the session workspace as unavailable.",
    "Do not search, inspect, read, modify, or execute against paths outside these roots.",
    "If another workspace area is required, ask the user to change the session scope.",
    shell,
  ].join("\n");
}
