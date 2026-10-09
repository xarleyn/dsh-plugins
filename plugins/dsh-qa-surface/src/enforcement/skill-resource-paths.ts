import type { SkillResourceBase } from "@deepseek-ai/dsh-skill";
import { existsSync } from "node:fs";

/** Guidance only: no file contents, path rewriting or permission grant. */
export function skillResourcePathHint(
  requested: unknown,
  loaded: ReadonlyMap<string, SkillResourceBase>,
  exists: (candidate: string) => boolean = existsSync,
): string | undefined {
  if (typeof requested !== "string" || requested.includes("\0")) return undefined;
  const candidate = requested.replaceAll("\\", "/");
  if (candidate.split("/").some((part) => part === ".." || part === "."))
    return undefined;
  for (const [name, resource] of loaded) {
    if (resource.kind !== "directory") continue;
    const base = resource.path.replaceAll("\\", "/").replace(/\/$/u, "");
    if (!base.startsWith("/") || base.length < 2) continue;
    const index = candidate.indexOf(`${base}/`);
    if (index <= 0 || !candidate.startsWith("/")) continue;
    // A real file may deliberately have this directory layout. Preserve its
    // ordinary read instead of treating a matching substring as a typo.
    if (exists(requested)) return undefined;
    const exact = candidate.slice(index);
    return `Skill "${name}" uses an absolute resource directory. Do not prepend the workspace or repository path. Retry read with file_path=${JSON.stringify(exact)} exactly. This is path guidance only; the normal filesystem and QA access checks still apply.`;
  }
  return undefined;
}

export function skillResourceGuidance(resource: SkillResourceBase | undefined): string {
  return resource?.kind === "directory"
    ? `Skill resources live in the absolute directory ${JSON.stringify(resource.path)}. Preserve its leading slash when using read. Resolve a relative reference against this directory only; never prepend the workspace or repository directory to an absolute resource path.`
    : "";
}
