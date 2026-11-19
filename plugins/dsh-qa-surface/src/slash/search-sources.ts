import type { QaSlashCatalog, QaSurfaceConfig } from "../types.js";
import { parseSlashLine, skillGestures } from "./parser.js";
import {
  isSearchSource,
  readSourcePrompt,
  sourceLabel,
} from "./source-prompt.js";

type Bindings = NonNullable<QaSurfaceConfig["searchSources"]>;

/** The unfiltered operator configuration never enters the public client config. */
export function projectSearchSources(
  catalog: QaSlashCatalog,
  bindings: Bindings,
  allowed: ReadonlySet<string>,
): QaSlashCatalog {
  const directories = new Set<string>();
  const duplicates = new Set<string>();
  for (const { directory } of bindings) {
    const key = directory?.toLowerCase();
    if (directories.has(key)) duplicates.add(key);
    directories.add(key);
  }
  const configured = new Map<string, Bindings[number] | null>();
  for (const binding of bindings) {
    const dir = binding.directory;
    const valid =
      typeof dir === "string" &&
      /^[\p{L}\p{N}_-][\p{L}\p{N} ._-]*$/u.test(dir) &&
      !/[. ]$/u.test(dir) &&
      (!binding.linkBase ||
        /^(?:https?|file):\/\/[^?#@\s]+(?:\/[^?#@\s]*)?$/iu.test(
          binding.linkBase,
        )) &&
      !duplicates.has(dir.toLowerCase());
    configured.set(
      binding.skill,
      valid && !configured.has(binding.skill) ? binding : null,
    );
  }
  return {
    ...catalog,
    deniedSkills: catalog.deniedSkills.filter((name) => !configured.has(name)),
    entries: catalog.entries.flatMap((entry) => {
      const binding =
        entry.kind === "skill" ? configured.get(entry.name) : undefined;
      if (binding === undefined) return [entry];
      if (binding === null) return [];
      if (!allowed.has(entry.name) || entry.modelInvocable !== false) return [];
      const label = binding.label.trim();
      if (!label || /[\r\n]/u.test(label)) return [];
      return [{ ...entry, searchSource: { label } }];
    }),
  };
}

/** A direct slash submission and a menu selection use the same admission. */
export async function requireSearchSourceAccess(
  bindings: Bindings,
  text: string,
  catalog: () => Promise<QaSlashCatalog>,
): Promise<void> {
  const receipt = readSourcePrompt(text);
  if (bindings.length === 0 && !receipt) return;
  const names = skillGestures(text).filter((name) =>
    bindings.some((binding) => binding.skill === name),
  );
  if (!names.length && !receipt) return;
  const explicit = parseSlashLine(text.replace(/^\/no-review\s+/u, ""));
  if (
    names.length === 1 &&
    explicit?.name === names[0] &&
    (await catalog()).entries.some(
      (entry) =>
        isSearchSource(entry) &&
        entry.name === names[0] &&
        (!receipt ||
          (receipt.skill === entry.name &&
            receipt.label === sourceLabel(entry.searchSource))),
    )
  )
    return;
  throw new Error("Источник поиска недоступен для этого запроса.");
}
